//! Registrazioni salvate: l'audio di una riunione tenuto in una cartella scelta dall'utente,
//! per riascoltarlo. Si scrive in WAV mentre si registra (vedi `keep`); alla fine, se sul Mac
//! c'è ffmpeg, viene compresso in M4A e, a richiesta, ripulito dalle pause senza audio.

use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Dove finiscono le registrazioni se l'utente non sceglie un'altra cartella.
pub fn default_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("recordings")
}

/// La cartella in uso: quella delle impostazioni, o quella predefinita.
pub fn dir(data_dir: &Path, chosen: Option<&str>) -> PathBuf {
    match chosen.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => default_dir(data_dir),
    }
}

/// Nome del file di una registrazione: data e ora di inizio, più l'inizio dell'id del meeting.
pub fn file_name(started_at_ms: i64, meeting_id: &str) -> String {
    let when = chrono::DateTime::from_timestamp_millis(started_at_ms)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H.%M.%S").to_string())
        .unwrap_or_else(|| started_at_ms.to_string());
    let short: String = meeting_id.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    format!("{when} {short}.wav")
}

/// Il programma ffmpeg, se è installato. Un'app avviata dal Finder non vede il PATH del
/// terminale, quindi si guarda anche dove lo mettono Homebrew e MacPorts.
pub fn ffmpeg() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .chain(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"].map(PathBuf::from))
        .map(|dir| dir.join("ffmpeg"))
        .find(|p| p.is_file())
}

/// Durata (ms) di un WAV mono a 16 kHz e 16 bit scritto da `keep`, dalla sua dimensione.
pub fn wav_duration_ms(bytes: u64) -> i64 {
    (bytes.saturating_sub(44) / 32) as i64
}

/// L'ultimo `time=HH:MM:SS.cc` che ffmpeg scrive mentre lavora: la durata del file prodotto.
fn last_time_ms(stderr: &str) -> Option<i64> {
    let at = stderr.rfind("time=")?;
    let value: String = stderr[at + 5..].chars().take_while(|c| c.is_ascii_digit() || *c == ':' || *c == '.').collect();
    let mut parts = value.split(':');
    let (h, m, s) = (parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?);
    Some(((h * 3600.0 + m * 60.0 + s) * 1000.0) as i64)
}

/// Comprime `input` in M4A (`output`); con `trim` toglie anche le pause senza audio più
/// lunghe di un secondo e mezzo. Ritorna la durata del file prodotto, in millisecondi.
pub fn convert(ffmpeg: &Path, input: &Path, output: &Path, trim: bool) -> Result<i64> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y", "-i"]).arg(input);
    if trim {
        cmd.args(["-af", "silenceremove=stop_periods=-1:stop_duration=1.5:stop_threshold=-45dB"]);
    }
    cmd.args(["-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k"]).arg(output);
    let out = cmd.output()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() || !output.is_file() {
        let _ = std::fs::remove_file(output);
        let last = stderr.lines().last().unwrap_or_default();
        return Err(anyhow!("ffmpeg: {last}"));
    }
    Ok(last_time_ms(&stderr).unwrap_or(0))
}

/// Cosa è diventata una registrazione dopo la chiusura: il file, quanto dura e quanto pesa.
pub struct Finished {
    pub path: PathBuf,
    pub duration_ms: i64,
    pub bytes: u64,
    pub trimmed: bool,
}

/// Chiude una registrazione appena finita: con ffmpeg la comprime (e toglie le pause se
/// richiesto), altrimenti resta il WAV. `None` se nel file non c'è audio: non resta niente.
pub fn finalize(wav: &Path, trim: bool) -> Option<Finished> {
    let bytes = std::fs::metadata(wav).ok()?.len();
    if bytes <= 44 {
        let _ = std::fs::remove_file(wav);
        return None;
    }
    let plain = Finished { path: wav.to_path_buf(), duration_ms: wav_duration_ms(bytes), bytes, trimmed: false };
    let Some(tool) = ffmpeg() else { return Some(plain) };
    let output = wav.with_extension("m4a");
    match convert(&tool, wav, &output, trim) {
        Ok(duration_ms) => {
            let _ = std::fs::remove_file(wav);
            let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            Some(Finished { path: output, duration_ms: if duration_ms > 0 { duration_ms } else { plain.duration_ms }, bytes, trimmed: trim })
        }
        Err(e) => {
            log::error!("registrazione {}: {e}", wav.display());
            Some(plain)
        }
    }
}

/// Toglie le pause da una registrazione già salvata. Il file nuovo prende il posto del vecchio.
pub fn trim(file: &Path) -> Result<Finished> {
    let tool = ffmpeg().ok_or_else(|| crate::tra!("Per togliere le pause serve ffmpeg, che su questo Mac non c'è", "Removing pauses needs ffmpeg, which isn't on this Mac"))?;
    let temp = file.with_extension("trim.m4a");
    let duration_ms = convert(&tool, file, &temp, true)?;
    let output = file.with_extension("m4a");
    if output != file {
        let _ = std::fs::remove_file(file);
    }
    std::fs::rename(&temp, &output)?;
    let bytes = std::fs::metadata(&output)?.len();
    Ok(Finished { path: output, duration_ms, bytes, trimmed: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_durations_and_progress_lines() {
        assert_eq!(wav_duration_ms(44 + 32_000 * 90), 90_000);
        assert_eq!(last_time_ms("size=1kB time=00:00:03.10 bitrate=\nsize=9kB time=00:01:07.52 bitrate= 39kbits/s"), Some(67_520));
        assert_eq!(last_time_ms("niente"), None);
        let name = file_name(1_795_000_000_000, "a1b2c3d4-e5f6-7890");
        assert!(name.ends_with(" a1b2c3d4.wav"), "{name}");
        assert!(!name.contains('/') && !name.contains(':'), "{name}");
        assert_eq!(dir(Path::new("/dati"), None), PathBuf::from("/dati/recordings"));
        assert_eq!(dir(Path::new("/dati"), Some("  ")), PathBuf::from("/dati/recordings"));
        assert_eq!(dir(Path::new("/dati"), Some("/Volumes/Audio")), PathBuf::from("/Volumes/Audio"));
    }

    /// Con ffmpeg installato: le pause spariscono e il file compresso prende il posto del WAV.
    #[test]
    fn trims_pauses_when_ffmpeg_is_there() {
        if ffmpeg().is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("granello-rec-{}", std::process::id()));
        let wav = dir.join("prova.wav");
        {
            let mut k = crate::keep::Keeper::open(&wav).unwrap();
            let tone: Vec<f32> = (0..32_000).map(|i| (i as f32 * 0.17).sin() * 0.4).collect();
            k.add(0, &tone).unwrap(); // 2 secondi di suono
            k.add(8000, &tone).unwrap(); // 6 secondi di silenzio, poi altri 2 di suono
        }
        let done = finalize(&wav, true).unwrap();
        assert!(!wav.exists());
        assert_eq!(done.path.extension().and_then(|e| e.to_str()), Some("m4a"));
        assert!(done.trimmed && done.bytes > 0);
        assert!(done.duration_ms > 3000 && done.duration_ms < 7000, "durata {}", done.duration_ms);
        // un file senza audio non lascia niente
        let empty = dir.join("vuoto.wav");
        drop(crate::keep::Keeper::open(&empty).unwrap());
        assert!(finalize(&empty, false).is_none());
        assert!(!empty.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
