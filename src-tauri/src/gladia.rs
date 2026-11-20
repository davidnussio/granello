//! Trascrizione online con riconoscimento dei parlanti, tramite Gladia (https://docs.gladia.io).
//! Tre passi: si carica l'audio, si avvia il lavoro, si aspetta il risultato.
//! È l'unico punto dell'app da cui l'audio esce dal Mac: lo chiama solo l'affinamento,
//! che l'utente attiva nelle Impostazioni.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

pub const BASE_URL: &str = "https://api.gladia.io";
/// Identificatore della chiave di Gladia nel Portachiavi, accanto a quelle dei provider AI.
pub const KEY_ID: &str = "gladia";
/// Limite di Gladia per un file caricato.
const MAX_BYTES: u64 = 1000 * 1024 * 1024;
/// Limite di Gladia per una richiesta.
const MAX_MINUTES: u64 = 135;
const POLL_EVERY: Duration = Duration::from_secs(3);
const GIVE_UP_AFTER: Duration = Duration::from_secs(30 * 60);

/// Una frase detta da un parlante.
#[derive(Debug, Clone, PartialEq)]
pub struct Utterance {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    /// Numero del parlante (da 0), se Gladia l'ha riconosciuto.
    pub speaker: Option<u32>,
}

fn api_error(what: &str, status: reqwest::StatusCode, body: &str) -> anyhow::Error {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["message"].as_str().map(String::from))
        .unwrap_or_else(|| body.chars().take(200).collect());
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return tra!("Gladia ha rifiutato la chiave: controllala nelle Impostazioni", "Gladia rejected the key: check it in Settings");
    }
    tra!("Gladia, {what}: errore {status} {detail}", "Gladia, {what}: error {status} {detail}")
}

/// Le frasi del risultato di Gladia (`result.transcription.utterances`), in ordine di tempo.
pub fn parse_result(result: &Value) -> Vec<Utterance> {
    let mut out: Vec<Utterance> = result["result"]["transcription"]["utterances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|u| {
                    let text = u["text"].as_str()?.trim().to_string();
                    let start = u["start"].as_f64()?;
                    let end = u["end"].as_f64().unwrap_or(start);
                    (!text.is_empty()).then(|| Utterance {
                        start_ms: (start * 1000.0) as i64,
                        end_ms: (end.max(start) * 1000.0) as i64,
                        text,
                        speaker: u["speaker"].as_u64().map(|s| s as u32),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|u| u.start_ms);
    out
}

/// Trascrive il file `wav` e ritorna le frasi con i parlanti. `language`: codice a due lettere,
/// oppure "auto" per farla riconoscere. `base` è l'indirizzo dell'API (cambia solo nei test).
pub async fn transcribe(client: &reqwest::Client, base: &str, key: &str, wav: &Path, language: &str) -> Result<Vec<Utterance>> {
    let size = tokio::fs::metadata(wav).await?.len();
    if size > MAX_BYTES {
        return Err(tra!("L'audio è troppo grande per Gladia (massimo 1000 MB)", "The audio is too large for Gladia (1000 MB at most)"));
    }
    // il file è un WAV mono a 16 kHz e 16 bit: 32 000 byte al secondo
    if size / 32_000 / 60 >= MAX_MINUTES {
        return Err(tra!(
            "La registrazione supera i {MAX_MINUTES} minuti che Gladia accetta in una richiesta",
            "The recording is longer than the {MAX_MINUTES} minutes Gladia accepts in one request"
        ));
    }
    let bytes = tokio::fs::read(wav).await?;
    let part = reqwest::multipart::Part::bytes(bytes).file_name("meeting.wav").mime_str("audio/wav")?;
    let form = reqwest::multipart::Form::new().part("audio", part);
    let resp = client.post(format!("{base}/v2/upload")).header("x-gladia-key", key).multipart(form).send().await?;
    let (status, body) = (resp.status(), resp.text().await?);
    if !status.is_success() {
        return Err(api_error(crate::i18n::tr("caricamento", "upload"), status, &body));
    }
    let audio_url = serde_json::from_str::<Value>(&body)?["audio_url"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("Gladia: risposta senza audio_url"))?;

    let languages: Vec<&str> = if matches!(language, "" | "auto") { vec![] } else { vec![language] };
    let job = json!({
        "audio_url": audio_url,
        "diarization": true,
        "language_config": { "languages": languages, "code_switching": false },
    });
    let resp = client.post(format!("{base}/v2/pre-recorded")).header("x-gladia-key", key).json(&job).send().await?;
    let (status, body) = (resp.status(), resp.text().await?);
    if !status.is_success() {
        return Err(api_error(crate::i18n::tr("avvio", "start"), status, &body));
    }
    let id = serde_json::from_str::<Value>(&body)?["id"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("Gladia: risposta senza id"))?;

    let started = Instant::now();
    loop {
        tokio::time::sleep(POLL_EVERY).await;
        let resp = client.get(format!("{base}/v2/pre-recorded/{id}")).header("x-gladia-key", key).send().await?;
        let (status, body) = (resp.status(), resp.text().await?);
        if !status.is_success() {
            return Err(api_error(crate::i18n::tr("risultato", "result"), status, &body));
        }
        let result: Value = serde_json::from_str(&body)?;
        match result["status"].as_str() {
            Some("done") => return Ok(parse_result(&result)),
            Some("error") => {
                let code = result["error_code"].as_i64().unwrap_or(0);
                return Err(tra!("Gladia non è riuscita a trascrivere (errore {code})", "Gladia could not transcribe (error {code})"));
            }
            _ if started.elapsed() > GIVE_UP_AFTER => {
                return Err(tra!("Gladia non ha finito in tempo: riprova più tardi", "Gladia did not finish in time: try again later"));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_utterances_with_speakers() {
        let result = json!({ "status": "done", "result": { "transcription": { "utterances": [
            { "start": 12.4, "end": 15.0, "text": " Seconda frase. ", "speaker": 1 },
            { "start": 0.5, "end": 3.25, "text": "Prima frase.", "speaker": 0 },
            { "start": 20.0, "end": 21.0, "text": "   " },
            { "start": 30.0, "end": 31.0, "text": "Senza parlante." }
        ] } } });
        assert_eq!(
            parse_result(&result),
            vec![
                Utterance { start_ms: 500, end_ms: 3250, text: "Prima frase.".into(), speaker: Some(0) },
                Utterance { start_ms: 12_400, end_ms: 15_000, text: "Seconda frase.".into(), speaker: Some(1) },
                Utterance { start_ms: 30_000, end_ms: 31_000, text: "Senza parlante.".into(), speaker: None },
            ]
        );
        assert!(parse_result(&json!({ "status": "done" })).is_empty());
    }
}
