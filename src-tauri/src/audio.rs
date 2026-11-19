//! Cattura audio (microfono + eventuale dispositivo di loopback per l'audio di sistema),
//! suddivisione in blocchi sulle pause e invio alla trascrizione.

use crate::db::Db;
use crate::transcribe::{self, TranscriberCache};
use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const MIN_CHUNK_SECS: f32 = 6.0;
const MAX_CHUNK_SECS: f32 = 20.0;
const TAIL_SECS: f32 = 0.5;
const SILENCE_RMS: f32 = 0.0025;

pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(n) = d.name() {
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
            .ok_or_else(|| anyhow!("nessun microfono disponibile")),
        Some(n) => host
            .input_devices()?
            .find(|d| d.name().map(|dn| dn == n).unwrap_or(false))
            .ok_or_else(|| anyhow!("dispositivo audio \"{n}\" non trovato")),
    }
}

/// Apre uno stream di input che scrive campioni mono f32 in `buf`.
fn open_stream(device: &cpal::Device, buf: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, u32)> {
    let supported = device.default_input_config().context("config input")?;
    let rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.clone().into();
    let err_fn = |e| log::error!("errore stream audio: {e}");

    fn push_mono<T: Copy>(data: &[T], channels: usize, buf: &Mutex<Vec<f32>>, conv: impl Fn(T) -> f32) {
        let mut b = buf.lock();
        for frame in data.chunks(channels.max(1)) {
            let sum: f32 = frame.iter().map(|s| conv(*s)).sum();
            b.push(sum / frame.len() as f32);
        }
    }

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let b = buf.clone();
            device.build_input_stream(
                &config,
                move |d: &[f32], _: &_| push_mono(d, channels, &b, |s| s),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let b = buf.clone();
            device.build_input_stream(
                &config,
                move |d: &[i16], _: &_| push_mono(d, channels, &b, |s| s as f32 / i16::MAX as f32),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::I32 => {
            let b = buf.clone();
            device.build_input_stream(
                &config,
                move |d: &[i32], _: &_| push_mono(d, channels, &b, |s| s as f32 / i32::MAX as f32),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let b = buf.clone();
            device.build_input_stream(
                &config,
                move |d: &[u16], _: &_| {
                    push_mono(d, channels, &b, |s| (s as f32 - 32768.0) / 32768.0)
                },
                err_fn,
                None,
            )?
        }
        f => return Err(anyhow!("formato audio non supportato: {f:?}")),
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

pub struct SessionConfig {
    pub meeting_id: String,
    pub mic_device: Option<String>,
    pub system_device: Option<String>,
    pub language: String,
    pub model_path: PathBuf,
    pub prompt: String,
    pub base_ms: i64,
}

pub struct Session {
    pub meeting_id: String,
    stop_tx: mpsc::Sender<()>,
    audio_thread: Option<JoinHandle<()>>,
    pub pending: Arc<AtomicUsize>,
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

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (chunk_tx, chunk_rx) = mpsc::channel::<Chunk>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        let pending = Arc::new(AtomicUsize::new(0));

        // ---- thread di trascrizione ----
        {
            let app = app.clone();
            let db = db.clone();
            let cache = cache.clone();
            let pending = pending.clone();
            let meeting_id = cfg.meeting_id.clone();
            let language = cfg.language.clone();
            let prompt = cfg.prompt.clone();
            let model_path = cfg.model_path.clone();
            std::thread::Builder::new()
                .name("granello-transcribe".into())
                .spawn(move || {
                    for chunk in chunk_rx {
                        let res = cache.get(&model_path).and_then(|t| {
                            t.transcribe(&chunk.samples, &language, &prompt)
                        });
                        match res {
                            Ok(segs) => {
                                for s in segs {
                                    let saved = db.lock().add_segment(
                                        &meeting_id,
                                        chunk.source,
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
                    }
                    // canale chiuso: registrazione terminata e coda svuotata
                    let _ = db.lock().mark_ended(&meeting_id);
                    let _ = app.emit("recording-finished", meeting_id.clone());
                })?;
        }

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

                    let mic = find_device(mic_name.as_deref())
                        .and_then(|d| open_stream(&d, mic_buf.clone()));
                    let (mic_stream, mic_rate) = match mic {
                        Ok(v) => v,
                        Err(e) => {
                            let _ = ready_tx.send(Err(e));
                            return;
                        }
                    };
                    let sys = match sys_name.as_deref().filter(|n| !n.is_empty()) {
                        Some(n) => match find_device(Some(n)).and_then(|d| open_stream(&d, sys_buf.clone())) {
                            Ok(v) => Some(v),
                            Err(e) => {
                                let _ = ready_tx.send(Err(e));
                                return;
                            }
                        },
                        None => None,
                    };
                    let _ = ready_tx.send(Ok(()));

                    let mut chunkers = vec![Chunker::new("me", mic_rate, mic_buf, base_ms)];
                    if let Some((_, rate)) = &sys {
                        chunkers.push(Chunker::new("them", *rate, sys_buf, base_ms));
                    }

                    loop {
                        let stop = !matches!(
                            stop_rx.recv_timeout(Duration::from_millis(200)),
                            Err(mpsc::RecvTimeoutError::Timeout)
                        );
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
            Err(_) => return Err(anyhow!("timeout nell'apertura dei dispositivi audio")),
        }

        Ok(Self {
            meeting_id: cfg.meeting_id,
            stop_tx,
            audio_thread: Some(audio_thread),
            pending,
        })
    }

    /// Ferma la cattura. La trascrizione dei blocchi in coda continua in background
    /// e termina con l'evento `recording-finished`.
    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(h) = self.audio_thread.take() {
            let _ = h.join();
        }
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
        assert_eq!(chunk.samples.len(), 8 * 16_000);
        // blocco successivo parte dopo 8 secondi
        shared.lock().extend(tone(2.0, 48_000, 0.3));
        let (_, chunk) = c.poll(true);
        assert_eq!(chunk.unwrap().start_ms, 9000);
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
