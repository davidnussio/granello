use crate::audio::{self, Session, SessionConfig};
use crate::db::Db;
use crate::models::*;
use crate::transcribe::{self, TranscriberCache};
use crate::{calendar, llm, prompts, secrets};
use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Default)]
pub struct CalendarCache {
    pub url: Option<String>,
    pub fetched_at: Option<Instant>,
    pub ics: Option<String>,
    pub notified: HashSet<String>,
    pub last_error: Option<String>,
}

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub transcribers: Arc<TranscriberCache>,
    pub session: Mutex<Option<Session>>,
    pub calendar: tokio::sync::Mutex<CalendarCache>,
    pub downloading: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent<'a> {
    stream_id: &'a str,
    delta: &'a str,
}

// ---------------- meetings ----------------

#[tauri::command]
pub fn list_meetings(state: State<AppState>, query: Option<String>) -> CmdResult<Vec<MeetingSummary>> {
    state.db.lock().list_meetings(query.as_deref()).map_err(err)
}

#[tauri::command]
pub fn get_meeting(state: State<AppState>, id: String) -> CmdResult<MeetingDetail> {
    let db = state.db.lock();
    let meeting = db.get_meeting(&id).map_err(err)?.ok_or("Meeting non trovato")?;
    let segments = db.segments(&id).map_err(err)?;
    Ok(MeetingDetail { meeting, segments })
}

#[tauri::command]
pub fn create_meeting(
    state: State<AppState>,
    title: String,
    calendar_event_id: Option<String>,
    attendees: Option<Vec<String>>,
    template_id: Option<String>,
) -> CmdResult<Meeting> {
    let db = state.db.lock();
    if let Some(ev) = calendar_event_id.as_deref() {
        if let Some(existing) = db.meeting_for_event(ev).map_err(err)? {
            return db.get_meeting(&existing).map_err(err)?.ok_or_else(|| "meeting".into());
        }
    }
    db.create_meeting(
        &title,
        calendar_event_id.as_deref(),
        &attendees.unwrap_or_default(),
        template_id.as_deref(),
    )
    .map_err(err)
}

#[tauri::command]
pub fn update_meeting(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    notes_md: Option<String>,
    enhanced_md: Option<String>,
    template_id: Option<String>,
) -> CmdResult<()> {
    state
        .db
        .lock()
        .update_meeting(
            &id,
            title.as_deref(),
            notes_md.as_deref(),
            enhanced_md.as_deref(),
            template_id.as_deref(),
        )
        .map_err(err)
}

#[tauri::command]
pub fn delete_meeting(state: State<AppState>, id: String) -> CmdResult<()> {
    if state.session.lock().as_ref().map(|s| s.meeting_id == id).unwrap_or(false) {
        return Err("Ferma la registrazione prima di eliminare il meeting".into());
    }
    state.db.lock().delete_meeting(&id).map_err(err)
}

// ---------------- registrazione ----------------

#[tauri::command]
pub fn list_audio_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<AppState>, meeting_id: String) -> CmdResult<()> {
    let mut session = state.session.lock();
    if let Some(s) = session.as_ref() {
        if s.meeting_id == meeting_id {
            return Ok(());
        }
        return Err("È già in corso una registrazione su un altro meeting".into());
    }
    let (settings, meeting, base_ms) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let meeting = db.get_meeting(&meeting_id).map_err(err)?.ok_or("Meeting non trovato")?;
        let base_ms = db.transcript_end_ms(&meeting_id).map_err(err)?;
        (settings, meeting, base_ms)
    };
    // Il prompt iniziale aiuta whisper con nomi e termini del meeting.
    let mut prompt = meeting.title.clone();
    if !meeting.attendees.is_empty() {
        prompt.push_str(". Partecipanti: ");
        prompt.push_str(&meeting.attendees.join(", "));
    }
    if !settings.user_name.is_empty() {
        prompt.push_str(&format!(". {}", settings.user_name));
    }
    prompt.push('.');

    let cfg = SessionConfig {
        meeting_id: meeting_id.clone(),
        mic_device: settings.mic_device.clone(),
        system_device: settings.system_device.clone(),
        language: settings.language.clone(),
        model_path: transcribe::model_path(&state.models_dir, &settings.whisper_model),
        prompt,
        base_ms,
    };
    let s = Session::start(app.clone(), state.db.clone(), state.transcribers.clone(), cfg).map_err(err)?;
    state.db.lock().mark_started(&meeting_id).map_err(err)?;
    *session = Some(s);
    let _ = app.emit("recording-started", meeting_id);
    Ok(())
}

#[tauri::command]
pub async fn stop_recording(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let s = state.session.lock().take();
    if let Some(s) = s {
        let id = s.meeting_id.clone();
        tokio::task::spawn_blocking(move || s.stop()).await.map_err(err)?;
        let _ = app.emit("recording-stopped", id);
    }
    Ok(())
}

#[tauri::command]
pub fn recording_status(state: State<AppState>) -> RecordingStatus {
    let s = state.session.lock();
    RecordingStatus {
        meeting_id: s.as_ref().map(|s| s.meeting_id.clone()),
        recording: s.is_some(),
        pending_chunks: s.as_ref().map(|s| s.pending.load(Ordering::SeqCst)).unwrap_or(0),
    }
}

// ---------------- AI ----------------

fn api_key(state: &AppState) -> CmdResult<String> {
    secrets::get_api_key(&state.data_dir)
        .map_err(err)?
        .ok_or_else(|| "Configura la API key di Claude nelle Impostazioni".into())
}

#[tauri::command]
pub async fn enhance_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    meeting_id: String,
    stream_id: String,
) -> CmdResult<String> {
    let key = api_key(&state)?;
    let (settings, system, user) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let meeting = db.get_meeting(&meeting_id).map_err(err)?.ok_or("Meeting non trovato")?;
        let segments = db.segments(&meeting_id).map_err(err)?;
        if meeting.notes_md.trim().is_empty() && segments.is_empty() {
            return Err("Non c'è niente da arricchire: scrivi qualche nota o registra il meeting".into());
        }
        let template = meeting
            .template_id
            .as_deref()
            .and_then(|t| db.get_template(t).ok().flatten())
            .or_else(|| db.get_template("generale").ok().flatten());
        let system = prompts::enhance_system(&settings.language);
        let user = prompts::enhance_user(&meeting, template.as_ref(), &segments, &settings.user_name);
        (settings, system, user)
    };
    let text = llm::stream_message(
        &key,
        &settings.claude_model,
        &system,
        &[llm::Msg::user(user)],
        8000,
        |d| {
            let _ = app.emit("llm-delta", DeltaEvent { stream_id: &stream_id, delta: d });
        },
    )
    .await
    .map_err(err)?;
    let text = strip_code_fence(&text);
    state
        .db
        .lock()
        .update_meeting(&meeting_id, None, None, Some(&text), None)
        .map_err(err)?;
    Ok(text)
}

fn strip_code_fence(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```markdown").or_else(|| t.strip_prefix("```md")).or_else(|| t.strip_prefix("```")) {
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim().to_string();
        }
    }
    t.to_string()
}

#[tauri::command]
pub fn get_chat(state: State<AppState>, scope: String) -> CmdResult<Vec<ChatMessage>> {
    state.db.lock().chat_history(&scope).map_err(err)
}

#[tauri::command]
pub fn clear_chat(state: State<AppState>, scope: String) -> CmdResult<()> {
    state.db.lock().clear_chat(&scope).map_err(err)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push_str(" […]");
    out
}

/// `scope`: "global" per tutti i meeting, altrimenti l'id del meeting.
#[tauri::command]
pub async fn chat(
    app: AppHandle,
    state: State<'_, AppState>,
    scope: String,
    question: String,
    stream_id: String,
) -> CmdResult<ChatMessage> {
    let key = api_key(&state)?;
    let (model, system, mut history) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let system = if scope == "global" {
            let meetings = db.relevant_meetings(&question, 8).map_err(err)?;
            let with_tr = meetings
                .into_iter()
                .map(|m| {
                    let segs = db.segments(&m.id).unwrap_or_default();
                    let tr = prompts::transcript_text(&segs, &settings.user_name);
                    let max = if m.enhanced_md.is_some() { 2500 } else { 8000 };
                    (m, truncate_chars(&tr, max))
                })
                .collect::<Vec<_>>();
            if with_tr.is_empty() {
                return Err("Non ci sono ancora meeting su cui fare domande".into());
            }
            prompts::chat_system_global(&with_tr)
        } else {
            let m = db.get_meeting(&scope).map_err(err)?.ok_or("Meeting non trovato")?;
            let segs = db.segments(&scope).map_err(err)?;
            prompts::chat_system_meeting(&m, &segs, &settings.user_name)
        };
        let history = db.chat_history(&scope).map_err(err)?;
        db.add_chat_message(&scope, "user", &question).map_err(err)?;
        (settings.claude_model, system, history)
    };
    // ultimi 20 messaggi come contesto conversazionale
    let skip = history.len().saturating_sub(20);
    let mut msgs: Vec<llm::Msg> = history
        .drain(skip..)
        .map(|m| if m.role == "user" { llm::Msg::user(m.content) } else { llm::Msg::assistant(m.content) })
        .collect();
    // la conversazione deve iniziare con un messaggio "user"
    while msgs.first().map(|m| m.role != "user").unwrap_or(false) {
        msgs.remove(0);
    }
    msgs.push(llm::Msg::user(question));

    let answer = llm::stream_message(&key, &model, &system, &msgs, 4000, |d| {
        let _ = app.emit("llm-delta", DeltaEvent { stream_id: &stream_id, delta: d });
    })
    .await;
    let db = state.db.lock();
    match answer {
        Ok(a) => db.add_chat_message(&scope, "assistant", &a).map_err(err),
        Err(e) => {
            let _ = db.add_chat_message(&scope, "assistant", &format!("⚠️ {e}"));
            Err(err(e))
        }
    }
}

// ---------------- template ----------------

#[tauri::command]
pub fn list_templates(state: State<AppState>) -> CmdResult<Vec<Template>> {
    state.db.lock().list_templates().map_err(err)
}

#[tauri::command]
pub fn save_template(state: State<AppState>, template: Template) -> CmdResult<Template> {
    if template.name.trim().is_empty() || template.instructions.trim().is_empty() {
        return Err("Nome e istruzioni sono obbligatori".into());
    }
    state.db.lock().save_template(&template).map_err(err)
}

#[tauri::command]
pub fn delete_template(state: State<AppState>, id: String) -> CmdResult<()> {
    state.db.lock().delete_template(&id).map_err(err)
}

// ---------------- impostazioni ----------------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    state.db.lock().get_settings().map_err(err)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> CmdResult<Settings> {
    let s = settings.with_defaults();
    state.db.lock().save_settings(&s).map_err(err)?;
    Ok(s)
}

#[tauri::command]
pub fn has_api_key(state: State<AppState>) -> bool {
    secrets::get_api_key(&state.data_dir).ok().flatten().is_some()
}

#[tauri::command]
pub fn set_api_key(state: State<AppState>, key: String) -> CmdResult<()> {
    secrets::set_api_key(&state.data_dir, key.trim()).map_err(err)
}

// ---------------- modelli whisper ----------------

#[tauri::command]
pub fn list_whisper_models(state: State<AppState>) -> Vec<WhisperModelInfo> {
    transcribe::model_catalog(&state.models_dir)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEvent {
    name: String,
    downloaded: u64,
    total: Option<u64>,
    done: bool,
}

#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, state: State<'_, AppState>, name: String) -> CmdResult<()> {
    if !transcribe::is_known_model(&name) {
        return Err("Modello sconosciuto".into());
    }
    if !state.downloading.lock().insert(name.clone()) {
        return Err("Download già in corso".into());
    }
    let res = download(&app, &state, &name).await;
    state.downloading.lock().remove(&name);
    res
}

async fn download(app: &AppHandle, state: &AppState, name: &str) -> CmdResult<()> {
    use tokio::io::AsyncWriteExt;
    let target = transcribe::model_path(&state.models_dir, name);
    let part = target.with_extension("bin.part");
    let resp = reqwest::get(transcribe::model_url(name)).await.map_err(err)?;
    if !resp.status().is_success() {
        return Err(format!("Download fallito: {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(&part).await.map_err(err)?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(err)?;
        file.write_all(&chunk).await.map_err(err)?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() > Duration::from_millis(250) {
            last_emit = Instant::now();
            let _ = app.emit(
                "model-download",
                DownloadEvent { name: name.into(), downloaded, total, done: false },
            );
        }
    }
    file.flush().await.map_err(err)?;
    drop(file);
    if let Some(t) = total {
        if downloaded != t {
            let _ = tokio::fs::remove_file(&part).await;
            return Err("Download incompleto, riprova".into());
        }
    }
    tokio::fs::rename(&part, &target).await.map_err(err)?;
    let _ = app.emit("model-download", DownloadEvent { name: name.into(), downloaded, total, done: true });
    Ok(())
}

// ---------------- calendario ----------------

const CAL_TTL: Duration = Duration::from_secs(10 * 60);

/// Aggiorna la cache ICS se scaduta o se l'URL è cambiato. Ritorna true se ha scaricato.
pub async fn refresh_calendar(state: &AppState, force: bool) -> CmdResult<bool> {
    let url = state.db.lock().get_settings().map_err(err)?.ics_url.filter(|u| !u.trim().is_empty());
    let mut cache = state.calendar.lock().await;
    let Some(url) = url else {
        *cache = CalendarCache::default();
        return Ok(false);
    };
    let stale = cache.url.as_deref() != Some(url.as_str())
        || cache.fetched_at.map(|t| t.elapsed() > CAL_TTL).unwrap_or(true);
    if !stale && !force {
        return Ok(false);
    }
    match calendar::fetch_ics(&url).await {
        Ok(ics) => {
            cache.ics = Some(ics);
            cache.url = Some(url);
            cache.fetched_at = Some(Instant::now());
            cache.last_error = None;
            Ok(true)
        }
        Err(e) => {
            // riprova al prossimo giro, ma tieni i dati vecchi se l'URL è lo stesso
            if cache.url.as_deref() != Some(url.as_str()) {
                cache.ics = None;
                cache.url = Some(url);
            }
            cache.fetched_at = Some(Instant::now() - CAL_TTL + Duration::from_secs(60));
            cache.last_error = Some(e.to_string());
            Err(e.to_string())
        }
    }
}

pub async fn current_events(state: &AppState) -> Vec<CalendarEvent> {
    let ics = state.calendar.lock().await.ics.clone();
    let Some(ics) = ics else { return vec![] };
    let now = chrono::Utc::now();
    let mut events =
        calendar::events_between(&ics, now - chrono::Duration::hours(12), now + chrono::Duration::days(7));
    let db = state.db.lock();
    for e in events.iter_mut() {
        e.meeting_id = db.meeting_for_event(&e.id).ok().flatten();
    }
    events
}

#[tauri::command]
pub async fn upcoming_events(state: State<'_, AppState>, force: Option<bool>) -> CmdResult<Vec<CalendarEvent>> {
    refresh_calendar(&state, force.unwrap_or(false)).await?;
    Ok(current_events(&state).await)
}
