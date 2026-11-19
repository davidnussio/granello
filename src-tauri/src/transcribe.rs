//! Trascrizione locale con whisper.cpp (whisper-rs). Su macOS usa Metal.

use crate::models::WhisperModelInfo;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub const SAMPLE_RATE: u32 = 16_000;

/// (nome, MB, descrizione)
const MODELS: &[(&str, u32, &str)] = &[
    ("base", 142, "Veloce, qualità base. Utile per provare."),
    ("small", 466, "Buon compromesso su Mac Intel."),
    ("large-v3-turbo-q5_0", 547, "Consigliato su Apple Silicon: quasi qualità large, veloce."),
    ("large-v3-turbo", 1620, "Qualità massima turbo, più memoria."),
    ("medium", 1530, "Alternativa multilingue robusta."),
];

pub fn model_catalog(dir: &Path) -> Vec<WhisperModelInfo> {
    MODELS
        .iter()
        .map(|(name, mb, desc)| WhisperModelInfo {
            name: (*name).into(),
            size_mb: *mb,
            downloaded: model_path(dir, name).exists(),
            description: (*desc).into(),
        })
        .collect()
}

pub fn is_known_model(name: &str) -> bool {
    MODELS.iter().any(|(n, _, _)| *n == name)
}

pub fn model_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("ggml-{name}.bin"))
}

/// I file ggml di whisper.cpp iniziano con il magic 0x67676d6c (little endian).
pub fn looks_like_ggml(head: &[u8]) -> bool {
    head.starts_with(b"lmgg")
}

pub fn model_url(name: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin")
}

pub struct Transcriber {
    ctx: WhisperContext,
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

impl Transcriber {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Err(anyhow!(
                "Modello Whisper non trovato ({}). Scaricalo dalle Impostazioni.",
                path.display()
            ));
        }
        let mut params = WhisperContextParameters::default();
        params.use_gpu(true);
        let ctx = WhisperContext::new_with_params(
            path.to_str().context("percorso modello non valido")?,
            params,
        )
        .map_err(|e| anyhow!("caricamento modello whisper: {e:?}"))?;
        Ok(Self { ctx, path: path.to_path_buf() })
    }

    /// `samples`: mono f32 a 16 kHz. `language`: "it", "en", ..., oppure "auto".
    pub fn transcribe(&self, samples: &[f32], language: &str, prompt: &str) -> Result<Vec<Segment>> {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| anyhow!("whisper state: {e:?}"))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        params.set_n_threads(threads as i32);
        params.set_language(Some(if language.is_empty() { "auto" } else { language }));
        params.set_translate(false);
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if !prompt.is_empty() {
            params.set_initial_prompt(prompt);
        }

        // whisper.cpp vuole almeno ~1s di audio
        let mut buf;
        let input = if samples.len() < SAMPLE_RATE as usize + SAMPLE_RATE as usize / 10 {
            buf = samples.to_vec();
            buf.resize(SAMPLE_RATE as usize + SAMPLE_RATE as usize / 10, 0.0);
            &buf[..]
        } else {
            samples
        };

        state
            .full(params, input)
            .map_err(|e| anyhow!("whisper full: {e:?}"))?;
        let n = state
            .full_n_segments()
            .map_err(|e| anyhow!("whisper segments: {e:?}"))?;
        let mut out = Vec::new();
        for i in 0..n {
            let text = match state.full_get_segment_text_lossy(i) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let text = clean_text(&text);
            if text.is_empty() || is_hallucination(&text) {
                continue;
            }
            let t0 = state.full_get_segment_t0(i).unwrap_or(0) * 10;
            let t1 = state.full_get_segment_t1(i).unwrap_or(0) * 10;
            out.push(Segment { start_ms: t0, end_ms: t1, text });
        }
        Ok(out)
    }
}

/// Mantiene in memoria un solo modello caricato.
#[derive(Default)]
pub struct TranscriberCache {
    inner: Mutex<Option<std::sync::Arc<Transcriber>>>,
}

impl TranscriberCache {
    pub fn get(&self, path: &Path) -> Result<std::sync::Arc<Transcriber>> {
        let mut guard = self.inner.lock();
        if let Some(t) = guard.as_ref() {
            if t.path == path {
                return Ok(t.clone());
            }
        }
        *guard = None; // libera il modello precedente prima di caricarne uno nuovo
        let t = std::sync::Arc::new(Transcriber::load(path)?);
        *guard = Some(t.clone());
        Ok(t)
    }
}

impl TranscriberCache {
    /// Scarica il modello dalla memoria (verrà ricaricato alla prossima registrazione).
    pub fn clear(&self) {
        *self.inner.lock() = None;
    }
}

fn clean_text(t: &str) -> String {
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Frasi che whisper "allucina" sul silenzio o sul rumore (note soprattutto in italiano).
pub fn is_hallucination(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    let t = t.trim_matches(|c: char| c.is_ascii_punctuation() || c.is_whitespace());
    if t.is_empty() {
        return true;
    }
    // [Musica], (applausi), *rumore* ...
    let s = text.trim();
    if (s.starts_with('[') && s.ends_with(']'))
        || (s.starts_with('(') && s.ends_with(')'))
        || (s.starts_with('*') && s.ends_with('*'))
        || s.starts_with('♪')
    {
        return true;
    }
    const KNOWN: &[&str] = &[
        "sottotitoli a cura di qtss",
        "sottotitoli creati dalla comunità amara.org",
        "sottotitoli e revisione a cura di qtss",
        "grazie per la visione",
        "grazie per l'attenzione e alla prossima",
        "iscriviti al canale",
        "thank you for watching",
        "thanks for watching",
        "subtitles by the amara.org community",
        "untertitel im auftrag des zdf",
        "untertitelung des zdf",
        "sous-titres réalisés para la communauté d'amara.org",
        "sous-titrage st' 501",
    ];
    KNOWN.iter().any(|k| t.contains(k))
}

/// Ricampionamento a 16 kHz con media a finestra (fa anche da filtro passa-basso grezzo).
pub fn resample_to_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == SAMPLE_RATE || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / SAMPLE_RATE as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = i as f64 * ratio;
        let end = start + ratio;
        if ratio >= 1.0 {
            let a = start.floor() as usize;
            let b = (end.ceil() as usize).min(input.len());
            let slice = &input[a..b.max(a + 1).min(input.len())];
            out.push(slice.iter().sum::<f32>() / slice.len() as f32);
        } else {
            // upsampling: interpolazione lineare
            let a = start.floor() as usize;
            let frac = (start - a as f64) as f32;
            let x0 = input[a.min(input.len() - 1)];
            let x1 = input[(a + 1).min(input.len() - 1)];
            out.push(x0 + (x1 - x0) * frac);
        }
    }
    out
}

pub fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hallucinations() {
        assert!(is_hallucination("Sottotitoli a cura di QTSS"));
        assert!(is_hallucination(" [Musica] "));
        assert!(is_hallucination("..."));
        assert!(!is_hallucination("Il deploy è previsto per giovedì."));
        assert!(looks_like_ggml(b"lmgg\x01\x00"));
        assert!(!looks_like_ggml(b"<!DOCTYPE html>"));
        assert!(!looks_like_ggml(b"lm"));
    }

    #[test]
    fn resample_lengths() {
        let input = vec![0.5f32; 48_000];
        let out = resample_to_16k(&input, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!((out[100] - 0.5).abs() < 1e-6);
        let up = resample_to_16k(&vec![0.1f32; 8_000], 8_000);
        assert_eq!(up.len(), 16_000);
        let odd = resample_to_16k(&vec![0.2f32; 44_100], 44_100);
        assert!((odd.len() as i64 - 16_000).abs() <= 1);
    }
}
