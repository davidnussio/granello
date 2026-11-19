//! Client minimale per la Messages API di Claude con streaming SSE.
//!
//! Gestisce: riprova automatica sugli errori transitori (429, 5xx, 529, rete),
//! annullamento da parte dell'utente, motivo di arresto (`stop_reason`) e
//! prompt caching del system prompt per le conversazioni a più turni.

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const MAX_ATTEMPTS: u32 = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);
/// Ogni quanto si controlla la richiesta di annullamento mentre si aspetta la rete.
const CANCEL_POLL: Duration = Duration::from_millis(250);

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Generazione annullata")]
    Cancelled,
    #[error("API key di Claude non valida o revocata. Controllala nelle Impostazioni.")]
    Auth,
    #[error("Claude API {status}: {message}")]
    Api { status: u16, message: String },
    #[error("Claude ha rifiutato la richiesta")]
    Refused,
    #[error("La risposta di Claude si è interrotta prima della fine. Riprova.")]
    Interrupted,
    #[error("Errore di rete verso Claude: {0}")]
    Network(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

impl Msg {
    pub fn user(c: impl Into<String>) -> Self {
        Self { role: "user".into(), content: c.into() }
    }
    pub fn assistant(c: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: c.into() }
    }
}

pub struct Request<'a> {
    pub api_key: &'a str,
    pub model: &'a str,
    pub system: &'a str,
    pub messages: &'a [Msg],
    pub max_tokens: u32,
    /// Mette in cache il system prompt: conviene solo se verrà riusato identico
    /// entro pochi minuti (chat a più turni sullo stesso meeting).
    pub cache_system: bool,
}

#[derive(Debug)]
pub struct Completion {
    pub text: String,
    /// La risposta ha raggiunto `max_tokens` ed è stata troncata.
    pub truncated: bool,
}

fn body(req: &Request) -> Value {
    let mut block = json!({ "type": "text", "text": req.system });
    if req.cache_system {
        block["cache_control"] = json!({ "type": "ephemeral" });
    }
    json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": [block],
        "messages": req.messages,
        "stream": true,
    })
}

fn retryable(status: u16) -> bool {
    matches!(status, 408 | 409 | 429 | 500 | 502 | 503 | 504 | 529)
}

fn backoff(attempt: u32, retry_after: Option<Duration>) -> Duration {
    retry_after
        .unwrap_or_else(|| Duration::from_millis(1000 * 2u64.pow(attempt.saturating_sub(1))))
        .min(MAX_RETRY_WAIT)
}

async fn sleep_cancellable(d: Duration, cancel: &AtomicBool) -> Result<(), LlmError> {
    let mut left = d;
    while !left.is_zero() {
        if cancel.load(Ordering::SeqCst) {
            return Err(LlmError::Cancelled);
        }
        let step = left.min(CANCEL_POLL);
        tokio::time::sleep(step).await;
        left -= step;
    }
    Ok(())
}

/// Attende `fut` controllando periodicamente l'annullamento.
async fn cancellable<T>(fut: impl std::future::Future<Output = T>, cancel: &AtomicBool) -> Result<T, LlmError> {
    tokio::pin!(fut);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(LlmError::Cancelled);
        }
        if let Ok(v) = tokio::time::timeout(CANCEL_POLL, &mut fut).await {
            return Ok(v);
        }
    }
}

/// Invia la richiesta riprovando sugli errori transitori. Si riprova solo prima
/// che inizi lo streaming: dopo il primo frammento l'utente ha già visto del testo.
async fn send(client: &reqwest::Client, req: &Request<'_>, cancel: &AtomicBool) -> Result<reqwest::Response, LlmError> {
    let body = body(req);
    let mut attempt = 0;
    loop {
        attempt += 1;
        let sent = cancellable(
            client
                .post(API_URL)
                .header("x-api-key", req.api_key)
                .header("anthropic-version", API_VERSION)
                .json(&body)
                .send(),
            cancel,
        )
        .await?;
        let resp = match sent {
            Ok(r) => r,
            Err(e) if attempt < MAX_ATTEMPTS && (e.is_connect() || e.is_timeout()) => {
                log::warn!("Claude: errore di rete (tentativo {attempt}): {e}");
                sleep_cancellable(backoff(attempt, None), cancel).await?;
                continue;
            }
            Err(e) => return Err(LlmError::Network(e.to_string())),
        };
        let status = resp.status().as_u16();
        if resp.status().is_success() {
            return Ok(resp);
        }
        if retryable(status) && attempt < MAX_ATTEMPTS {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<f64>().ok())
                .map(Duration::from_secs_f64);
            log::warn!("Claude: HTTP {status} (tentativo {attempt}), riprovo");
            sleep_cancellable(backoff(attempt, retry_after), cancel).await?;
            continue;
        }
        if status == 401 {
            return Err(LlmError::Auth);
        }
        let text = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or(text);
        return Err(LlmError::Api { status, message });
    }
}

/// Esegue una richiesta in streaming. `on_delta` riceve ogni frammento di testo.
pub async fn stream_message(
    client: &reqwest::Client,
    req: &Request<'_>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
) -> Result<Completion, LlmError> {
    let resp = send(client, req, cancel).await?;

    let mut full = String::new();
    let mut stop_reason: Option<String> = None;
    // buffer di byte: un carattere UTF-8 (es. "è") può arrivare spezzato tra due chunk
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    let mut handle = |line: &str, full: &mut String, stop: &mut Option<String>| -> Result<(), LlmError> {
        match parse_sse_line(line)? {
            Sse::Text(t) => {
                full.push_str(&t);
                on_delta(&t);
            }
            Sse::Stop(r) => *stop = Some(r),
            Sse::Other => {}
        }
        Ok(())
    };
    while let Some(chunk) = cancellable(stream.next(), cancel).await? {
        let chunk = chunk.map_err(|e| {
            log::warn!("Claude: stream interrotto: {e}");
            LlmError::Interrupted
        })?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            handle(String::from_utf8_lossy(&line_bytes).trim_end(), &mut full, &mut stop_reason)?;
        }
    }
    handle(String::from_utf8_lossy(&buf).trim(), &mut full, &mut stop_reason)?;

    match stop_reason.as_deref() {
        Some("refusal") => Err(LlmError::Refused),
        Some("max_tokens") => Ok(Completion { text: full, truncated: true }),
        Some(_) => Ok(Completion { text: full, truncated: false }),
        // nessun message_delta finale: la connessione è caduta a metà risposta
        None => Err(LlmError::Interrupted),
    }
}

#[derive(Debug, PartialEq)]
enum Sse {
    Text(String),
    Stop(String),
    Other,
}

/// Interpreta una riga SSE `data: {...}`; errore se l'evento è un errore.
fn parse_sse_line(line: &str) -> Result<Sse, LlmError> {
    let Some(data) = line.strip_prefix("data:") else { return Ok(Sse::Other) };
    let Ok(v) = serde_json::from_str::<Value>(data.trim()) else { return Ok(Sse::Other) };
    match v["type"].as_str() {
        Some("content_block_delta") if v["delta"]["type"] == "text_delta" => {
            Ok(v["delta"]["text"].as_str().map(|t| Sse::Text(t.into())).unwrap_or(Sse::Other))
        }
        Some("message_delta") => Ok(v["delta"]["stop_reason"]
            .as_str()
            .map(|r| Sse::Stop(r.into()))
            .unwrap_or(Sse::Other)),
        Some("error") => Err(LlmError::Api {
            status: match v["error"]["type"].as_str() {
                Some("overloaded_error") => 529,
                Some("rate_limit_error") => 429,
                _ => 500,
            },
            message: v["error"]["message"].as_str().unwrap_or("errore sconosciuto").to_string(),
        }),
        _ => Ok(Sse::Other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse() {
        let l = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ciao"}}"#;
        assert_eq!(parse_sse_line(l).unwrap(), Sse::Text("Ciao".into()));
        assert_eq!(parse_sse_line("event: ping").unwrap(), Sse::Other);
        assert_eq!(parse_sse_line(r#"data: {"type":"message_stop"}"#).unwrap(), Sse::Other);
        // il ragionamento del modello non finisce nelle note
        let t = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}"#;
        assert_eq!(parse_sse_line(t).unwrap(), Sse::Other);
        let s = r#"data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}"#;
        assert_eq!(parse_sse_line(s).unwrap(), Sse::Stop("max_tokens".into()));
        let e = r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;
        assert!(matches!(parse_sse_line(e), Err(LlmError::Api { status: 529, .. })));
    }

    #[test]
    fn request_body_and_backoff() {
        let msgs = [Msg::user("ciao")];
        let mut req =
            Request { api_key: "k", model: "m", system: "sys", messages: &msgs, max_tokens: 10, cache_system: false };
        assert!(body(&req)["system"][0].get("cache_control").is_none());
        req.cache_system = true;
        let b = body(&req);
        assert_eq!(b["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["stream"], true);

        assert!(retryable(529) && retryable(429) && !retryable(400) && !retryable(401));
        assert_eq!(backoff(1, None), Duration::from_secs(1));
        assert_eq!(backoff(2, None), Duration::from_secs(2));
        assert_eq!(backoff(1, Some(Duration::from_secs(300))), MAX_RETRY_WAIT);
    }

    #[tokio::test]
    async fn cancel_interrupts_waits() {
        let cancel = AtomicBool::new(true);
        assert!(matches!(sleep_cancellable(Duration::from_secs(60), &cancel).await, Err(LlmError::Cancelled)));
        let never = std::future::pending::<()>();
        assert!(matches!(cancellable(never, &cancel).await, Err(LlmError::Cancelled)));
    }
}
