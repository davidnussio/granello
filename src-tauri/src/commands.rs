use crate::audio::{self, Session, SessionConfig};
use crate::i18n::tr;
use crate::db::Db;
use crate::models::*;
use crate::transcribe::{self, TranscriberCache};
use crate::{calendar, llm, prompts, secrets};
use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// Client HTTP condiviso (pool di connessioni, timeout di connessione e di lettura).
    pub http: reqwest::Client,
    /// Client per i modelli AI: un modello locale può impiegare minuti a leggere una
    /// trascrizione lunga prima di emettere il primo token.
    pub llm_http: reqwest::Client,
    /// Generazioni AI in corso, per poterle annullare: stream_id -> flag di annullamento.
    pub streams: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// `idle`: tempo massimo senza ricevere dati prima di considerare morta la connessione.
pub fn http_client(idle: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Granello/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(idle)
        .build()
        .expect("client HTTP")
}

/// Registra una generazione annullabile e la rimuove quando esce dallo scope.
struct StreamGuard<'a> {
    state: &'a AppState,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl<'a> StreamGuard<'a> {
    fn new(state: &'a AppState, id: &str) -> Self {
        let cancel = Arc::new(AtomicBool::new(false));
        state.streams.lock().insert(id.to_string(), cancel.clone());
        Self { state, id: id.to_string(), cancel }
    }
}

impl Drop for StreamGuard<'_> {
    fn drop(&mut self) {
        self.state.streams.lock().remove(&self.id);
    }
}

#[tauri::command]
pub fn cancel_stream(state: State<AppState>, stream_id: String) {
    if let Some(flag) = state.streams.lock().get(&stream_id) {
        flag.store(true, Ordering::SeqCst);
    }
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
    let meeting = db.get_meeting(&id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
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
        return Err(tr("Ferma la registrazione prima di eliminare il meeting", "Stop the recording before deleting the meeting").into());
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
        return Err(tr("È già in corso una registrazione su un altro meeting", "Another meeting is already being recorded").into());
    }
    let (settings, meeting, base_ms) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let meeting = db.get_meeting(&meeting_id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
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

/// Un modello pronto all'uso: provider, indirizzo, chiave e nome del modello.
struct ResolvedModel {
    provider: Provider,
    api_key: Option<String>,
    model: String,
}

fn resolve_model(state: &AppState, settings: &Settings, which: &ModelRef) -> CmdResult<ResolvedModel> {
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == which.provider_id)
        .cloned()
        .ok_or(tr("Il provider AI scelto non esiste più: controlla le Impostazioni", "The selected AI provider no longer exists: check Settings"))?;
    let api_key = secrets::get_api_key(&state.data_dir, &provider.id).map_err(err)?;
    if provider.kind == ProviderKind::Anthropic && api_key.is_none() {
        return Err(trf!("Configura la API key di {} nelle Impostazioni", "Set the {} API key in Settings", provider.name));
    }
    Ok(ResolvedModel { provider, api_key, model: which.model.clone() })
}

impl ResolvedModel {
    fn request<'a>(&'a self, system: &'a str, messages: &'a [llm::Msg], max_tokens: u32, cache: bool) -> llm::Request<'a> {
        llm::Request {
            kind: self.provider.kind,
            provider_name: &self.provider.name,
            base_url: &self.provider.base_url,
            api_key: self.api_key.as_deref(),
            model: &self.model,
            system,
            messages,
            max_tokens,
            cache_system: cache,
        }
    }

    /// I server locali troncano in silenzio i prompt più lunghi del contesto: se l'utente
    /// ha indicato la finestra del modello, meglio un errore chiaro di note inventate a metà.
    fn check_context(&self, system: &str, messages: &[llm::Msg]) -> CmdResult<()> {
        let Some(limit) = self.provider.context_tokens else { return Ok(()) };
        let chars: usize = system.chars().count() + messages.iter().map(|m| m.content.chars().count()).sum::<usize>();
        let estimated = estimate_tokens(chars);
        if estimated > limit as usize {
            return Err(trf!(
                "Il testo da inviare (circa {estimated} token) supera il contesto di {} ({limit} token). \
Aumenta il contesto del modello o scegline uno più capiente.",
                "The text to send (about {estimated} tokens) exceeds the context of {} ({limit} tokens). \
Increase the model's context or pick a model with a larger one.",
                self.provider.name
            ));
        }
        Ok(())
    }
}

/// Stima prudente: l'italiano sta intorno a 3 caratteri per token.
fn estimate_tokens(chars: usize) -> usize {
    chars.div_ceil(3)
}

#[tauri::command]
pub async fn enhance_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    meeting_id: String,
    stream_id: String,
) -> CmdResult<String> {
    let (model, system, user) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let meeting = db.get_meeting(&meeting_id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
        let segments = db.segments(&meeting_id).map_err(err)?;
        if meeting.notes_md.trim().is_empty() && segments.is_empty() {
            return Err(tr("Non c'è niente da arricchire: scrivi qualche nota o registra il meeting", "There is nothing to enhance: write some notes or record the meeting").into());
        }
        let template = meeting
            .template_id
            .as_deref()
            .and_then(|t| db.get_template(t).ok().flatten())
            .or_else(|| db.get_template("generale").ok().flatten());
        let system = prompts::enhance_system(&settings.language);
        let user = prompts::enhance_user(&meeting, template.as_ref(), &segments, &settings.user_name);
        (resolve_model(&state, &settings, &settings.notes_model)?, system, user)
    };
    let messages = [llm::Msg::user(user)];
    model.check_context(&system, &messages)?;
    let guard = StreamGuard::new(&state, &stream_id);
    let done = llm::stream_message(
        &state.llm_http,
        &model.request(&system, &messages, ENHANCE_MAX_TOKENS, false),
        &guard.cancel,
        |d| {
            let _ = app.emit("llm-delta", DeltaEvent { stream_id: &stream_id, delta: d });
        },
    )
    .await
    .map_err(err)?;
    drop(guard);
    let mut text = strip_code_fence(&done.text);
    if text.trim().is_empty() {
        // non sovrascrivere note esistenti con una risposta vuota
        return Err(tr("Claude non ha prodotto note. Riprova.", "The model produced no notes. Try again.").into());
    }
    if done.truncated {
        text.push_str(tr(
            "\n\n*[Note troncate: la risposta ha raggiunto il limite di lunghezza. Rigenera per riprovare.]*",
            "\n\n*[Notes truncated: the answer hit the length limit. Regenerate to try again.]*",
        ));
    }
    state
        .db
        .lock()
        .update_meeting(&meeting_id, None, None, Some(&text), None)
        .map_err(err)?;
    Ok(text)
}

/// Il limite comprende anche il ragionamento del modello, quindi va tenuto largo.
const ENHANCE_MAX_TOKENS: u32 = 16_000;
const CHAT_MAX_TOKENS: u32 = 8_000;

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
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err(tr("Scrivi una domanda", "Type a question").into());
    }
    let (model, system, mut history, user_msg_id) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let model = resolve_model(&state, &settings, &settings.chat_model)?;
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
                return Err(tr("Non ci sono ancora meeting su cui fare domande", "There are no meetings to ask about yet").into());
            }
            prompts::chat_system_global(&with_tr)
        } else {
            let m = db.get_meeting(&scope).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
            let segs = db.segments(&scope).map_err(err)?;
            prompts::chat_system_meeting(&m, &segs, &settings.user_name)
        };
        let history = db.chat_history(&scope).map_err(err)?;
        let user_msg = db.add_chat_message(&scope, "user", &question).map_err(err)?;
        (model, system, history, user_msg.id)
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

    if let Err(e) = model.check_context(&system, &msgs) {
        let _ = state.db.lock().delete_chat_message(user_msg_id);
        return Err(e);
    }
    let guard = StreamGuard::new(&state, &stream_id);
    let answer = llm::stream_message(
        &state.llm_http,
        // sul singolo meeting il contesto resta identico tra una domanda e l'altra:
        // con la cache le domande successive costano e aspettano molto meno
        &model.request(&system, &msgs, CHAT_MAX_TOKENS, scope != "global"),
        &guard.cancel,
        |d| {
            let _ = app.emit("llm-delta", DeltaEvent { stream_id: &stream_id, delta: d });
        },
    )
    .await;
    drop(guard);
    let db = state.db.lock();
    match answer {
        Ok(done) if !done.text.trim().is_empty() => {
            let mut text = done.text;
            if done.truncated {
                text.push_str(" […]");
            }
            db.add_chat_message(&scope, "assistant", &text).map_err(err)
        }
        Ok(_) => {
            let _ = db.delete_chat_message(user_msg_id);
            Err(tr("Claude non ha risposto. Riprova.", "The model did not answer. Try again.").into())
        }
        Err(e) => {
            // la domanda senza risposta non resta nello storico: l'interfaccia la rimette nel campo di testo
            let _ = db.delete_chat_message(user_msg_id);
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
        return Err(tr("Nome e istruzioni sono obbligatori", "Name and instructions are required").into());
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
    let s = settings.validated()?;
    if !transcribe::is_known_model(&s.whisper_model) {
        return Err(tr("Modello Whisper sconosciuto", "Unknown Whisper model").into());
    }
    let db = state.db.lock();
    let old = db.get_settings().map_err(err)?;
    db.save_settings(&s).map_err(err)?;
    if old.ui_language != s.ui_language {
        // errori, notifiche e template di sistema seguono subito la nuova lingua
        crate::i18n::set(crate::i18n::resolve(&s.ui_language));
        db.seed_templates().map_err(err)?;
    }
    drop(db);
    // un provider eliminato non lascia la sua chiave nel Portachiavi
    for gone in old.providers.iter().filter(|o| !s.providers.iter().any(|p| p.id == o.id)) {
        let _ = secrets::set_api_key(&state.data_dir, &gone.id, "");
    }
    Ok(s)
}

/// Le note AI sono utilizzabili? (provider esistente e, se serve, chiave presente)
#[tauri::command]
pub fn ai_ready(state: State<AppState>) -> bool {
    let Ok(settings) = state.db.lock().get_settings() else { return false };
    resolve_model(&state, &settings, &settings.notes_model).is_ok()
}

/// Modelli offerti da un provider, per compilare i menu nelle Impostazioni.
/// Riceve il provider così com'è nel form, anche se non ancora salvato.
#[tauri::command]
pub async fn list_provider_models(state: State<'_, AppState>, provider: Provider) -> CmdResult<Vec<String>> {
    let key = secrets::get_api_key(&state.data_dir, &provider.id).map_err(err)?;
    let base = provider.base_url.trim().trim_end_matches('/');
    let req = match provider.kind {
        ProviderKind::Anthropic => {
            let base = if base.is_empty() { "https://api.anthropic.com" } else { base };
            state
                .http
                .get(format!("{base}/v1/models?limit=100"))
                .header("x-api-key", key.ok_or(tr("Salva prima la API key", "Save the API key first"))?)
                .header("anthropic-version", "2023-06-01")
        }
        ProviderKind::Openai => {
            if !(base.starts_with("http://") || base.starts_with("https://")) {
                return Err(tr("L'indirizzo deve iniziare con http:// o https://", "The address must start with http:// or https://").into());
            }
            let r = state.http.get(format!("{base}/models"));
            match key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        }
    };
    let resp = req.timeout(Duration::from_secs(10)).send().await.map_err(|e| {
        if e.is_connect() {
            trf!("Impossibile raggiungere {}: il server è avviato?", "Can't reach {}: is the server running?", provider.name)
        } else {
            trf!("Errore di rete: {}", "Network error: {}", e.without_url())
        }
    })?;
    if !resp.status().is_success() {
        return Err(match resp.status().as_u16() {
            401 | 403 => tr("API key non valida o mancante", "Invalid or missing API key").into(),
            code => trf!("Il server ha risposto {code}", "The server answered {code}"),
        });
    }
    let body: serde_json::Value = resp.json().await.map_err(|_| tr("Risposta non valida dal server", "Invalid response from the server").to_string())?;
    let mut models: Vec<String> = body["data"]
        .as_array()
        .map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect())
        .unwrap_or_default();
    models.sort();
    models.dedup();
    Ok(models)
}

/// Errori dell'interfaccia nel log dell'app (troncati: non devono portarsi dietro le note).
#[tauri::command]
pub fn log_frontend_error(message: String) {
    log::error!("UI: {}", truncate_chars(&message, 2000));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    data_dir: String,
    log_dir: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    use tauri::Manager;
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.display().to_string(),
        log_dir: app.path().app_log_dir().map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn has_api_key(state: State<AppState>, provider_id: String) -> bool {
    secrets::get_api_key(&state.data_dir, &provider_id).ok().flatten().is_some()
}

#[tauri::command]
pub fn set_api_key(state: State<AppState>, provider_id: String, key: String) -> CmdResult<()> {
    let known = state.db.lock().get_settings().map_err(err)?.providers.iter().any(|p| p.id == provider_id);
    if !known {
        return Err(tr("Salva il provider prima di impostare la chiave", "Save the provider before setting its key").into());
    }
    secrets::set_api_key(&state.data_dir, &provider_id, key.trim()).map_err(err)
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
        return Err(tr("Modello sconosciuto", "Unknown model").into());
    }
    if !state.downloading.lock().insert(name.clone()) {
        return Err(tr("Download già in corso", "Download already in progress").into());
    }
    let res = download(&app, &state, &name).await;
    state.downloading.lock().remove(&name);
    res
}

#[tauri::command]
pub fn delete_whisper_model(state: State<AppState>, name: String) -> CmdResult<()> {
    if !transcribe::is_known_model(&name) {
        return Err(tr("Modello sconosciuto", "Unknown model").into());
    }
    if state.session.lock().is_some() {
        return Err(tr("Ferma la registrazione prima di eliminare un modello", "Stop the recording before deleting a model").into());
    }
    state.transcribers.clear(); // rilascia il file e la memoria
    match std::fs::remove_file(transcribe::model_path(&state.models_dir, &name)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}

async fn download(app: &AppHandle, state: &AppState, name: &str) -> CmdResult<()> {
    let target = transcribe::model_path(&state.models_dir, name);
    let part = target.with_extension("bin.part");
    let res = download_to(app, state, name, &part).await;
    match res {
        Ok(()) => {
            tokio::fs::rename(&part, &target).await.map_err(err)?;
            let _ = app.emit("model-download", DownloadEvent { name: name.into(), downloaded: 0, total: None, done: true });
            log::info!("modello whisper {name} scaricato");
            Ok(())
        }
        Err(e) => {
            // niente file parziali lasciati in giro
            let _ = tokio::fs::remove_file(&part).await;
            log::warn!("download modello {name} fallito: {e}");
            Err(e)
        }
    }
}

async fn download_to(app: &AppHandle, state: &AppState, name: &str, part: &std::path::Path) -> CmdResult<()> {
    use tokio::io::AsyncWriteExt;
    let resp = state
        .http
        .get(transcribe::model_url(name))
        .send()
        .await
        .map_err(|e| trf!("Download fallito: {e}", "Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(trf!("Download fallito: {}", "Download failed: {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(part).await.map_err(err)?;
    let mut checked_magic = false;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| trf!("Download interrotto: {e}", "Download interrupted: {e}"))?;
        if !checked_magic && !chunk.is_empty() {
            // un captive portal o una pagina di errore non sono un modello
            if !transcribe::looks_like_ggml(&chunk) {
                return Err(tr("Il file scaricato non è un modello Whisper valido", "The downloaded file is not a valid Whisper model").into());
            }
            checked_magic = true;
        }
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
    file.sync_all().await.map_err(err)?;
    drop(file);
    if !checked_magic || total.map(|t| downloaded != t).unwrap_or(false) {
        return Err(tr("Download incompleto, riprova", "Incomplete download, try again").into());
    }
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
    match calendar::fetch_ics(&state.http, &url).await {
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
