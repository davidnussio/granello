//! Cattura audio (microfono + audio di sistema, nativo o da un dispositivo di loopback),
//! suddivisione in blocchi sulle pause e invio alla trascrizione.

use crate::commands::AppState;
use crate::db::Db;
use crate::decode::AudioFile;
use crate::i18n::tr;
use crate::transcribe::{self, TranscriberCache};
use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample as _;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const MIN_CHUNK_SECS: f32 = 6.0;
const MAX_CHUNK_SECS: f32 = 20.0;
const TAIL_SECS: f32 = 0.5;
const SILENCE_RMS: f32 = 0.0025;
/// Dopo quanto tempo di silenzio digitale assoluto si avvisa l'utente (permessi, mute hardware).
const DEAD_MIC_SECS: u64 = 8;
/// Blocchi di un file caricato che possono aspettare la trascrizione: la decodifica è molto
/// più veloce di whisper e senza un limite l'intero file finirebbe in memoria.
const IMPORT_QUEUE: usize = 4;

/// Primo errore segnalato da uno stream cpal (es. dispositivo scollegato).
type StreamError = Arc<Mutex<Option<String>>>;

/// Valore di `system_device` che indica l'audio in uscita dal computer, catturato senza
/// dispositivi di loopback (process tap di Core Audio su macOS 14.6+, WASAPI su Windows, la
/// sorgente monitor di PulseAudio o PipeWire su Linux).
pub const SYSTEM_AUDIO: &str = "@system";

fn device_name(d: &cpal::Device) -> Option<String> {
    d.description().ok().map(|desc| desc.name().to_string())
}

pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Some(n) = device_name(&d) {
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
    }
    names
}

fn find_device(name: Option<&str>) -> Result<cpal::Device> {
    let host = cpal::default_host();
    match name.filter(|n| !n.is_empty()) {
        None => host
            .default_input_device()
            .ok_or_else(|| tra!("nessun microfono disponibile", "no microphone available")),
        Some(n) => host
            .input_devices()?
            .find(|d| device_name(d).is_some_and(|dn| dn == n))
            .ok_or_else(|| tra!("dispositivo audio \"{n}\" non trovato", "audio device \"{n}\" not found")),
    }
}

/// Apre il dispositivo di input `name` (`None` = microfono predefinito).
fn open_input(name: Option<&str>, buf: Arc<Mutex<Vec<f32>>>, error: StreamError) -> Result<(cpal::Stream, u32)> {
    let device = find_device(name)?;
    let config = device.default_input_config().context("config input")?;
    open_stream(&device, config, buf, error)
}

/// L'uscita audio predefinita del computer, se c'è.
fn default_output_id() -> Option<cpal::DeviceId> {
    cpal::default_host().default_output_device().and_then(|d| d.id().ok())
}

/// Su Linux l'audio di sistema è la sorgente "monitor" dell'uscita predefinita, che PulseAudio
/// (e PipeWire, che ne parla il protocollo) chiama come l'uscita più `.monitor`.
#[cfg(target_os = "linux")]
fn open_system_audio(buf: Arc<Mutex<Vec<f32>>>, error: StreamError) -> Result<(cpal::Stream, u32)> {
    let host = cpal::default_host();
    if host.id() != cpal::HostId::PulseAudio {
        return Err(tra!(
            "per catturare l'audio di sistema serve PulseAudio o PipeWire: in alternativa scegli come sorgente un dispositivo \"Monitor\"",
            "capturing system audio needs PulseAudio or PipeWire: otherwise pick a \"Monitor\" device as the source"
        ));
    }
    let sink = host
        .default_output_device()
        .ok_or_else(|| tra!("nessuna uscita audio disponibile", "no audio output available"))?;
    let monitor = format!("{}.monitor", sink.id().context("id dell'uscita")?.id());
    let device = host
        .input_devices()?
        .find(|d| d.id().is_ok_and(|id| id.id() == monitor))
        .ok_or_else(|| {
            tra!(
                "l'uscita audio predefinita non ha una sorgente monitor: scegli come sorgente un dispositivo \"Monitor\"",
                "the default audio output has no monitor source: pick a \"Monitor\" device as the source"
            )
        })?;
    let config = device.default_input_config().context("config monitor")?;
    open_stream(&device, config, buf, error)
}

/// Apre in ascolto l'uscita audio predefinita: quello che il computer sta riproducendo
/// (le voci degli altri in Teams, Zoom, Meet…), senza dispositivi di loopback.
#[cfg(not(target_os = "linux"))]
fn open_system_audio(buf: Arc<Mutex<Vec<f32>>>, error: StreamError) -> Result<(cpal::Stream, u32)> {
    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| tra!("nessuna uscita audio disponibile", "no audio output available"))?;
    // Su macOS cpal ascolta l'uscita solo se il dispositivo non ha anche un ingresso:
    // altrimenti aprirebbe il suo microfono, registrando la cosa sbagliata senza dirlo.
    #[cfg(target_os = "macos")]
    if device.supports_input() {
        let label = device_name(&device).unwrap_or_default();
        return Err(tra!(
            "non riesco a catturare l'audio di sistema dall'uscita \"{label}\": scegli un'altra uscita audio per la call",
            "cannot capture system audio from the \"{label}\" output: pick another audio output for the call"
        ));
    }
    let config = device.default_output_config().context("config output")?;
    open_stream(&device, config, buf, error).map_err(|e| {
        if cfg!(target_os = "macos") {
            tra!(
                "cattura dell'audio di sistema non riuscita ({e}). Serve macOS 14.6 o successivo e il permesso in Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo e audio di sistema.",
                "could not capture system audio ({e}). It needs macOS 14.6 or later and the permission in System Settings → Privacy & Security → Screen & System Audio Recording."
            )
        } else {
            tra!(
                "cattura dell'audio di sistema non riuscita ({e}): scegli un'altra uscita audio per la call",
                "could not capture system audio ({e}): pick another audio output for the call"
            )
        }
    })
}

/// Apre la sorgente degli altri partecipanti: l'audio di sistema o un dispositivo di input.
fn open_others(name: &str, buf: Arc<Mutex<Vec<f32>>>, error: StreamError) -> Result<(cpal::Stream, u32)> {
    if name == SYSTEM_AUDIO {
        open_system_audio(buf, error)
    } else {
        open_input(Some(name), buf, error)
    }
}

/// Apre su `device` uno stream che scrive campioni mono f32 in `buf`.
fn open_stream(
    device: &cpal::Device,
    supported: cpal::SupportedStreamConfig,
    buf: Arc<Mutex<Vec<f32>>>,
    error: StreamError,
) -> Result<(cpal::Stream, u32)> {
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.config();
    let label = device_name(device).unwrap_or_else(|| tr("dispositivo audio", "audio device").into());
    let err_fn = move |e: cpal::Error| {
        // solo un dispositivo che sparisce ferma la cattura: il resto (xrun, priorità
        // realtime negata, cambio dell'uscita predefinita) è un avviso
        if !matches!(e.kind(), cpal::ErrorKind::DeviceNotAvailable | cpal::ErrorKind::StreamInvalidated) {
            log::warn!("stream audio ({label}): {e}");
            return;
        }
        log::error!("errore stream audio ({label}): {e}");
        let mut slot = error.lock();
        if slot.is_none() {
            *slot = Some(match e.kind() {
                cpal::ErrorKind::DeviceNotAvailable => trf!("\"{label}\" non è più disponibile", "\"{label}\" is no longer available"),
                _ => format!("{label}: {e}"),
            });
        }
    };

    fn build<T>(
        device: &cpal::Device,
        config: cpal::StreamConfig,
        channels: usize,
        buf: Arc<Mutex<Vec<f32>>>,
        err_fn: impl FnMut(cpal::Error) + Send + 'static,
    ) -> Result<cpal::Stream, cpal::Error>
    where
        T: cpal::SizedSample,
        f32: cpal::FromSample<T>,
    {
        device.build_input_stream(
            config,
            move |data: &[T], _: &_| {
                let mut b = buf.lock();
                for frame in data.chunks(channels.max(1)) {
                    let sum: f32 = frame.iter().map(|s| f32::from_sample(*s)).sum();
                    b.push(sum / frame.len() as f32);
                }
            },
            err_fn,
            None,
        )
    }

    use cpal::SampleFormat as F;
    let stream = match supported.sample_format() {
        F::F32 => build::<f32>(device, config, channels, buf, err_fn)?,
        F::I8 => build::<i8>(device, config, channels, buf, err_fn)?,
        F::I16 => build::<i16>(device, config, channels, buf, err_fn)?,
        F::I24 => build::<cpal::I24>(device, config, channels, buf, err_fn)?,
        F::I32 => build::<i32>(device, config, channels, buf, err_fn)?,
        F::U8 => build::<u8>(device, config, channels, buf, err_fn)?,
        F::U16 => build::<u16>(device, config, channels, buf, err_fn)?,
        f => return Err(tra!("formato audio non supportato: {f:?}", "unsupported audio format: {f:?}")),
    };
    stream.play()?;
    Ok((stream, rate))
}

pub struct Chunk {
    pub source: &'static str,
    pub start_ms: i64,
    pub samples: Vec<f32>,
}

/// Accumula l'audio di una sorgente e lo taglia sulle pause.
pub struct Chunker {
    source: &'static str,
    rate: u32,
    shared: Arc<Mutex<Vec<f32>>>,
    pending: Vec<f32>,
    consumed: u64,
    base_ms: i64,
}

impl Chunker {
    pub fn new(source: &'static str, rate: u32, shared: Arc<Mutex<Vec<f32>>>, base_ms: i64) -> Self {
        Self { source, rate, shared, pending: Vec::new(), consumed: 0, base_ms }
    }

    /// Ritorna il livello (RMS) dell'audio nuovo ed eventualmente un blocco pronto.
    pub fn poll(&mut self, force: bool) -> (f32, Option<Chunk>) {
        let fresh = std::mem::take(&mut *self.shared.lock());
        let level = transcribe::rms(&fresh);
        self.pending.extend_from_slice(&fresh);

        let rate = self.rate as f32;
        let dur = self.pending.len() as f32 / rate;
        let cut_at = if force {
            if dur > 0.3 { Some(self.pending.len()) } else { None }
        } else if dur >= MAX_CHUNK_SECS {
            // nessuna pausa: taglia nel punto più silenzioso degli ultimi 4 secondi
            Some(self.quietest_cut(4.0))
        } else if dur >= MIN_CHUNK_SECS {
            let tail_len = (TAIL_SECS * rate) as usize;
            let tail = &self.pending[self.pending.len() - tail_len..];
            let overall = transcribe::rms(&self.pending);
            if transcribe::rms(tail) < (overall * 0.3).max(SILENCE_RMS) {
                Some(self.pending.len())
            } else {
                None
            }
        } else {
            None
        };

        let chunk = cut_at.and_then(|at| {
            let rest = self.pending.split_off(at);
            let samples = std::mem::replace(&mut self.pending, rest);
            let start_ms = self.base_ms + (self.consumed as f64 * 1000.0 / self.rate as f64) as i64;
            self.consumed += samples.len() as u64;
            if transcribe::rms(&samples) < SILENCE_RMS {
                return None; // solo silenzio
            }
            Some(Chunk {
                source: self.source,
                start_ms,
                samples: transcribe::resample_to_16k(&samples, self.rate),
            })
        });
        (level, chunk)
    }

    fn quietest_cut(&self, window_secs: f32) -> usize {
        let rate = self.rate as usize;
        let win = rate / 10; // finestre da 100 ms
        let len = self.pending.len();
        let from = len.saturating_sub((window_secs * self.rate as f32) as usize);
        let mut best = (f32::MAX, len);
        let mut i = from;
        while i + win <= len {
            let r = transcribe::rms(&self.pending[i..i + win]);
            if r < best.0 {
                best = (r, i + win / 2);
            }
            i += win;
        }
        best.1
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelEvent {
    meeting_id: String,
    mic: f32,
    system: Option<f32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent {
    meeting_id: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressEvent {
    meeting_id: String,
    /// Audio del file già trascritto.
    done_ms: i64,
    /// Durata del file, se dichiarata.
    total_ms: Option<i64>,
}

/// Comandi per il thread che produce l'audio di una sessione.
enum Control {
    Stop,
    /// Cambia al volo il dispositivo degli altri partecipanti (`None` = solo microfono).
    SystemDevice(Option<String>),
}

pub struct SessionConfig {
    pub meeting_id: String,
    pub mic_device: Option<String>,
    pub system_device: Option<String>,
    pub language: String,
    pub model_path: PathBuf,
    pub prompt: String,
    pub base_ms: i64,
    /// Se presente, l'audio della registrazione dal vivo viene anche scritto in questo file,
    /// per l'affinamento online a fine riunione (vedi `keep`). Il numero è il punto del
    /// meeting (ms) a cui corrisponde l'inizio del file.
    pub keep_audio: Option<(PathBuf, i64)>,
    /// Se presente, la sessione viene salvata come registrazione da riascoltare.
    pub save_recording: Option<SaveRecording>,
    /// Chi sta parlando al microfono, nel tempo (vedi `Speakers`).
    pub speakers: Speakers,
}

/// Chi parla al microfono quando più persone usano lo stesso computer: ogni cambio è il punto
/// del meeting (ms) da cui vale e il nome. Prima del primo cambio, e con "me", è l'utente.
#[derive(Clone, Default)]
pub struct Speakers(Arc<Mutex<Vec<(i64, String)>>>);

impl Speakers {
    /// Da `at_ms` in poi al microfono c'è `name` ("me" per l'utente).
    pub fn switch(&self, at_ms: i64, name: &str) {
        self.0.lock().push((at_ms, name.to_string()));
    }

    /// A chi va attribuito ciò che il microfono ha sentito al punto `at_ms`.
    pub fn at(&self, at_ms: i64) -> String {
        let list = self.0.lock();
        list.iter().rev().find(|(from, _)| *from <= at_ms).map(|(_, name)| name.clone()).unwrap_or_else(|| "me".into())
    }
}

/// Dove salvare la registrazione di una sessione e come chiuderla.
#[derive(Clone)]
pub struct SaveRecording {
    /// Riga della registrazione nel database.
    pub id: i64,
    pub path: PathBuf,
    /// Alla fine toglie le pause senza audio.
    pub trim: bool,
}

pub struct Session {
    pub meeting_id: String,
    stop_tx: mpsc::Sender<Control>,
    audio_thread: Option<JoinHandle<()>>,
    transcribe_thread: Option<JoinHandle<()>>,
    pub pending: Arc<AtomicUsize>,
    /// true se l'audio arriva da un file caricato invece che dai dispositivi.
    pub importing: bool,
    /// Da dove riparte il tempo del meeting e quando è partita la cattura.
    base_ms: i64,
    started: Instant,
    speakers: Speakers,
}

/// Come finisce il thread di trascrizione di un file caricato.
struct ImportInfo {
    total_ms: Option<i64>,
}

/// Una trascrizione al lavoro, contata in `AppState::working` finché esiste.
struct Active(Arc<AtomicUsize>);

impl Active {
    fn start(count: Arc<AtomicUsize>) -> Active {
        count.fetch_add(1, Ordering::SeqCst);
        Active(count)
    }
}

impl Drop for Active {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Thread che trascrive i blocchi in arrivo e salva i segmenti. Finisce quando la coda viene
/// chiusa: a quel punto chiude il meeting ed emette `recording-finished`.
fn spawn_transcriber(
    app: AppHandle,
    db: Arc<Mutex<Db>>,
    cache: Arc<TranscriberCache>,
    cfg: &SessionConfig,
    pending: Arc<AtomicUsize>,
    chunk_rx: mpsc::Receiver<Chunk>,
    import: Option<ImportInfo>,
) -> std::io::Result<JoinHandle<()>> {
    let meeting_id = cfg.meeting_id.clone();
    let language = cfg.language.clone();
    let prompt = cfg.prompt.clone();
    let model_path = cfg.model_path.clone();
    let base_ms = cfg.base_ms;
    // solo dal vivo: di un file caricato esiste già l'originale
    let keep_audio = cfg.keep_audio.clone().filter(|_| import.is_none());
    // anche un file caricato diventa una registrazione da riascoltare (solo l'audio, se è un video)
    let save_recording = cfg.save_recording.clone();
    let speakers = cfg.speakers.clone();
    // finché il thread lavora l'app risulta occupata: niente cambio di vault a metà
    let active = Active::start(app.state::<AppState>().working.clone());
    std::thread::Builder::new().name("granello-transcribe".into()).spawn(move || {
        let _active = active;
        let mut keeper = keep_audio.and_then(|(path, origin)| {
            let keeper = crate::keep::Keeper::open(&path).map_err(|e| log::error!("audio conservato: {e}")).ok()?;
            Some((keeper, origin))
        });
        let mut recorder = save_recording.as_ref().and_then(|r| {
            crate::keep::Keeper::open(&r.path).map_err(|e| log::error!("registrazione: {e}")).ok()
        });
        for chunk in chunk_rx {
            if let Some((k, origin)) = keeper.as_mut() {
                if let Err(e) = k.add(chunk.start_ms - *origin, &chunk.samples) {
                    log::error!("audio conservato: {e}");
                }
            }
            // la registrazione salvata parte da zero, non dal punto del meeting in cui si riprende
            if let Some(k) = recorder.as_mut() {
                if let Err(e) = k.add(chunk.start_ms - base_ms, &chunk.samples) {
                    log::error!("registrazione: {e}");
                }
            }
            let res = cache
                .get(&model_path)
                .and_then(|t| t.transcribe(&chunk.samples, &language, &prompt));
            match res {
                Ok(segs) => {
                    for s in segs {
                        // il microfono può essere di più persone: vale chi era indicato in quel momento
                        let who = if chunk.source == "me" { speakers.at(chunk.start_ms + s.start_ms) } else { chunk.source.to_string() };
                        let saved = db.lock().add_segment(
                            &meeting_id,
                            &who,
                            chunk.start_ms + s.start_ms,
                            chunk.start_ms + s.end_ms.max(s.start_ms),
                            &s.text,
                        );
                        match saved {
                            Ok(seg) => {
                                let _ = app.emit("transcript-segment", seg);
                            }
                            Err(e) => log::error!("salvataggio segmento: {e}"),
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit(
                        "transcription-error",
                        ErrorEvent { meeting_id: meeting_id.clone(), message: e.to_string() },
                    );
                }
            }
            pending.fetch_sub(1, Ordering::SeqCst);
            if let Some(info) = &import {
                let chunk_ms = chunk.samples.len() as i64 * 1000 / transcribe::SAMPLE_RATE as i64;
                let _ = app.emit(
                    "import-progress",
                    ImportProgressEvent {
                        meeting_id: meeting_id.clone(),
                        done_ms: chunk.start_ms - base_ms + chunk_ms,
                        total_ms: info.total_ms,
                    },
                );
            }
        }
        // canale chiuso: registrazione terminata e coda svuotata
        if let Err(e) = db.lock().mark_ended(&meeting_id) {
            log::error!("chiusura meeting {meeting_id}: {e}");
        }
        drop(keeper);
        // il file della registrazione va chiuso prima di comprimerlo
        drop(recorder);
        if let Some(r) = save_recording {
            let saved = match crate::recordings::finalize(&r.path, r.trim) {
                Some(f) => db.lock().update_recording(r.id, &f.path.to_string_lossy(), f.duration_ms, f.bytes as i64, f.trimmed),
                // niente audio: non resta nemmeno la riga
                None => db.lock().delete_recording(r.id),
            };
            if let Err(e) = saved {
                log::error!("registrazione di {meeting_id}: {e}");
            }
        }
        if import.is_some() {
            // un file finisce da solo, senza uno stop: la sessione va liberata qui.
            // Solo se è ancora la nostra: dopo un annullamento potrebbe essercene un'altra.
            let state = app.state::<AppState>();
            let mut slot = state.session.lock();
            let ours = slot.as_ref().is_some_and(|s| Arc::ptr_eq(&s.pending, &pending));
            let finished = if ours { slot.take() } else { None };
            drop(slot);
            drop(finished);
        }
        let _ = app.emit("recording-finished", meeting_id.clone());
    })
}

impl Session {
    pub fn start(
        app: AppHandle,
        db: Arc<Mutex<Db>>,
        cache: Arc<TranscriberCache>,
        cfg: SessionConfig,
    ) -> Result<Self> {
        // Carica il modello subito: meglio fallire ora che a meeting in corso.
        cache.get(&cfg.model_path)?;

        let (stop_tx, stop_rx) = mpsc::channel::<Control>();
        let (chunk_tx, chunk_rx) = mpsc::channel::<Chunk>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        let pending = Arc::new(AtomicUsize::new(0));

        let transcribe_thread =
            spawn_transcriber(app.clone(), db, cache, &cfg, pending.clone(), chunk_rx, None)?;

        // ---- thread audio (gli stream cpal non sono Send: vivono qui) ----
        let audio_thread = {
            let app = app.clone();
            let pending = pending.clone();
            let meeting_id = cfg.meeting_id.clone();
            let mic_name = cfg.mic_device.clone();
            let sys_name = cfg.system_device.clone();
            let base_ms = cfg.base_ms;
            std::thread::Builder::new()
                .name("granello-audio".into())
                .spawn(move || {
                    let mic_buf = Arc::new(Mutex::new(Vec::<f32>::new()));
                    let sys_buf = Arc::new(Mutex::new(Vec::<f32>::new()));
                    let stream_error: StreamError = Arc::new(Mutex::new(None));
                    // gli errori della sorgente degli altri sono a parte: se è l'audio di
                    // sistema si riapre (es. cuffie scollegate) invece di chiudere il meeting
                    let sys_error: StreamError = Arc::new(Mutex::new(None));

                    let (mic_stream, mic_rate) =
                        match open_input(mic_name.as_deref(), mic_buf.clone(), stream_error.clone()) {
                            Ok(v) => v,
                            Err(e) => {
                                let _ = ready_tx.send(Err(e));
                                return;
                            }
                        };
                    let mut sys_name = sys_name.filter(|n| !n.is_empty());
                    let mut sys = match sys_name.as_deref() {
                        Some(n) => match open_others(n, sys_buf.clone(), sys_error.clone()) {
                            Ok(v) => Some(v),
                            Err(e) => {
                                let _ = ready_tx.send(Err(e));
                                return;
                            }
                        },
                        None => None,
                    };
                    // l'uscita che stiamo ascoltando: se cambia (cuffie collegate a metà
                    // call) l'audio di sistema va riaperto su quella nuova
                    let mut sys_output = default_output_id();
                    let mut ticks = 0u32;
                    let _ = ready_tx.send(Ok(()));

                    let mut chunkers = vec![Chunker::new("me", mic_rate, mic_buf, base_ms)];
                    if let Some((_, rate)) = &sys {
                        chunkers.push(Chunker::new("them", *rate, sys_buf, base_ms));
                    }

                    let started = Instant::now();
                    let mut mic_peak = 0.0f32;
                    let mut warned_dead_mic = false;
                    loop {
                        let mut switch_to = None;
                        let stop_requested = match stop_rx.recv_timeout(Duration::from_millis(200)) {
                            Err(mpsc::RecvTimeoutError::Timeout) => false,
                            Ok(Control::SystemDevice(name)) => {
                                switch_to = Some(name);
                                false
                            }
                            Ok(Control::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => true,
                        };
                        ticks = ticks.wrapping_add(1);
                        if switch_to.is_none() && sys_name.as_deref() == Some(SYSTEM_AUDIO) {
                            let failed = sys_error.lock().take();
                            if failed.is_some() || (ticks.is_multiple_of(10) && default_output_id() != sys_output) {
                                log::info!("uscita audio cambiata: riapro l'audio di sistema");
                                switch_to = Some(sys_name.clone());
                            }
                        }
                        if let Some(name) = switch_to {
                            // chiude la sorgente attuale consegnando l'audio già catturato...
                            if chunkers.len() > 1 {
                                if let (_, Some(chunk)) = chunkers[1].poll(true) {
                                    pending.fetch_add(1, Ordering::SeqCst);
                                    if chunk_tx.send(chunk).is_err() {
                                        pending.fetch_sub(1, Ordering::SeqCst);
                                    }
                                }
                                chunkers.truncate(1);
                            }
                            sys = None;
                            sys_error.lock().take();
                            sys_name = name.filter(|n| !n.is_empty());
                            sys_output = default_output_id();
                            // ...e apre quella nuova, che parte dal punto in cui siamo arrivati
                            if let Some(n) = sys_name.as_deref() {
                                let buf = Arc::new(Mutex::new(Vec::<f32>::new()));
                                match open_others(n, buf.clone(), sys_error.clone()) {
                                    Ok(v) => {
                                        let now_ms = base_ms + started.elapsed().as_millis() as i64;
                                        chunkers.push(Chunker::new("them", v.1, buf, now_ms));
                                        sys = Some(v);
                                    }
                                    Err(e) => {
                                        log::warn!("cambio del dispositivo degli altri: {e}");
                                        let _ = app.emit(
                                            "recording-warning",
                                            ErrorEvent { meeting_id: meeting_id.clone(), message: e.to_string() },
                                        );
                                    }
                                }
                            }
                        }
                        // Un dispositivo scollegato a metà meeting chiude la sessione in modo
                        // pulito: l'audio già catturato viene comunque trascritto.
                        let fatal = stream_error.lock().take().or_else(|| sys_error.lock().take());
                        let stop = stop_requested || fatal.is_some();
                        let mut levels = Vec::new();
                        for c in chunkers.iter_mut() {
                            let (level, chunk) = c.poll(stop);
                            levels.push(level);
                            if let Some(chunk) = chunk {
                                pending.fetch_add(1, Ordering::SeqCst);
                                if chunk_tx.send(chunk).is_err() {
                                    pending.fetch_sub(1, Ordering::SeqCst);
                                }
                            }
                        }
                        let _ = app.emit(
                            "audio-level",
                            LevelEvent {
                                meeting_id: meeting_id.clone(),
                                mic: levels[0],
                                system: levels.get(1).copied(),
                            },
                        );
                        mic_peak = mic_peak.max(levels[0]);
                        if !warned_dead_mic && mic_peak == 0.0 && started.elapsed().as_secs() >= DEAD_MIC_SECS {
                            warned_dead_mic = true;
                            log::warn!("nessun segnale dal microfono dopo {DEAD_MIC_SECS}s");
                            let _ = app.emit(
                                "recording-warning",
                                ErrorEvent {
                                    meeting_id: meeting_id.clone(),
                                    message: tr(
                                        "Nessun segnale dal microfono. Controlla che Granello abbia il permesso \
in Impostazioni di Sistema → Privacy e sicurezza → Microfono e che il microfono non sia disattivato.",
                                        "No signal from the microphone. Check that Granello is allowed in \
System Settings → Privacy & Security → Microphone and that the microphone is not muted.",
                                    )
                                    .into(),
                                },
                            );
                        }
                        if let Some(message) = fatal {
                            let _ = app.emit(
                                "recording-error",
                                ErrorEvent { meeting_id: meeting_id.clone(), message },
                            );
                        }
                        if stop {
                            break;
                        }
                    }
                    drop(mic_stream);
                    drop(sys);
                    drop(chunk_tx); // chiude la coda: il thread di trascrizione finisce
                })?
        };

        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(tra!("timeout nell'apertura dei dispositivi audio", "timed out opening the audio devices")),
        }

        Ok(Self {
            speakers: cfg.speakers.clone(),
            meeting_id: cfg.meeting_id,
            stop_tx,
            audio_thread: Some(audio_thread),
            transcribe_thread: Some(transcribe_thread),
            pending,
            importing: false,
            base_ms: cfg.base_ms,
            started: Instant::now(),
        })
    }

    /// Trascrive un file audio al posto della cattura live. Il file viene decodificato a
    /// blocchi e tagliato sulle pause come l'audio del microfono; la sessione si chiude da
    /// sola alla fine del file (`recording-finished`) oppure prima, con `stop`.
    pub fn start_import(
        app: AppHandle,
        db: Arc<Mutex<Db>>,
        cache: Arc<TranscriberCache>,
        cfg: SessionConfig,
        path: &Path,
    ) -> Result<Self> {
        cache.get(&cfg.model_path)?;
        let mut file = AudioFile::open(path)?;

        let (stop_tx, stop_rx) = mpsc::channel::<Control>();
        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Chunk>(IMPORT_QUEUE);
        let pending = Arc::new(AtomicUsize::new(0));
        let import = ImportInfo { total_ms: file.total_ms };
        let transcribe_thread =
            spawn_transcriber(app.clone(), db, cache, &cfg, pending.clone(), chunk_rx, Some(import))?;

        let decode_thread = {
            let pending = pending.clone();
            let meeting_id = cfg.meeting_id.clone();
            let base_ms = cfg.base_ms;
            std::thread::Builder::new().name("granello-import".into()).spawn(move || {
                let send = |chunk: Chunk| {
                    pending.fetch_add(1, Ordering::SeqCst);
                    // si blocca finché la trascrizione non fa posto in coda
                    if chunk_tx.send(chunk).is_err() {
                        pending.fetch_sub(1, Ordering::SeqCst);
                    }
                };
                let stopped = || !matches!(stop_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
                if let Err(e) = chunk_file(&mut file, base_ms, stopped, send) {
                    log::error!("file audio di {meeting_id}: {e}");
                    let _ = app.emit(
                        "transcription-error",
                        ErrorEvent { meeting_id: meeting_id.clone(), message: e.to_string() },
                    );
                }
                // chiude la coda: il thread di trascrizione finisce
            })?
        };

        Ok(Self {
            speakers: cfg.speakers.clone(),
            meeting_id: cfg.meeting_id,
            stop_tx,
            audio_thread: Some(decode_thread),
            transcribe_thread: Some(transcribe_thread),
            pending,
            importing: true,
            base_ms: cfg.base_ms,
            started: Instant::now(),
        })
    }

    /// A che punto del meeting (ms) è la registrazione dal vivo, sulla stessa scala dei
    /// segmenti della trascrizione. `None` mentre si trascrive un file: lì non c'è un "adesso".
    pub fn position_ms(&self) -> Option<i64> {
        (!self.importing).then(|| self.base_ms + self.started.elapsed().as_millis() as i64)
    }

    /// Da adesso al microfono parla `name` ("me" per l'utente). Non vale per un file caricato.
    pub fn set_speaker(&self, name: &str) {
        if let Some(now) = self.position_ms() {
            // chi cambia nome lo fa appena l'altro comincia: si torna indietro di un attimo
            self.speakers.switch(now - 700, name);
        }
    }

    /// Ferma la cattura. La trascrizione dei blocchi in coda continua in background
    /// e termina con l'evento `recording-finished`.
    pub fn stop(mut self) {
        self.stop_capture();
    }

    /// Cambia il dispositivo degli altri partecipanti a registrazione in corso.
    /// Non ha effetto mentre si trascrive un file.
    pub fn set_system_device(&self, name: Option<String>) {
        if !self.importing {
            let _ = self.stop_tx.send(Control::SystemDevice(name));
        }
    }

    fn stop_capture(&mut self) {
        let _ = self.stop_tx.send(Control::Stop);
        if let Some(h) = self.audio_thread.take() {
            let _ = h.join();
        }
    }

    /// Ferma la cattura e aspetta (al massimo `timeout`) che la coda di trascrizione
    /// si svuoti. Usato alla chiusura dell'app per non perdere l'ultima parte del meeting.
    /// Ritorna false se il tempo è scaduto con blocchi ancora da trascrivere.
    pub fn finish(mut self, timeout: Duration) -> bool {
        self.stop_capture();
        let Some(h) = self.transcribe_thread.take() else { return true };
        let deadline = Instant::now() + timeout;
        while !h.is_finished() {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = h.join();
        true
    }
}

/// Decodifica `file` fino alla fine e consegna a `send` i blocchi tagliati sulle pause, come
/// per l'audio dal vivo. Se `stopped` diventa vero si interrompe subito, senza l'ultimo blocco.
/// Un file che da un certo punto in poi è illeggibile consegna comunque la parte già letta.
fn chunk_file(
    file: &mut AudioFile,
    base_ms: i64,
    stopped: impl Fn() -> bool,
    mut send: impl FnMut(Chunk),
) -> Result<()> {
    let shared = Arc::new(Mutex::new(Vec::<f32>::new()));
    let mut chunker: Option<Chunker> = None;
    let mut fresh = Vec::<f32>::new();
    let mut failure = None;
    loop {
        if stopped() {
            return Ok(());
        }
        let block = match file.next_block() {
            Ok(Some(b)) => b,
            Ok(None) => break,
            Err(e) => {
                failure = Some(e);
                break;
            }
        };
        let chunker =
            chunker.get_or_insert_with(|| Chunker::new("file", block.rate, shared.clone(), base_ms));
        fresh.extend(block.samples);
        // mezzo secondo alla volta, come farebbe un dispositivo: il Chunker cerca una pausa
        // a ogni passo
        let step = (block.rate as usize / 2).max(1);
        while fresh.len() >= step {
            shared.lock().extend(fresh.drain(..step));
            if let (_, Some(chunk)) = chunker.poll(false) {
                send(chunk);
            }
        }
    }
    match chunker.as_mut() {
        Some(chunker) => {
            shared.lock().extend(fresh);
            if let (_, Some(chunk)) = chunker.poll(true) {
                send(chunk);
            }
        }
        None if failure.is_none() => {
            return Err(tra!("Il file non contiene audio.", "The file contains no audio."));
        }
        None => {}
    }
    failure.map_or(Ok(()), Err)
}

/// Oltre questa durata una dettatura si ferma da sola: è una richiesta, non una riunione.
const DICTATION_MAX: Duration = Duration::from_secs(90);

/// Una breve registrazione dal microfono per dettare una richiesta, indipendente dalla
/// registrazione del meeting (che può essere in corso sullo stesso microfono).
pub struct Dictation {
    stop_tx: mpsc::Sender<()>,
    thread: JoinHandle<(u32, Vec<f32>)>,
}

impl Dictation {
    pub fn start(mic: Option<String>) -> Result<Self> {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        // gli stream cpal non sono Send: lo stream vive nel suo thread
        let thread = std::thread::Builder::new().name("granello-dictation".into()).spawn(move || {
            let buf = Arc::new(Mutex::new(Vec::new()));
            let opened = open_input(mic.as_deref(), buf.clone(), Default::default());
            let (stream, rate) = match opened {
                Ok(ok) => ok,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return (0, Vec::new());
                }
            };
            let _ = ready_tx.send(Ok(()));
            // finisce con lo stop, se chi ascoltava se ne va, o allo scadere del tempo
            let _ = stop_rx.recv_timeout(DICTATION_MAX);
            drop(stream);
            let samples = std::mem::take(&mut *buf.lock());
            (rate, samples)
        })?;
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => Ok(Self { stop_tx, thread }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(tra!("timeout nell'apertura dei dispositivi audio", "timed out opening the audio devices")),
        }
    }

    /// Ferma la registrazione e ritorna l'audio a 16 kHz, pronto per whisper.
    pub fn stop(self) -> Vec<f32> {
        let _ = self.stop_tx.send(());
        let (rate, samples) = self.thread.join().unwrap_or_default();
        if rate == 0 {
            return Vec::new();
        }
        transcribe::resample_to_16k(&samples, rate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32, rate: u32, amp: f32) -> Vec<f32> {
        (0..(secs * rate as f32) as usize)
            .map(|i| amp * (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / rate as f32).sin())
            .collect()
    }

    #[test]
    fn cuts_on_pause() {
        let shared = Arc::new(Mutex::new(Vec::new()));
        let mut c = Chunker::new("me", 48_000, shared.clone(), 1000);
        shared.lock().extend(tone(7.0, 48_000, 0.3));
        let (_, chunk) = c.poll(false);
        assert!(chunk.is_none(), "nessuna pausa, sotto il massimo");
        shared.lock().extend(vec![0.0; 48_000]); // 1s di silenzio
        let (_, chunk) = c.poll(false);
        let chunk = chunk.expect("taglio sulla pausa");
        assert_eq!(chunk.start_ms, 1000);
        let speakers = Speakers::default();
        assert_eq!(speakers.at(5000), "me");
        speakers.switch(10_000, "Marco");
        speakers.switch(20_000, "me");
        assert_eq!((speakers.at(9_999), speakers.at(10_000), speakers.at(19_000), speakers.at(25_000)), ("me".into(), "Marco".into(), "Marco".into(), "me".into()));
        assert_eq!(chunk.samples.len(), 8 * 16_000);
        // blocco successivo parte dopo 8 secondi
        shared.lock().extend(tone(2.0, 48_000, 0.3));
        let (_, chunk) = c.poll(true);
        assert_eq!(chunk.unwrap().start_ms, 9000);
    }

    /// WAV mono PCM 16 bit.
    fn wav_file(name: &str, rate: u32, samples: &[f32]) -> PathBuf {
        let data_len = samples.len() as u32 * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            out.extend_from_slice(&((s * i16::MAX as f32) as i16).to_le_bytes());
        }
        let path = std::env::temp_dir().join(format!("granello-{}-{name}", std::process::id()));
        std::fs::write(&path, out).unwrap();
        path
    }

    #[test]
    fn chunks_a_file_on_pauses() {
        // 8s di voce, 2s di pausa, 30s senza pause, 3s di silenzio, 3s di voce
        let rate = 44_100;
        let mut samples = tone(8.0, rate, 0.3);
        samples.extend(vec![0.0; 2 * rate as usize]);
        samples.extend(tone(30.0, rate, 0.3));
        samples.extend(vec![0.0; 3 * rate as usize]);
        samples.extend(tone(3.0, rate, 0.3));
        let path = wav_file("pause.wav", rate, &samples);

        let mut chunks = Vec::new();
        let mut file = AudioFile::open(&path).unwrap();
        chunk_file(&mut file, 5000, || false, |c| chunks.push(c)).unwrap();
        assert!(chunks.len() >= 4, "{} blocchi", chunks.len());
        assert!(chunks.iter().all(|c| c.source == "file"));
        // in coda alla trascrizione esistente, nell'ordine del file
        assert_eq!(chunks[0].start_ms, 5000);
        assert!(chunks.windows(2).all(|w| w[0].start_ms < w[1].start_ms));
        // nessun blocco oltre il massimo (più il margine di mezzo secondo del passo)
        let longest = chunks.iter().map(|c| c.samples.len()).max().unwrap();
        assert!(longest <= 21 * 16_000, "blocco di {longest} campioni");
        // salvati come registrazione, i blocchi ricostruiscono il file sulla sua linea del tempo:
        // le pause tornano silenzio e la durata resta quella dell'originale (46 s)
        let saved = std::env::temp_dir().join(format!("granello-import-{}.wav", std::process::id()));
        {
            let mut keeper = crate::keep::Keeper::open(&saved).unwrap();
            for c in &chunks {
                keeper.add(c.start_ms - 5000, &c.samples).unwrap();
            }
        }
        let duration = crate::recordings::wav_duration_ms(std::fs::metadata(&saved).unwrap().len());
        std::fs::remove_file(&saved).unwrap();
        assert!((42_000..=46_500).contains(&duration), "registrazione di {duration} ms");
        // tutto l'audio non silenzioso è stato consegnato: 46s meno i ~5s di pause
        let total: usize = chunks.iter().map(|c| c.samples.len()).sum();
        assert!(total > 40 * 16_000 && total <= 46 * 16_000 + 16, "{total} campioni");
        let last = chunks.last().unwrap();
        assert!(last.start_ms > 5000 + 40_000, "ultimo blocco a {} ms", last.start_ms);

        // annullato subito: nessun blocco
        let mut file = AudioFile::open(&path).unwrap();
        let mut n = 0;
        chunk_file(&mut file, 0, || true, |_| n += 1).unwrap();
        assert_eq!(n, 0);
        std::fs::remove_file(&path).unwrap();
    }

    /// Prova a mano con un file e un modello veri:
    /// GRANELLO_AUDIO=riunione.m4a GRANELLO_MODEL=ggml-….bin cargo test real_file -- --ignored --nocapture
    #[test]
    #[ignore]
    fn transcribes_a_real_file() {
        let audio = std::env::var("GRANELLO_AUDIO").expect("GRANELLO_AUDIO");
        let model = std::env::var("GRANELLO_MODEL").expect("GRANELLO_MODEL");
        let transcriber = transcribe::Transcriber::load(Path::new(&model)).unwrap();
        let mut file = AudioFile::open(Path::new(&audio)).unwrap();
        println!("durata dichiarata: {:?} ms", file.total_ms);
        let mut text = String::new();
        let result = chunk_file(
            &mut file,
            0,
            || false,
            |c| {
                for s in transcriber.transcribe(&c.samples, "auto", "").unwrap() {
                    println!("[{:>6} ms] {}", c.start_ms + s.start_ms, s.text);
                    text.push_str(&s.text);
                }
            },
        );
        result.unwrap();
        assert!(!text.trim().is_empty());
    }

    /// Prova a mano della cattura dell'audio di sistema: riproduce un suono e controlla
    /// che arrivi. cargo test system_audio -- --ignored --nocapture
    #[test]
    #[ignore]
    fn captures_system_audio() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let (stream, rate) = open_system_audio(buf.clone(), Default::default()).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let _ = std::process::Command::new("afplay").arg("/System/Library/Sounds/Glass.aiff").status();
        std::thread::sleep(Duration::from_millis(500));
        drop(stream);
        let samples = buf.lock();
        let level = transcribe::rms(&samples);
        println!("{} campioni a {rate} Hz, rms {level}", samples.len());
        assert!(level > 0.0, "nessun segnale dall'audio di sistema");
    }

    #[test]
    fn forces_cut_without_pauses_and_skips_silence() {
        let shared = Arc::new(Mutex::new(Vec::new()));
        let mut c = Chunker::new("them", 16_000, shared.clone(), 0);
        shared.lock().extend(tone(21.0, 16_000, 0.3));
        let (_, chunk) = c.poll(false);
        let n = chunk.unwrap().samples.len();
        assert!(n > 16 * 16_000 && n <= 21 * 16_000);

        let shared = Arc::new(Mutex::new(vec![0.0; 16_000 * 3]));
        let mut c = Chunker::new("me", 16_000, shared, 0);
        assert!(c.poll(true).1.is_none());
    }
}
