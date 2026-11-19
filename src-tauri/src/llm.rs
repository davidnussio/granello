//! Client minimale per la Messages API di Claude con streaming SSE.

use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";

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

/// Esegue una richiesta in streaming. `on_delta` riceve ogni frammento di testo.
pub async fn stream_message(
    api_key: &str,
    model: &str,
    system: &str,
    messages: &[Msg],
    max_tokens: u32,
    mut on_delta: impl FnMut(&str),
) -> Result<String> {
    let body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "stream": true,
    });
    let resp = reqwest::Client::new()
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or(text);
        return Err(anyhow!("Claude API {status}: {msg}"));
    }

    let mut full = String::new();
    // buffer di byte: un carattere UTF-8 (es. "è") può arrivare spezzato tra due chunk
    let mut buf: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk?);
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            if let Some(text) = parse_sse_line(line.trim_end())? {
                full.push_str(&text);
                on_delta(&text);
            }
        }
    }
    if let Some(text) = parse_sse_line(String::from_utf8_lossy(&buf).trim())? {
        full.push_str(&text);
        on_delta(&text);
    }
    Ok(full)
}

/// Estrae il testo da una riga SSE `data: {...}`; errore se l'evento è un errore.
fn parse_sse_line(line: &str) -> Result<Option<String>> {
    let Some(data) = line.strip_prefix("data:") else { return Ok(None) };
    let Ok(v) = serde_json::from_str::<Value>(data.trim()) else { return Ok(None) };
    match v["type"].as_str() {
        Some("content_block_delta") if v["delta"]["type"] == "text_delta" => {
            Ok(v["delta"]["text"].as_str().map(String::from))
        }
        Some("error") => Err(anyhow!(
            "Claude API: {}",
            v["error"]["message"].as_str().unwrap_or("errore sconosciuto")
        )),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse() {
        let l = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ciao"}}"#;
        assert_eq!(parse_sse_line(l).unwrap().as_deref(), Some("Ciao"));
        assert!(parse_sse_line("event: ping").unwrap().is_none());
        assert!(parse_sse_line(r#"data: {"type":"message_stop"}"#).unwrap().is_none());
        assert!(parse_sse_line(r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#).is_err());
    }
}
