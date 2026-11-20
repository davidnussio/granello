use crate::audio::{self, Session, SessionConfig};
use crate::i18n::tr;
use crate::db::Db;
use crate::models::*;
use crate::transcribe::{self, TranscriberCache};
use crate::{attachments, calendar, llm, prompts, secrets};
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

/// Un calendario configurato, con l'ultimo ICS scaricato.
#[derive(Default)]
pub struct CalendarFeed {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub fetched_at: Option<Instant>,
    pub ics: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct CalendarCache {
    /// Nell'ordine delle impostazioni.
    pub feeds: Vec<CalendarFeed>,
    pub notified: HashSet<String>,
}

impl CalendarCache {
    /// Allinea i feed ai calendari configurati, tenendo quanto già scaricato per quelli
    /// che non hanno cambiato indirizzo.
    fn sync(&mut self, calendars: &[Calendar]) {
        let mut old = std::mem::take(&mut self.feeds);
        self.feeds = calendars
            .iter()
            .map(|c| {
                let kept = old.iter().position(|f| f.id == c.id && f.url == c.url).map(|i| old.swap_remove(i));
                CalendarFeed {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    url: c.url.clone(),
                    enabled: c.enabled,
                    ..kept.unwrap_or_default()
                }
            })
            .collect();
    }

    /// Gli eventi dei calendari attivi, in ordine di inizio. Lo stesso evento presente in
    /// più calendari compare una volta sola, dal primo che lo contiene.
    fn events_between(&self, from: chrono::DateTime<chrono::Utc>, to: chrono::DateTime<chrono::Utc>) -> Vec<CalendarEvent> {
        let mut seen = HashSet::new();
        let mut events = Vec::new();
        for f in self.feeds.iter().filter(|f| f.enabled) {
            let Some(ics) = &f.ics else { continue };
            for mut e in calendar::events_between(ics, from, to) {
                if seen.insert(e.id.clone()) {
                    e.calendar_id = f.id.clone();
                    events.push(e);
                }
            }
        }
        events.sort_by_key(|e| e.start);
        events
    }
}

pub struct AppState {
    pub db: Arc<Mutex<Db>>,
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub transcribers: Arc<TranscriberCache>,
    pub session: Mutex<Option<Session>>,
    /// La dettatura di una richiesta per l'AI, se in corso.
    pub dictation: Mutex<Option<audio::Dictation>>,
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
        .update_meeting(&id, title.as_deref(), notes_md.as_deref(), enhanced_md.as_deref(), template_id.as_deref())
        .map_err(err)
}

/// Aggiorna partecipanti e/o tag di un meeting (i campi assenti restano invariati).
#[tauri::command]
pub fn update_meeting_meta(
    state: State<AppState>,
    id: String,
    attendees: Option<Vec<String>>,
    tags: Option<Vec<String>>,
) -> CmdResult<Meeting> {
    // le email note dal calendario finiscono in rubrica insieme ai nomi
    let known_emails: Vec<(String, Option<String>)> = match &attendees {
        Some(_) => calendar_people(&state),
        None => Vec::new(),
    };
    let db = state.db.lock();
    if let Some(names) = attendees {
        let people: Vec<(String, Option<String>)> = normalize_names(names, 80, MAX_ATTENDEES)
            .into_iter()
            .map(|name| {
                let email = known_emails.iter().find(|(n, _)| n.eq_ignore_ascii_case(&name)).and_then(|(_, e)| e.clone());
                (name, email)
            })
            .collect();
        db.set_attendees(&id, &people).map_err(err)?;
    }
    if let Some(tags) = tags {
        db.set_tags(&id, &normalize_tags(tags)).map_err(err)?;
    }
    db.get_meeting(&id).map_err(err)?.ok_or_else(|| tr("Meeting non trovato", "Meeting not found").into())
}

/// Persone presenti negli eventi del calendario in cache. Non aspetta mai: se il calendario
/// è in aggiornamento in questo momento, semplicemente non propone nulla.
fn calendar_people(state: &AppState) -> Vec<(String, Option<String>)> {
    state
        .calendar
        .try_lock()
        .ok()
        .map(|c| {
            let mut people: Vec<(String, Option<String>)> = Vec::new();
            for ics in c.feeds.iter().filter(|f| f.enabled).filter_map(|f| f.ics.as_deref()) {
                for (name, email) in calendar::all_attendees(ics) {
                    if !people.iter().any(|(n, _)| n.eq_ignore_ascii_case(&name)) {
                        people.push((name, email));
                    }
                }
            }
            people
        })
        .unwrap_or_default()
}

// ---------- tag e persone ----------

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> CmdResult<Vec<TagCount>> {
    state.db.lock().all_tags().map_err(err)
}

#[tauri::command]
pub fn list_people(state: State<AppState>) -> CmdResult<Vec<Person>> {
    state.db.lock().list_people().map_err(err)
}

#[tauri::command]
pub fn delete_person(state: State<AppState>, id: i64) -> CmdResult<()> {
    state.db.lock().delete_person(id).map_err(err)
}

/// Completamento automatico dei partecipanti: prima la rubrica (usati di recente),
/// poi i nomi letti dal calendario che in rubrica non ci sono ancora.
#[tauri::command]
pub fn suggest_people(state: State<AppState>, query: String) -> CmdResult<Vec<PersonSuggestion>> {
    const LIMIT: usize = 8;
    let q = query.trim().to_lowercase();
    let mut out: Vec<PersonSuggestion> = state
        .db
        .lock()
        .search_people(&q, LIMIT)
        .map_err(err)?
        .into_iter()
        .map(|p| PersonSuggestion { name: p.name, email: p.email, source: "people".into() })
        .collect();
    for (name, email) in calendar_people(&state) {
        if out.len() >= LIMIT {
            break;
        }
        let matches = name.to_lowercase().contains(&q)
            || email.as_deref().map(|e| e.to_lowercase().contains(&q)).unwrap_or(false);
        if matches && !out.iter().any(|o| o.name.eq_ignore_ascii_case(&name)) {
            out.push(PersonSuggestion { name, email, source: "calendar".into() });
        }
    }
    Ok(out)
}

/// L'evento di calendario che si svolge all'ora del meeting, se ha partecipanti:
/// serve a proporre "importa i partecipanti da…" sui meeting creati a mano.
#[tauri::command]
pub async fn calendar_match(state: State<'_, AppState>, meeting_id: String) -> CmdResult<Option<CalendarEvent>> {
    const SLACK_MS: i64 = 10 * 60_000;
    let (when, linked) = {
        let db = state.db.lock();
        let m = db.get_meeting(&meeting_id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
        (m.started_at.unwrap_or(m.created_at), m.calendar_event_id)
    };
    let events = current_events(&state).await;
    let pick = events
        .iter()
        .filter(|e| !e.attendees.is_empty())
        // l'evento a cui il meeting è già collegato vince; altrimenti quello in corso a quell'ora
        .find(|e| linked.as_deref() == Some(e.id.as_str()))
        .or_else(|| {
            events
                .iter()
                .filter(|e| !e.attendees.is_empty() && e.start - SLACK_MS <= when && when < e.end)
                .min_by_key(|e| (e.start - when).abs())
        });
    Ok(pick.cloned())
}

#[tauri::command]
pub fn delete_meeting(state: State<AppState>, id: String) -> CmdResult<()> {
    if state.session.lock().as_ref().map(|s| s.meeting_id == id).unwrap_or(false) {
        return Err(tr("Ferma la registrazione prima di eliminare il meeting", "Stop the recording before deleting the meeting").into());
    }
    let db = state.db.lock();
    let meeting = db.get_meeting(&id).map_err(err)?;
    db.delete_meeting(&id).map_err(err)?;
    // gli allegati citati solo da questo meeting se ne vanno con lui
    if let Some(m) = meeting {
        let text = format!("{}\n{}", m.notes_md, m.enhanced_md.unwrap_or_default());
        for path in attachments::referenced(&text) {
            if !db.attachment_in_use(&path).unwrap_or(true) {
                attachments::remove(&state.data_dir, &path);
            }
        }
    }
    Ok(())
}

// ---------------- allegati ----------------

/// Salva tra gli allegati un file incollato o trascinato nella nota (contenuto in base64).
#[tauri::command]
pub fn save_attachment(state: State<AppState>, name: String, data: String) -> CmdResult<attachments::Attachment> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| tr("Contenuto del file non valido", "Invalid file content"))?;
    attachments::store(&state.data_dir, &name, &bytes).map_err(err)
}

/// Fa scegliere un file e lo copia tra gli allegati. Ritorna None se la scelta viene annullata.
#[tauri::command]
pub async fn pick_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    images_only: bool,
) -> CmdResult<Option<attachments::Attachment>> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app.dialog().file();
    if images_only {
        dialog = dialog
            .set_title(tr("Scegli un'immagine", "Choose an image"))
            .add_filter(tr("Immagini", "Images"), &["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tiff"]);
    } else {
        dialog = dialog.set_title(tr("Scegli un file", "Choose a file"));
    }
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(err)? else { return Ok(None) };
    let source = picked.into_path().map_err(err)?;
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || attachments::import(&data_dir, &source))
        .await
        .map_err(err)?
        .map(Some)
        .map_err(err)
}

/// Un'immagine allegata come data URL, da mostrare nell'editor.
#[tauri::command]
pub async fn read_attachment(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || attachments::image_data_url(&data_dir, &path))
        .await
        .map_err(err)?
        .map_err(err)
}

/// Apre un allegato con l'app predefinita per quel tipo di file.
#[tauri::command]
pub fn open_attachment(app: AppHandle, state: State<AppState>, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let file = attachments::resolve(&state.data_dir, &path).map_err(err)?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(err)
}

/// Il titolo della pagina a quell'indirizzo, per l'anteprima di un link. None se la pagina
/// non risponde o non ha un titolo: l'anteprima mostra comunque il sito.
#[tauri::command]
pub async fn link_title(state: State<'_, AppState>, url: String) -> CmdResult<Option<String>> {
    const MAX_HTML: usize = 256 * 1024;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(tr("L'indirizzo deve iniziare con http:// o https://", "The address must start with http:// or https://").into());
    }
    let request = state
        .http
        .get(&url)
        .header("accept", "text/html")
        .header("user-agent", "Mozilla/5.0 (Macintosh) Granello")
        .timeout(Duration::from_secs(8));
    let Ok(resp) = request.send().await else { return Ok(None) };
    if !resp.status().is_success() {
        return Ok(None);
    }
    // il titolo sta all'inizio della pagina: non serve scaricarla tutta
    let mut html = Vec::new();
    let mut body = resp.bytes_stream();
    while let Some(Ok(chunk)) = body.next().await {
        html.extend_from_slice(&chunk);
        if html.len() >= MAX_HTML {
            break;
        }
    }
    Ok(attachments::page_title(&String::from_utf8_lossy(&html)))
}

// ---------------- registrazione ----------------

#[tauri::command]
pub fn list_audio_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
pub fn start_recording(app: AppHandle, state: State<AppState>, meeting_id: String) -> CmdResult<()> {
    start_session(&app, &state, meeting_id, None)
}

/// Avvia una sessione di trascrizione sul meeting: dal vivo, oppure da `file` se indicato.
fn start_session(app: &AppHandle, state: &AppState, meeting_id: String, file: Option<PathBuf>) -> CmdResult<()> {
    let mut session = state.session.lock();
    if let Some(s) = session.as_ref() {
        if s.meeting_id == meeting_id && !s.importing && file.is_none() {
            return Ok(());
        }
        return Err(session_busy(s).into());
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
    let (db, cache) = (state.db.clone(), state.transcribers.clone());
    let s = match &file {
        Some(path) => Session::start_import(app.clone(), db, cache, cfg, path),
        None => Session::start(app.clone(), db, cache, cfg),
    }
    .map_err(err)?;
    state.db.lock().mark_started(&meeting_id).map_err(err)?;
    *session = Some(s);
    let _ = app.emit("recording-started", meeting_id);
    Ok(())
}

fn session_busy(s: &Session) -> &'static str {
    if s.importing {
        tr("È già in corso la trascrizione di un file audio", "An audio file is already being transcribed")
    } else {
        tr("È già in corso una registrazione su un altro meeting", "Another meeting is already being recorded")
    }
}

/// Fa scegliere un file audio (o un video) e lo trascrive nel meeting, in coda alla
/// trascrizione esistente. Ritorna false se la scelta del file viene annullata.
/// Il percorso non passa dall'interfaccia: il file lo sceglie l'utente nella finestra di sistema.
#[tauri::command]
pub async fn import_audio(app: AppHandle, state: State<'_, AppState>, meeting_id: String) -> CmdResult<bool> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    if let Some(s) = state.session.lock().as_ref() {
        return Err(session_busy(s).into());
    }
    let mut dialog = app
        .dialog()
        .file()
        .set_title(tr("Scegli un file audio", "Choose an audio file"))
        .add_filter(tr("Audio e video", "Audio and video"), crate::decode::EXTENSIONS);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(err)? else { return Ok(false) };
    let path = picked.into_path().map_err(err)?;
    log::info!("trascrizione da file per {meeting_id}");
    // caricare il modello e aprire il file può richiedere qualche secondo
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        start_session(&app, &state, meeting_id, Some(path))
    })
    .await
    .map_err(err)??;
    Ok(true)
}

/// Sceglie il dispositivo da cui arriva l'audio degli altri partecipanti (`None` = solo
/// microfono). Vale da subito anche per la registrazione in corso.
#[tauri::command]
pub fn set_system_device(state: State<AppState>, device: Option<String>) -> CmdResult<()> {
    let device = device.filter(|d| !d.is_empty());
    {
        let db = state.db.lock();
        let mut settings = db.get_settings().map_err(err)?;
        settings.system_device = device.clone();
        db.save_settings(&settings).map_err(err)?;
    }
    if let Some(s) = state.session.lock().as_ref() {
        s.set_system_device(device);
    }
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
        importing: s.as_ref().is_some_and(|s| s.importing),
        pending_chunks: s.as_ref().map(|s| s.pending.load(Ordering::SeqCst)).unwrap_or(0),
    }
}

/// A che punto del meeting è la registrazione dal vivo, per segnare un momento nelle note.
/// `None` se su quel meeting non si sta registrando.
#[tauri::command]
pub fn recording_position(state: State<AppState>, meeting_id: String) -> Option<i64> {
    let s = state.session.lock();
    s.as_ref().filter(|s| s.meeting_id == meeting_id).and_then(|s| s.position_ms())
}

/// Comincia ad ascoltare il microfono per dettare una richiesta. Una dettatura già in corso
/// viene scartata.
#[tauri::command]
pub fn dictation_start(state: State<AppState>) -> CmdResult<()> {
    let settings = state.db.lock().get_settings().map_err(err)?;
    if !transcribe::model_path(&state.models_dir, &settings.whisper_model).exists() {
        return Err(tr(
            "Per dettare serve il modello di trascrizione: scaricalo dalle Impostazioni",
            "Dictation needs the transcription model: download it in Settings",
        )
        .into());
    }
    let mut slot = state.dictation.lock();
    if let Some(old) = slot.take() {
        std::thread::spawn(move || drop(old.stop()));
    }
    *slot = Some(audio::Dictation::start(settings.mic_device).map_err(err)?);
    Ok(())
}

/// Ferma la dettatura e ritorna il testo detto, trascritto in locale. Con `discard` l'audio
/// viene buttato e torna una stringa vuota.
#[tauri::command]
pub async fn dictation_stop(state: State<'_, AppState>, discard: Option<bool>) -> CmdResult<String> {
    let Some(dictation) = state.dictation.lock().take() else { return Ok(String::new()) };
    let (settings, cache) = (state.db.lock().get_settings().map_err(err)?, state.transcribers.clone());
    let model = transcribe::model_path(&state.models_dir, &settings.whisper_model);
    let discard = discard.unwrap_or(false);
    tokio::task::spawn_blocking(move || -> CmdResult<String> {
        let samples = dictation.stop();
        // meno di tre decimi di secondo: un clic per sbaglio
        if discard || samples.len() < transcribe::SAMPLE_RATE as usize * 3 / 10 {
            return Ok(String::new());
        }
        let segments = cache.get(&model).and_then(|t| t.transcribe(&samples, &settings.language, "")).map_err(err)?;
        Ok(segments
            .iter()
            .map(|s| s.text.trim())
            .filter(|t| !transcribe::is_hallucination(t))
            .collect::<Vec<_>>()
            .join(" "))
    })
    .await
    .map_err(err)?
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

/// Un momento segnato nelle note, con ciò che si stava dicendo.
#[derive(serde::Serialize)]
pub struct MomentFill {
    ms: i64,
    text: String,
}

const MAX_MOMENTS: usize = 40;

/// Per ogni momento segnato (`moments`, in ms dall'inizio del meeting) chiede al modello cosa
/// si stava dicendo lì. Ritorna solo i momenti per cui la trascrizione dice qualcosa.
/// Le note le aggiorna l'interfaccia: l'utente potrebbe averle cambiate nel frattempo.
#[tauri::command]
pub async fn fill_moments(state: State<'_, AppState>, meeting_id: String, moments: Vec<i64>) -> CmdResult<Vec<MomentFill>> {
    let (model, system, user, asked) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        let meeting = db.get_meeting(&meeting_id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
        let segments = db.segments(&meeting_id).map_err(err)?;
        let mut asked: Vec<(i64, String)> = Vec::new();
        for ms in moments {
            if asked.len() >= MAX_MOMENTS || asked.iter().any(|(m, _)| *m == ms) {
                continue;
            }
            let excerpt = prompts::moment_excerpt(&segments, ms, &settings.user_name);
            if !excerpt.is_empty() {
                asked.push((ms, excerpt));
            }
        }
        if asked.is_empty() {
            return Ok(Vec::new());
        }
        let system = prompts::moments_system(&settings.language);
        let user = prompts::moments_user(&meeting, &asked);
        (resolve_model(&state, &settings, &settings.notes_model)?, system, user, asked)
    };
    let messages = [llm::Msg::user(user)];
    model.check_context(&system, &messages)?;
    let cancel = AtomicBool::new(false);
    let done = llm::stream_message(&state.llm_http, &model.request(&system, &messages, MOMENTS_MAX_TOKENS, false), &cancel, |_| {})
        .await
        .map_err(err)?;
    let texts = prompts::parse_moments(&done.text, asked.len());
    Ok(asked
        .into_iter()
        .zip(texts)
        .filter_map(|((ms, _), text)| text.map(|text| MomentFill { ms, text }))
        .collect())
}

/// Una richiesta dell'editor all'AI: una domanda sul meeting, un blocco da creare o modificare,
/// un testo da riscrivere, uno schizzo da trasformare in diagramma.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequest {
    /// Il meeting da cui parte: le sue note e la trascrizione fanno da contesto.
    meeting_id: Option<String>,
    kind: prompts::AssistKind,
    instruction: String,
    /// Il blocco o il testo su cui lavorare.
    current: Option<String>,
    /// Descrizione del formato Markdown del blocco (solo per `block`).
    format: Option<String>,
    /// Immagine PNG in base64 (solo per `sketch`).
    image: Option<String>,
}

/// Oltre questa dimensione l'immagine non è uno schizzo della lavagna.
const MAX_IMAGE_BASE64: usize = 6 * 1024 * 1024;

#[tauri::command]
pub async fn ai_assist(state: State<'_, AppState>, request: AssistRequest) -> CmdResult<String> {
    use prompts::AssistKind;
    let AssistRequest { meeting_id, kind, instruction, current, format, image } = request;
    if kind != AssistKind::Sketch && instruction.trim().is_empty() {
        return Err(tr("Scrivi cosa chiedere all'AI", "Write what to ask the AI").into());
    }
    let image = match (kind, image) {
        (AssistKind::Sketch, Some(png)) if !png.is_empty() && png.len() <= MAX_IMAGE_BASE64 => Some(png),
        (AssistKind::Sketch, _) => return Err(tr("Lo schizzo è vuoto o troppo grande", "The sketch is empty or too large").into()),
        _ => None,
    };
    let (model, system, user) = {
        let db = state.db.lock();
        let settings = db.get_settings().map_err(err)?;
        // lo schizzo si legge da solo: il meeting non serve
        let context = match meeting_id.as_deref().filter(|_| kind != AssistKind::Sketch) {
            Some(id) => {
                let meeting = db.get_meeting(id).map_err(err)?.ok_or(tr("Meeting non trovato", "Meeting not found"))?;
                let segments = db.segments(id).map_err(err)?;
                Some(prompts::enhance_user(&meeting, None, &segments, &settings.user_name))
            }
            None => None,
        };
        let system = prompts::assist_system(kind, &settings.language, format.as_deref());
        let user = prompts::assist_user(kind, context.as_deref(), instruction.trim(), current.as_deref());
        (resolve_model(&state, &settings, &settings.notes_model)?, system, user)
    };
    let message = llm::Msg::user(user);
    let messages = [match image {
        Some(png) => message.with_image(png),
        None => message,
    }];
    model.check_context(&system, &messages)?;
    let cancel = AtomicBool::new(false);
    let done = llm::stream_message(&state.llm_http, &model.request(&system, &messages, ASSIST_MAX_TOKENS, false), &cancel, |_| {})
        .await
        .map_err(err)?;
    // il formato di un blocco può essere proprio un recinto di codice: lo legge l'editor
    let text = if kind == AssistKind::Block { done.text.trim().to_string() } else { strip_fence(&done.text) };
    if text.is_empty() {
        return Err(tr("L'AI non ha risposto. Riprova.", "The AI gave no answer. Try again.").into());
    }
    Ok(text)
}

/// Toglie il recinto di codice (con qualunque linguaggio) in cui il modello ha chiuso la risposta.
fn strip_fence(s: &str) -> String {
    let t = s.trim();
    let inner = t.strip_prefix("```").and_then(|rest| rest.strip_suffix("```")).and_then(|rest| rest.split_once('\n'));
    match inner {
        Some((_language, body)) => body.trim().to_string(),
        None => t.to_string(),
    }
}

/// Il limite comprende anche il ragionamento del modello, quindi va tenuto largo.
const ASSIST_MAX_TOKENS: u32 = 8_000;
const ENHANCE_MAX_TOKENS: u32 = 16_000;
const MOMENTS_MAX_TOKENS: u32 = 6_000;
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

/// Scarica i calendari attivi la cui copia è scaduta (tutti, con `force`). Ritorna true se
/// ne ha scaricato almeno uno. Un calendario che non risponde non blocca gli altri: tiene i
/// dati vecchi, ricorda l'errore e viene ritentato dopo un minuto.
pub async fn refresh_calendar(state: &AppState, force: bool) -> CmdResult<bool> {
    let calendars = state.db.lock().get_settings().map_err(err)?.calendars;
    let mut cache = state.calendar.lock().await;
    cache.sync(&calendars);
    let stale: Vec<(usize, String)> = cache
        .feeds
        .iter()
        .enumerate()
        .filter(|(_, f)| f.enabled && (force || f.fetched_at.map(|t| t.elapsed() > CAL_TTL).unwrap_or(true)))
        .map(|(i, f)| (i, f.url.clone()))
        .collect();
    let results =
        futures_util::future::join_all(stale.iter().map(|(_, url)| calendar::fetch_ics(&state.http, url))).await;
    let mut downloaded = false;
    for ((i, _), result) in stale.into_iter().zip(results) {
        let feed = &mut cache.feeds[i];
        match result {
            Ok(ics) => {
                feed.ics = Some(ics);
                feed.fetched_at = Some(Instant::now());
                feed.last_error = None;
                downloaded = true;
            }
            Err(e) => {
                log::warn!("calendario \"{}\": {e}", feed.name);
                let retry_in = Duration::from_secs(60);
                feed.fetched_at = Some(Instant::now().checked_sub(CAL_TTL - retry_in).unwrap_or_else(Instant::now));
                feed.last_error = Some(e.to_string());
            }
        }
    }
    Ok(downloaded)
}

pub async fn current_events(state: &AppState) -> Vec<CalendarEvent> {
    let now = chrono::Utc::now();
    let mut events = state
        .calendar
        .lock()
        .await
        .events_between(now - chrono::Duration::hours(12), now + chrono::Duration::days(7));
    let db = state.db.lock();
    for e in events.iter_mut() {
        e.meeting_id = db.meeting_for_event(&e.id).ok().flatten();
    }
    events
}

/// I calendari configurati con il loro stato e i prossimi eventi di quelli attivi.
#[tauri::command]
pub async fn upcoming_events(state: State<'_, AppState>, force: Option<bool>) -> CmdResult<CalendarOverview> {
    refresh_calendar(&state, force.unwrap_or(false)).await?;
    let calendars = state
        .calendar
        .lock()
        .await
        .feeds
        .iter()
        .map(|f| CalendarInfo {
            id: f.id.clone(),
            name: f.name.clone(),
            enabled: f.enabled,
            error: f.last_error.clone().filter(|_| f.enabled),
        })
        .collect();
    Ok(CalendarOverview { calendars, events: current_events(&state).await })
}

/// Attiva o disattiva un calendario senza toccare le altre impostazioni.
#[tauri::command]
pub fn set_calendar_enabled(state: State<AppState>, id: String, enabled: bool) -> CmdResult<()> {
    let db = state.db.lock();
    let mut settings = db.get_settings().map_err(err)?;
    let calendar = settings
        .calendars
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or(tr("Calendario non trovato", "Calendar not found"))?;
    calendar.enabled = enabled;
    db.save_settings(&settings).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn ics(events: &[(&str, &str, &str)]) -> String {
        let mut s = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
        for (uid, title, start) in events {
            s.push_str(&format!(
                "BEGIN:VEVENT\r\nUID:{uid}\r\nSUMMARY:{title}\r\nDTSTART:{start}\r\nDURATION:PT30M\r\nEND:VEVENT\r\n"
            ));
        }
        s.push_str("END:VCALENDAR\r\n");
        s
    }

    fn cal(id: &str, url: &str, enabled: bool) -> Calendar {
        Calendar { id: id.into(), name: id.to_uppercase(), url: url.into(), enabled }
    }

    #[test]
    fn merges_enabled_calendars() {
        let mut cache = CalendarCache::default();
        cache.sync(&[cal("lavoro", "https://e.com/l", true), cal("casa", "https://e.com/c", true)]);
        cache.feeds[0].ics = Some(ics(&[("a", "Standup", "20261118T100000Z"), ("comune", "Pranzo", "20261118T120000Z")]));
        cache.feeds[1].ics = Some(ics(&[("b", "Dentista", "20261118T080000Z"), ("comune", "Pranzo", "20261118T120000Z")]));
        let from = chrono::Utc.with_ymd_and_hms(2026, 11, 18, 0, 0, 0).unwrap();
        let to = from + chrono::Duration::days(1);

        let events = cache.events_between(from, to);
        let got: Vec<(&str, &str)> = events.iter().map(|e| (e.title.as_str(), e.calendar_id.as_str())).collect();
        // in ordine di inizio; l'evento presente in entrambi compare una volta, dal primo calendario
        assert_eq!(got, [("Dentista", "casa"), ("Standup", "lavoro"), ("Pranzo", "lavoro")]);

        // disattivare un calendario toglie i suoi eventi ma non butta quanto scaricato
        cache.sync(&[cal("lavoro", "https://e.com/l", false), cal("casa", "https://e.com/c", true)]);
        let events = cache.events_between(from, to);
        assert!(events.iter().all(|e| e.calendar_id == "casa"));
        assert_eq!(events.len(), 2);
        assert!(cache.feeds[0].ics.is_some());

        // un indirizzo cambiato riparte da zero; un calendario tolto sparisce
        cache.sync(&[cal("casa", "https://e.com/altro", true)]);
        assert_eq!(cache.feeds.len(), 1);
        assert!(cache.feeds[0].ics.is_none());
        assert!(cache.events_between(from, to).is_empty());
    }
}
