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

/// Il programma ffmpeg. Le build di rilascio lo includono accanto all'eseguibile (sidecar di
/// Tauri, compilato da `scripts/build-ffmpeg.sh`); in sviluppo si usa quello installato. Un'app
/// avviata dal Finder non vede il PATH del terminale, quindi si guarda anche dove lo mettono
/// Homebrew e MacPorts.
pub fn ffmpeg() -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let bundled = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    let path = std::env::var_os("PATH").unwrap_or_default();
    bundled
        .into_iter()
        .chain(std::env::split_paths(&path))
        .chain(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"].map(PathBuf::from))
        .map(|dir| dir.join(name))
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
    let tool = ffmpeg().ok_or_else(|| crate::tra!("Per togliere le pause serve ffmpeg, che su questo computer non c'è", "Removing pauses needs ffmpeg, which isn't on this computer"))?;
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

/// Unisce più registrazioni, nell'ordine dato, in un solo M4A (`output`). Ritorna la durata.
pub fn merge(ffmpeg: &Path, inputs: &[PathBuf], output: &Path) -> Result<i64> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y"]);
    for input in inputs {
        cmd.arg("-i").arg(input);
    }
    // ogni pezzo portato allo stesso formato: un WAV appena registrato e un M4A già compresso
    // non si incollano altrimenti
    let mut graph = String::new();
    for i in 0..inputs.len() {
        graph.push_str(&format!("[{i}:a]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[a{i}];"));
    }
    for i in 0..inputs.len() {
        graph.push_str(&format!("[a{i}]"));
    }
    graph.push_str(&format!("concat=n={}:v=0:a=1[out]", inputs.len()));
    cmd.args(["-filter_complex", &graph, "-map", "[out]", "-c:a", "aac", "-b:a", "48k"]).arg(output);
    let out = cmd.output()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() || !output.is_file() {
        let _ = std::fs::remove_file(output);
        let last = stderr.lines().last().unwrap_or_default();
        return Err(anyhow!("ffmpeg: {last}"));
    }
    Ok(last_time_ms(&stderr).unwrap_or(0))
}

/// Quante barre ha la forma d'onda mostrata nel player.
pub const WAVE_BARS: usize = 160;

/// La forma d'onda di una registrazione: il file diviso in `bars` fette uguali, per ognuna
/// il picco del volume da 0 a 255, rapportato al punto più forte. Il file si legge un
/// blocco alla volta.
pub fn waveform(file: &Path, bars: usize) -> Result<Vec<u8>> {
    let mut audio = crate::decode::AudioFile::open(file)?;
    // un picco ogni 20 ms circa: un'ora di audio sono 180 mila numeri
    let mut peaks: Vec<f32> = Vec::new();
    let (mut peak, mut filled) = (0f32, 0usize);
    while let Some(block) = audio.next_block()? {
        let window = (block.rate as usize / 50).max(1);
        for sample in block.samples {
            peak = peak.max(sample.abs());
            filled += 1;
            if filled >= window {
                peaks.push(peak);
                (peak, filled) = (0.0, 0);
            }
        }
    }
    if filled > 0 {
        peaks.push(peak);
    }
    let loudest = peaks.iter().copied().fold(0f32, f32::max);
    if peaks.is_empty() || loudest <= 0.0 || bars == 0 {
        return Ok(vec![0; bars]);
    }
    Ok((0..bars)
        .map(|i| {
            let from = i * peaks.len() / bars;
            let to = ((i + 1) * peaks.len() / bars).max(from + 1).min(peaks.len());
            let top = peaks[from.min(peaks.len() - 1)..to].iter().copied().fold(0f32, f32::max);
            // radice: le parti a voce bassa restano visibili accanto a quelle forti
            ((top / loudest).sqrt() * 255.0).round() as u8
        })
        .collect())
}

/// Dove si tengono le forme d'onda già calcolate: nella cartella dei dati, non in quella
/// delle registrazioni. Il nome porta la dimensione del file, così un file cambiato
/// (pause tolte, registrazioni unite) non riusa quella vecchia.
pub fn waveform_cache(data_dir: &Path, id: i64, bytes: i64) -> PathBuf {
    data_dir.join("waveforms").join(format!("{id}-{bytes}.bin"))
}

/// Toglie le forme d'onda salvate di una registrazione che non c'è più o è cambiata.
pub fn forget_waveform(data_dir: &Path, id: i64) {
    let Ok(entries) = std::fs::read_dir(data_dir.join("waveforms")) else { return };
    let prefix = format!("{id}-");
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
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

    fn wav_with(path: &Path, parts: &[(i64, usize)]) {
        let mut k = crate::keep::Keeper::open(path).unwrap();
        for (at_ms, samples) in parts {
            let tone: Vec<f32> = (0..*samples).map(|i| (i as f32 * 0.17).sin() * 0.4).collect();
            k.add(*at_ms, &tone).unwrap();
        }
    }

    #[test]
    fn waveform_follows_sound_and_silence() {
        let dir = std::env::temp_dir().join(format!("granello-wave-{}", std::process::id()));
        let wav = dir.join("onda.wav");
        // 2 secondi di suono, 6 di silenzio, altri 2 di suono
        wav_with(&wav, &[(0, 32_000), (8000, 32_000)]);
        let bars = waveform(&wav, 10).unwrap();
        assert_eq!(bars.len(), 10);
        assert!(bars[0] > 200 && bars[9] > 200, "{bars:?}");
        assert!(bars[3..7].iter().all(|b| *b == 0), "{bars:?}");

        let cache = waveform_cache(&dir, 7, 123);
        std::fs::create_dir_all(cache.parent().unwrap()).unwrap();
        std::fs::write(&cache, &bars).unwrap();
        std::fs::write(waveform_cache(&dir, 77, 1), [0]).unwrap();
        forget_waveform(&dir, 7);
        assert!(!cache.exists());
        assert!(waveform_cache(&dir, 77, 1).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Con ffmpeg installato: due registrazioni diventano un solo file, una dopo l'altra.
    #[test]
    fn merges_recordings_when_ffmpeg_is_there() {
        let Some(tool) = ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("granello-merge-{}", std::process::id()));
        let (a, b, out) = (dir.join("a.wav"), dir.join("b.wav"), dir.join("unite.m4a"));
        wav_with(&a, &[(0, 32_000)]);
        wav_with(&b, &[(0, 48_000)]);
        let ms = merge(&tool, &[a, b], &out).unwrap();
        assert!(out.is_file());
        assert!(ms > 4500 && ms < 5500, "durata {ms}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
