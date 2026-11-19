//! Decodifica di un file audio (o della traccia audio di un video) in campioni mono f32,
//! un blocco alla volta: il file non viene mai caricato tutto in memoria.

use anyhow::Result;
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Estensioni proposte nella finestra di scelta del file.
pub const EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "m4b", "mp4", "mov", "aac", "wav", "flac", "ogg", "oga", "mka", "mkv", "aiff", "aif", "caf",
];

pub struct AudioFile {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    buf: Option<SampleBuffer<f32>>,
    /// Durata dichiarata dal file, quando c'è.
    pub total_ms: Option<i64>,
}

/// Campioni mono consecutivi alla frequenza `rate`.
pub struct Block {
    pub rate: u32,
    pub samples: Vec<f32>,
}

impl AudioFile {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path)
            .map_err(|e| tra!("Impossibile aprire il file: {e}", "Cannot open the file: {e}"))?;
        let stream = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let format = symphonia::default::get_probe()
            .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|_| {
                tra!(
                    "Formato del file non riconosciuto. Prova con MP3, M4A, WAV o FLAC.",
                    "File format not recognised. Try MP3, M4A, WAV or FLAC."
                )
            })?
            .format;

        // la prima traccia che si riesce a decodificare (in un video: quella audio)
        let codecs = symphonia::default::get_codecs();
        let found = format
            .tracks()
            .iter()
            .filter(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .find_map(|t| {
                let decoder = codecs.make(&t.codec_params, &DecoderOptions::default()).ok()?;
                let p = &t.codec_params;
                let total_ms = match (p.n_frames, p.sample_rate) {
                    (Some(frames), Some(rate)) if rate > 0 => Some((frames * 1000 / rate as u64) as i64),
                    _ => None,
                };
                Some((t.id, decoder, total_ms))
            });
        let Some((track_id, decoder, total_ms)) = found else {
            return Err(tra!(
                "Il file non contiene una traccia audio in un formato supportato (Opus non è supportato). \
Prova a convertirlo in MP3, M4A o WAV.",
                "The file has no audio track in a supported format (Opus is not supported). \
Try converting it to MP3, M4A or WAV."
            ));
        };
        Ok(Self { format, decoder, track_id, buf: None, total_ms })
    }

    /// Il prossimo blocco di audio, `None` alla fine del file.
    /// I pacchetti corrotti vengono saltati.
    pub fn next_block(&mut self) -> Result<Option<Block>> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
                Err(SymError::ResetRequired) => return Ok(None),
                Err(e) => return Err(tra!("lettura del file audio: {e}", "reading the audio file: {e}")),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(d) => d,
                Err(SymError::DecodeError(e)) => {
                    log::warn!("pacchetto audio saltato: {e}");
                    continue;
                }
                Err(e) => return Err(tra!("decodifica del file audio: {e}", "decoding the audio file: {e}")),
            };
            if decoded.frames() == 0 {
                continue;
            }
            let spec = *decoded.spec();
            let channels = spec.channels.count().max(1);
            if self.buf.as_ref().is_none_or(|b| b.capacity() < decoded.capacity() * channels) {
                self.buf = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
            }
            let buf = self.buf.as_mut().expect("buffer appena creato");
            buf.copy_interleaved_ref(decoded);
            let samples = buf
                .samples()
                .chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
                .collect();
            return Ok(Some(Block { rate: spec.rate, samples }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// WAV PCM 16 bit con un tono a 440 Hz.
    fn wav(rate: u32, channels: u16, secs: f32) -> Vec<u8> {
        let frames = (secs * rate as f32) as u32;
        let data_len = frames * channels as u32 * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
        out.extend_from_slice(&(channels * 2).to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let s = (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / rate as f32).sin();
            for _ in 0..channels {
                out.extend_from_slice(&((s * 0.5 * i16::MAX as f32) as i16).to_le_bytes());
            }
        }
        out
    }

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("granello-{}-{name}", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn decodes_stereo_wav_to_mono() {
        let path = temp_file("stereo.wav", &wav(44_100, 2, 2.0));
        let mut file = AudioFile::open(&path).unwrap();
        assert_eq!(file.total_ms, Some(2000));
        let mut samples = Vec::new();
        while let Some(block) = file.next_block().unwrap() {
            assert_eq!(block.rate, 44_100);
            samples.extend(block.samples);
        }
        std::fs::remove_file(&path).unwrap();
        assert_eq!(samples.len(), 88_200);
        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.01, "picco {peak}");
    }

    #[test]
    fn rejects_files_that_are_not_audio() {
        let path = temp_file("note.wav", b"questo non e' un file audio, solo testo");
        assert!(AudioFile::open(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(AudioFile::open(Path::new("/percorso/che/non/esiste.mp3")).is_err());
    }
}
