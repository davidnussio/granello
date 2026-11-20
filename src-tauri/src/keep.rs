//! Audio della riunione tenuto su disco solo per l'affinamento online della trascrizione.
//! Di norma Granello non salva l'audio; con l'opzione attiva lo scrive in un file WAV (mono,
//! 16 kHz) dentro la cartella dati, lo carica una volta a fine riunione e poi lo cancella.

use crate::transcribe::SAMPLE_RATE;
use anyhow::Result;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const HEADER: u64 = 44;

/// Dove sta l'audio conservato di un meeting. `None` se l'id non è un nome di file sicuro.
pub fn path(data_dir: &Path, meeting_id: &str) -> Option<PathBuf> {
    let safe = !meeting_id.is_empty() && meeting_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    safe.then(|| data_dir.join("audio").join(format!("{meeting_id}.wav")))
}

pub fn exists(data_dir: &Path, meeting_id: &str) -> bool {
    path(data_dir, meeting_id).is_some_and(|p| p.is_file())
}

/// Cancella l'audio conservato, se c'è.
pub fn remove(data_dir: &Path, meeting_id: &str) {
    if let Some(p) = path(data_dir, meeting_id) {
        let _ = std::fs::remove_file(p);
    }
}

fn header(data_len: u32) -> [u8; HEADER as usize] {
    let mut h = [0u8; HEADER as usize];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&SAMPLE_RATE.to_le_bytes());
    h[28..32].copy_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

/// Scrive i blocchi di audio (mono, 16 kHz) al loro posto nella linea del tempo del meeting.
/// Microfono e audio degli altri arrivano separati: dove si sovrappongono vengono sommati.
pub struct Keeper {
    file: File,
}

impl Keeper {
    /// Apre il file, o riprende quello di una registrazione precedente dello stesso meeting.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path)?;
        if file.metadata()?.len() < HEADER {
            file.set_len(0)?;
            file.write_all(&header(0))?;
        }
        Ok(Self { file })
    }

    pub fn add(&mut self, start_ms: i64, samples: &[f32]) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let offset = HEADER + (start_ms.max(0) as u64 * SAMPLE_RATE as u64 / 1000) * 2;
        let mut existing = vec![0u8; samples.len() * 2];
        self.file.seek(SeekFrom::Start(offset))?;
        // quello che c'è già (l'altra sorgente); oltre la fine del file resta silenzio
        let mut read = 0;
        while read < existing.len() {
            match self.file.read(&mut existing[read..])? {
                0 => break,
                n => read += n,
            }
        }
        for (i, s) in samples.iter().enumerate() {
            let old = i16::from_le_bytes([existing[i * 2], existing[i * 2 + 1]]) as i32;
            let new = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i32;
            let mixed = (old + new).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
            existing[i * 2..i * 2 + 2].copy_from_slice(&mixed.to_le_bytes());
        }
        self.file.seek(SeekFrom::Start(offset))?;
        self.file.write_all(&existing)?;
        Ok(())
    }

    /// Aggiorna le lunghezze nell'intestazione: senza, il file non è un WAV leggibile.
    pub fn finish(&mut self) -> Result<()> {
        let len = self.file.metadata()?.len().saturating_sub(HEADER).min(u32::MAX as u64) as u32;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&header(len))?;
        self.file.flush()?;
        Ok(())
    }
}

impl Drop for Keeper {
    fn drop(&mut self) {
        if let Err(e) = self.finish() {
            log::error!("audio conservato: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixes_sources_on_the_meeting_timeline() {
        let dir = std::env::temp_dir().join(format!("granello-keep-{}", std::process::id()));
        let p = path(&dir, "abc-123").unwrap();
        assert!(path(&dir, "../x").is_none());
        {
            let mut k = Keeper::open(&p).unwrap();
            k.add(1000, &[0.25; 16_000]).unwrap(); // secondo 1-2
            k.add(1500, &[0.25; 16_000]).unwrap(); // secondo 1,5-2,5: mezzo secondo sovrapposto
        }
        assert!(exists(&dir, "abc-123"));
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
        assert_eq!(data_len, 40_000 * 2); // 2,5 secondi
        assert_eq!(bytes.len(), 44 + data_len);
        let sample = |i: usize| i16::from_le_bytes([bytes[44 + i * 2], bytes[45 + i * 2]]);
        assert_eq!(sample(8_000), 0); // silenzio prima
        assert!((sample(20_000) as f32 / i16::MAX as f32 - 0.25).abs() < 0.01);
        assert!((sample(28_000) as f32 / i16::MAX as f32 - 0.5).abs() < 0.01); // sommati
        // riaprire non azzera quello che c'è
        drop(Keeper::open(&p).unwrap());
        assert_eq!(std::fs::read(&p).unwrap().len(), bytes.len());
        remove(&dir, "abc-123");
        assert!(!exists(&dir, "abc-123"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
