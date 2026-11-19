//! Client di streaming per i modelli AI. Due protocolli coprono tutti i provider:
//! la Messages API di Anthropic e le Chat Completions compatibili con OpenAI
//! (LM Studio, Ollama, OpenAI, OpenRouter...).
//!
//! Gestisce: riprova automatica sugli errori transitori (429, 5xx, 529, rete),
//! annullamento da parte dell'utente, motivo di arresto (`stop_reason`) e
//! prompt caching del system prompt per le conversazioni a più turni.

use crate::models::ProviderKind;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
const API_VERSION: &str = "2023-06-01";
const MAX_ATTEMPTS: u32 = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);
/// Ogni quanto si controlla la richiesta di annullamento mentre si aspetta la rete.
const CANCEL_POLL: Duration = Duration::from_millis(250);

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Generazione annullata")]
    Cancelled,
    #[error("API key non valida o mancante. Controllala nelle Impostazioni.")]
    Auth,
    #[error("Errore del modello ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("Il modello ha rifiutato la richiesta")]
    Refused,
    #[error("La risposta si è interrotta prima della fine. Riprova.")]
    Interrupted,
    #[error("Impossibile raggiungere {name} ({url}). Controlla che il server sia avviato.")]
    Unreachable { name: String, url: String },
    #[error("Errore di rete: {0}")]
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
    pub kind: ProviderKind,
    /// Nome del provider, per i messaggi di errore.
    pub provider_name: &'a str,
    /// Vuoto = endpoint ufficiale (solo Anthropic).
    pub base_url: &'a str,
    /// I server locali di solito non ne vogliono una.
    pub api_key: Option<&'a str>,
    pub model: &'a str,
    pub system: &'a str,
    pub messages: &'a [Msg],
    pub max_tokens: u32,
    /// Mette in cache il system prompt: conviene solo se verrà riusato identico
    /// entro pochi minuti (chat a più turni sullo stesso meeting). Solo Anthropic.
    pub cache_system: bool,
}

#[derive(Debug)]
pub struct Completion {
    pub text: String,
    /// La risposta ha raggiunto `max_tokens` ed è stata troncata.
    pub truncated: bool,
}

fn endpoint(req: &Request) -> String {
    let base = req.base_url.trim_end_matches('/');
    match req.kind {
        ProviderKind::Anthropic => {
            format!("{}/v1/messages", if base.is_empty() { ANTHROPIC_BASE } else { base })
        }
        ProviderKind::Openai => format!("{base}/chat/completions"),
    }
}

fn body(req: &Request) -> Value {
    if req.kind == ProviderKind::Openai {
        let mut messages = vec![json!({ "role": "system", "content": req.system })];
        messages.extend(req.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })));
        // Niente limite di token in uscita: il nome del parametro cambia tra server
        // (max_tokens / max_completion_tokens) e senza limite ognuno usa il massimo del modello.
        return json!({ "model": req.model, "messages": messages, "stream": true });
    }
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
    let url = endpoint(req);
    let mut attempt = 0;
    loop {
        attempt += 1;
        let mut builder = client.post(&url).json(&body);
        builder = match (req.kind, req.api_key) {
            (ProviderKind::Anthropic, key) => {
                builder.header("x-api-key", key.unwrap_or_default()).header("anthropic-version", API_VERSION)
            }
            (ProviderKind::Openai, Some(key)) => builder.bearer_auth(key),
            (ProviderKind::Openai, None) => builder,
        };
        let sent = cancellable(builder.send(), cancel).await?;
        let resp = match sent {
            Ok(r) => r,
            // un server locale spento non riparte da solo: inutile far aspettare l'utente
            Err(e) if e.is_connect() && req.kind == ProviderKind::Openai => {
                return Err(LlmError::Unreachable { name: req.provider_name.into(), url: req.base_url.into() });
            }
            Err(e) if attempt < MAX_ATTEMPTS && (e.is_connect() || e.is_timeout()) => {
                log::warn!("{}: errore di rete (tentativo {attempt}): {e}", req.provider_name);
                sleep_cancellable(backoff(attempt, None), cancel).await?;
                continue;
            }
            Err(e) => return Err(LlmError::Network(e.without_url().to_string())),
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
            log::warn!("{}: HTTP {status} (tentativo {attempt}), riprovo", req.provider_name);
            sleep_cancellable(backoff(attempt, retry_after), cancel).await?;
            continue;
        }
        if status == 401 || status == 403 {
            return Err(LlmError::Auth);
        }
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::Api { status, message: error_message(&text) });
    }
}

/// Estrae il messaggio da un corpo di errore: `{"error":{"message":..}}` (Anthropic, OpenAI)
/// oppure `{"error":".."}` (Ollama); altrimenti il testo così com'è, accorciato.
fn error_message(body: &str) -> String {
    let v = serde_json::from_str::<Value>(body).ok();
    v.as_ref()
        .and_then(|v| v["error"]["message"].as_str().or_else(|| v["error"].as_str()))
        .map(String::from)
        .unwrap_or_else(|| body.chars().take(300).collect())
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
    let kind = req.kind;
    // i modelli locali "ragionanti" scrivono il ragionamento nel testo, tra <think> e </think>
    let mut think = (kind == ProviderKind::Openai).then(ThinkFilter::default);
    let mut handle = |line: &str, full: &mut String, stop: &mut Option<String>| -> Result<(), LlmError> {
        let event = match kind {
            ProviderKind::Anthropic => parse_sse_line(line)?,
            ProviderKind::Openai => parse_openai_line(line)?,
        };
        match event {
            Sse::Text(t) => {
                let t = match think.as_mut() {
                    Some(f) => f.push(&t),
                    None => t,
                };
                if !t.is_empty() {
                    full.push_str(&t);
                    on_delta(&t);
                }
            }
            // il primo motivo di arresto vince: il [DONE] finale non lo sovrascrive
            Sse::Stop(r) => {
                stop.get_or_insert(r);
            }
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
    drop(handle);
    if let Some(mut f) = think {
        full.push_str(&f.finish());
    }

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

/// Interpreta una riga SSE delle Chat Completions. I motivi di arresto sono tradotti
/// in quelli di Anthropic, così il resto del codice ne gestisce una sola serie.
fn parse_openai_line(line: &str) -> Result<Sse, LlmError> {
    let Some(data) = line.strip_prefix("data:") else { return Ok(Sse::Other) };
    let data = data.trim();
    if data == "[DONE]" {
        return Ok(Sse::Stop("end_turn".into()));
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else { return Ok(Sse::Other) };
    if !v["error"].is_null() {
        return Err(LlmError::Api { status: 500, message: error_message(data) });
    }
    let choice = &v["choices"][0];
    // `reasoning_content` (ragionamento separato dal testo) viene ignorato di proposito
    if let Some(t) = choice["delta"]["content"].as_str().filter(|t| !t.is_empty()) {
        return Ok(Sse::Text(t.into()));
    }
    Ok(match choice["finish_reason"].as_str() {
        Some("length") => Sse::Stop("max_tokens".into()),
        Some("content_filter") => Sse::Stop("refusal".into()),
        Some(_) => Sse::Stop("end_turn".into()),
        None => Sse::Other,
    })
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Toglie dallo streaming il blocco `<think>…</think>` con cui alcuni modelli locali
/// aprono la risposta. I tag possono arrivare spezzati tra due frammenti.
#[derive(Default)]
struct ThinkFilter {
    buf: String,
    inside: bool,
    /// È già uscito del testo vero: da qui in poi non si filtra più nulla.
    started: bool,
}

/// Lunghezza del più lungo suffisso di `s` che è un prefisso proprio di `tag`.
fn partial_tag_len(s: &str, tag: &str) -> usize {
    (1..tag.len()).rev().find(|&k| s.ends_with(&tag[..k])).unwrap_or(0)
}

impl ThinkFilter {
    fn push(&mut self, chunk: &str) -> String {
        if self.started {
            return chunk.to_string();
        }
        self.buf.push_str(chunk);
        loop {
            if self.inside {
                match self.buf.find(THINK_CLOSE) {
                    Some(i) => {
                        self.buf.drain(..i + THINK_CLOSE.len());
                        self.inside = false;
                    }
                    None => {
                        // si tiene solo la coda che potrebbe essere l'inizio di </think>
                        let keep = partial_tag_len(&self.buf, THINK_CLOSE);
                        self.buf.drain(..self.buf.len() - keep);
                        return String::new();
                    }
                }
            } else {
                let lead = self.buf.trim_start();
                if lead.starts_with(THINK_OPEN) {
                    let skip = self.buf.len() - lead.len() + THINK_OPEN.len();
                    self.buf.drain(..skip);
                    self.inside = true;
                } else if lead.is_empty() || THINK_OPEN.starts_with(lead) {
                    return String::new(); // ancora presto per decidere
                } else {
                    self.started = true;
                    // gli a capo dopo </think> non fanno parte della risposta
                    let out = self.buf.trim_start().to_string();
                    self.buf.clear();
                    return out;
                }
            }
        }
    }

    /// Fine dello stream: restituisce quello che era rimasto in sospeso.
    fn finish(&mut self) -> String {
        if self.inside || self.started {
            return String::new();
        }
        std::mem::take(&mut self.buf).trim_start().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(chunks: &[&str]) -> String {
        let mut f = ThinkFilter::default();
        let mut out: String = chunks.iter().map(|c| f.push(c)).collect();
        out.push_str(&f.finish());
        out
    }

    #[test]
    fn strips_leading_think_block() {
        assert_eq!(filter(&["<think>ragiono</think>\n\n### Note"]), "### Note");
        // tag spezzati tra i frammenti
        assert_eq!(filter(&["<th", "ink>a <b> c</thi", "nk>\n", "Ciao ", "mondo"]), "Ciao mondo");
        // nessun blocco: tutto passa, compreso un "<" iniziale che non è un tag
        assert_eq!(filter(&["<", "b>grassetto"]), "<b>grassetto");
        assert_eq!(filter(&["Ciao", " <think>x</think>"]), "Ciao <think>x</think>");
        // blocco mai chiuso (risposta troncata): nessun ragionamento finisce nelle note
        assert_eq!(filter(&["<think>non finisco"]), "");
        assert_eq!(filter(&["<thi"]), "<thi");
        assert_eq!(filter(&["  \n", "<think>è</think>", "ok"]), "ok");
    }

    #[test]
    fn parses_openai_sse() {
        let t = r#"data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Ciao"},"finish_reason":null}]}"#;
        assert_eq!(parse_openai_line(t).unwrap(), Sse::Text("Ciao".into()));
        let r = r#"data: {"choices":[{"delta":{"reasoning_content":"penso"},"finish_reason":null}]}"#;
        assert_eq!(parse_openai_line(r).unwrap(), Sse::Other);
        let stop = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        assert_eq!(parse_openai_line(stop).unwrap(), Sse::Stop("end_turn".into()));
        let len = r#"data: {"choices":[{"delta":{},"finish_reason":"length"}]}"#;
        assert_eq!(parse_openai_line(len).unwrap(), Sse::Stop("max_tokens".into()));
        assert_eq!(parse_openai_line("data: [DONE]").unwrap(), Sse::Stop("end_turn".into()));
        // blocco finale con solo l'uso dei token
        assert_eq!(parse_openai_line(r#"data: {"choices":[],"usage":{"total_tokens":3}}"#).unwrap(), Sse::Other);
        assert!(parse_openai_line(r#"data: {"error":{"message":"model not loaded"}}"#).is_err());
        assert_eq!(error_message(r#"{"error":"model 'x' not found"}"#), "model 'x' not found");
        assert_eq!(error_message(r#"{"error":{"message":"boom"}}"#), "boom");
        assert_eq!(error_message("<html>502</html>"), "<html>502</html>");
    }

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
        let mut req = Request {
            kind: ProviderKind::Anthropic,
            provider_name: "Claude",
            base_url: "",
            api_key: Some("k"),
            model: "m",
            system: "sys",
            messages: &msgs,
            max_tokens: 10,
            cache_system: false,
        };
        assert_eq!(endpoint(&req), "https://api.anthropic.com/v1/messages");
        assert!(body(&req)["system"][0].get("cache_control").is_none());
        req.cache_system = true;
        let b = body(&req);
        assert_eq!(b["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["stream"], true);

        req.kind = ProviderKind::Openai;
        req.base_url = "http://localhost:1234/v1/";
        assert_eq!(endpoint(&req), "http://localhost:1234/v1/chat/completions");
        let b = body(&req);
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][0]["content"], "sys");
        assert_eq!(b["messages"][1]["content"], "ciao");
        assert!(b.get("system").is_none() && b.get("max_tokens").is_none());

        assert!(retryable(529) && retryable(429) && !retryable(400) && !retryable(401));
        assert_eq!(backoff(1, None), Duration::from_secs(1));
        assert_eq!(backoff(2, None), Duration::from_secs(2));
        assert_eq!(backoff(1, Some(Duration::from_secs(300))), MAX_RETRY_WAIT);
    }

    /// Server HTTP usa e getta: risponde alla prima richiesta con `response` e
    /// restituisce la richiesta ricevuta.
    async fn serve_once(response: String) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut req = Vec::new();
            let mut buf = [0u8; 4096];
            // legge intestazioni + corpo (Content-Length)
            loop {
                let n = sock.read(&mut buf).await.unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req);
                if let Some(end) = text.find("\r\n\r\n") {
                    let len = text
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if req.len() >= end + 4 + len || n == 0 {
                        break;
                    }
                }
            }
            sock.write_all(response.as_bytes()).await.unwrap();
            sock.shutdown().await.ok();
            String::from_utf8_lossy(&req).into_owned()
        });
        (base, handle)
    }

    fn sse(events: &[&str]) -> String {
        let body: String = events.iter().map(|e| format!("data: {e}\n\n")).collect();
        format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n{body}")
    }

    fn openai_req<'a>(base: &'a str, msgs: &'a [Msg], key: Option<&'a str>) -> Request<'a> {
        Request {
            kind: ProviderKind::Openai,
            provider_name: "Locale",
            base_url: base,
            api_key: key,
            model: "qwen/qwen3",
            system: "sys",
            messages: msgs,
            max_tokens: 100,
            cache_system: true,
        }
    }

    #[tokio::test]
    async fn streams_from_openai_compatible_server() {
        let (base, server) = serve_once(sse(&[
            r#"{"choices":[{"delta":{"role":"assistant","content":"<think>vediamo"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"content":"</think>\n\n### No"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{"content":"te è ok"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
            "[DONE]",
        ]))
        .await;
        let msgs = [Msg::user("ciao")];
        let mut deltas = Vec::new();
        let done = stream_message(
            &reqwest::Client::new(),
            &openai_req(&base, &msgs, Some("sk-test")),
            &AtomicBool::new(false),
            |d| deltas.push(d.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(done.text, "### Note è ok");
        assert_eq!(deltas.concat(), "### Note è ok", "il ragionamento non arriva all'interfaccia");
        assert!(done.truncated, "finish_reason=length non viene sovrascritto da [DONE]");

        let request = server.await.unwrap();
        assert!(request.starts_with("POST /v1/chat/completions "));
        assert!(request.to_lowercase().contains("authorization: bearer sk-test"));
        assert!(request.contains(r#""model":"qwen/qwen3""#));
        assert!(!request.contains("cache_control") && !request.contains("x-api-key"));
    }

    #[tokio::test]
    async fn reports_server_errors_and_unreachable_hosts() {
        let body = r#"{"error":"model 'x' not found"}"#;
        let (base, _server) = serve_once(format!(
            "HTTP/1.1 404 Not Found\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        ))
        .await;
        let msgs = [Msg::user("ciao")];
        let cancel = AtomicBool::new(false);
        let client = reqwest::Client::new();
        let err = stream_message(&client, &openai_req(&base, &msgs, None), &cancel, |_| {}).await.unwrap_err();
        assert!(matches!(&err, LlmError::Api { status: 404, message } if message == "model 'x' not found"), "{err}");

        // porta chiusa: errore immediato e comprensibile, senza tentativi ripetuti
        let started = std::time::Instant::now();
        let err = stream_message(&client, &openai_req("http://127.0.0.1:1/v1", &msgs, None), &cancel, |_| {})
            .await
            .unwrap_err();
        assert!(matches!(err, LlmError::Unreachable { .. }), "{err}");
        assert!(started.elapsed() < Duration::from_secs(1));

        // stream chiuso senza motivo di arresto né [DONE]
        let (base, _server) =
            serve_once(sse(&[r#"{"choices":[{"delta":{"content":"a metà"},"finish_reason":null}]}"#])).await;
        let err = stream_message(&client, &openai_req(&base, &msgs, None), &cancel, |_| {}).await.unwrap_err();
        assert!(matches!(err, LlmError::Interrupted), "{err}");
    }

    #[tokio::test]
    async fn cancel_interrupts_waits() {
        let cancel = AtomicBool::new(true);
        assert!(matches!(sleep_cancellable(Duration::from_secs(60), &cancel).await, Err(LlmError::Cancelled)));
        let never = std::future::pending::<()>();
        assert!(matches!(cancellable(never, &cancel).await, Err(LlmError::Cancelled)));
    }
}
