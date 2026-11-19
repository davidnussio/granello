use crate::secrets::ANTHROPIC_ID;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub calendar_event_id: Option<String>,
    pub attendees: Vec<String>,
    pub template_id: Option<String>,
    pub notes_md: String,
    pub enhanced_md: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub has_enhanced: bool,
    pub attendees: Vec<String>,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: i64,
    pub meeting_id: String,
    /// "me" = microfono, "them" = audio di sistema / altri partecipanti
    pub source: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDetail {
    pub meeting: Meeting,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub scope: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// Protocollo parlato da un provider AI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    /// Messages API di Anthropic.
    #[default]
    Anthropic,
    /// Chat Completions compatibile con OpenAI: LM Studio, Ollama, OpenAI, OpenRouter...
    Openai,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Provider {
    /// Identificatore stabile: lega il provider alla sua API key e ai modelli scelti.
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    /// Per i provider compatibili OpenAI comprende `/v1` (es. `http://localhost:1234/v1`).
    /// Vuoto per Anthropic = endpoint ufficiale.
    pub base_url: String,
    /// Finestra di contesto del modello, se nota: serve a bloccare richieste che il server
    /// locale troncherebbe in silenzio.
    pub context_tokens: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelRef {
    pub provider_id: String,
    pub model: String,
}

pub const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5-5";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub user_name: String,
    /// Solo per leggere le impostazioni salvate prima dei provider multipli.
    pub claude_model: String,
    pub providers: Vec<Provider>,
    /// Modello che scrive le note AI.
    pub notes_model: ModelRef,
    /// Modello della chat.
    pub chat_model: ModelRef,
    pub language: String,
    pub whisper_model: String,
    pub mic_device: Option<String>,
    pub system_device: Option<String>,
    pub ics_url: Option<String>,
    pub notify_before_min: i64,
}

impl Settings {
    pub fn with_defaults(mut self) -> Self {
        // Claude c'è sempre: è il provider di partenza e non si può eliminare
        if !self.providers.iter().any(|p| p.id == ANTHROPIC_ID) {
            self.providers.insert(
                0,
                Provider {
                    id: ANTHROPIC_ID.into(),
                    name: "Claude".into(),
                    kind: ProviderKind::Anthropic,
                    ..Default::default()
                },
            );
        }
        if self.notes_model.provider_id.is_empty() {
            // migrazione dal vecchio campo unico
            let model = if self.claude_model.is_empty() { DEFAULT_CLAUDE_MODEL } else { &self.claude_model };
            self.notes_model = ModelRef { provider_id: ANTHROPIC_ID.into(), model: model.to_string() };
        }
        if self.chat_model.provider_id.is_empty() {
            self.chat_model = self.notes_model.clone();
        }
        if self.language.is_empty() {
            self.language = "it".into();
        }
        if self.whisper_model.is_empty() {
            self.whisper_model = "large-v3-turbo-q5_0".into();
        }
        if self.notify_before_min <= 0 {
            self.notify_before_min = 1;
        }
        self
    }
}

impl Settings {
    /// Normalizza e valida le impostazioni in arrivo dall'interfaccia.
    pub fn validated(mut self) -> Result<Self, String> {
        self.user_name = self.user_name.trim().chars().take(80).collect();
        self = self.with_defaults();
        let mut seen = std::collections::HashSet::new();
        for p in self.providers.iter_mut() {
            p.id = p.id.trim().to_string();
            let id_ok = !p.id.is_empty()
                && p.id.len() <= 40
                && p.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            if !id_ok || !seen.insert(p.id.clone()) {
                return Err("Identificatore del provider non valido o duplicato".into());
            }
            p.name = p.name.trim().chars().take(40).collect();
            if p.name.is_empty() {
                return Err("Ogni provider deve avere un nome".into());
            }
            p.base_url = p.base_url.trim().trim_end_matches('/').to_string();
            let url_ok = (p.base_url.starts_with("http://") || p.base_url.starts_with("https://"))
                && !p.base_url.chars().any(char::is_whitespace);
            match p.kind {
                ProviderKind::Anthropic if p.base_url.is_empty() => {}
                _ if url_ok => {}
                _ => return Err(format!("{}: l'indirizzo deve iniziare con http:// o https://", p.name)),
            }
            p.context_tokens = p.context_tokens.filter(|n| *n > 0);
        }
        for (label, m) in [("le note AI", &mut self.notes_model), ("la chat", &mut self.chat_model)] {
            m.model = m.model.trim().to_string();
            if !seen.contains(&m.provider_id) {
                return Err(format!("Il provider scelto per {label} non esiste più"));
            }
            // i nomi dei modelli locali contengono "/" e ":" (es. qwen/qwen3-8b, llama3.2:3b)
            let model_ok = !m.model.is_empty()
                && m.model.len() <= 200
                && m.model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:@/+".contains(c));
            if !model_ok {
                return Err(format!("Scegli un modello valido per {label}"));
            }
        }
        self.language = self.language.trim().to_ascii_lowercase();
        if !(self.language.is_empty() || self.language == "auto" || is_lang_code(&self.language)) {
            return Err("Lingua non valida".into());
        }
        self.ics_url = self.ics_url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
        if let Some(u) = &self.ics_url {
            let ok = ["https://", "http://", "webcal://"].iter().any(|p| u.starts_with(p));
            if !ok || u.chars().any(char::is_whitespace) {
                return Err("L'URL del calendario deve iniziare con https:// o webcal://".into());
            }
        }
        self.mic_device = self.mic_device.filter(|d| !d.is_empty());
        self.system_device = self.system_device.filter(|d| !d.is_empty());
        if self.system_device.is_some() && self.system_device == self.mic_device {
            return Err("Microfono e audio degli altri partecipanti devono essere dispositivi diversi".into());
        }
        self.notify_before_min = self.notify_before_min.clamp(1, 60);
        Ok(self.with_defaults())
    }
}

fn is_lang_code(s: &str) -> bool {
    (2..=3).contains(&s.len()) && s.chars().all(|c| c.is_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_settings() {
        let s = Settings {
            claude_model: "claude-opus-5-5".into(),
            ics_url: Some("  ".into()),
            notify_before_min: 999,
            language: "IT".into(),
            mic_device: Some(String::new()),
            ..Default::default()
        }
        .validated()
        .unwrap();
        // migrazione dal vecchio campo: Claude come provider, stesso modello per note e chat
        assert_eq!(s.providers.len(), 1);
        assert_eq!(s.providers[0].id, "anthropic");
        assert_eq!(s.notes_model, ModelRef { provider_id: "anthropic".into(), model: "claude-opus-5-5".into() });
        assert_eq!(s.chat_model, s.notes_model);
        assert_eq!(s.ics_url, None);
        assert_eq!(s.notify_before_min, 60);
        assert_eq!(s.language, "it");
        assert_eq!(s.mic_device, None);
        assert_eq!(s.whisper_model, "large-v3-turbo-q5_0");

        let bad = |f: fn(&mut Settings)| {
            let mut s = Settings::default();
            f(&mut s);
            s.validated().is_err()
        };
        assert!(bad(|s| s.notes_model = ModelRef { provider_id: "anthropic".into(), model: "claude sonnet\n".into() }));
        assert!(bad(|s| s.chat_model = ModelRef { provider_id: "sparito".into(), model: "x".into() }));
        let local = |url: &str| Provider {
            id: "lmstudio".into(),
            name: "LM Studio".into(),
            kind: ProviderKind::Openai,
            base_url: url.into(),
            context_tokens: Some(0),
        };
        assert!(bad(|s| s.providers.push(Provider { id: "LM Studio".into(), ..Default::default() })));
        let mut s = Settings { providers: vec![local("localhost:1234/v1")], ..Default::default() };
        assert!(s.clone().validated().is_err(), "serve lo schema http(s)");
        s.providers = vec![local(" http://localhost:1234/v1/ ")];
        s.chat_model = ModelRef { provider_id: "lmstudio".into(), model: "qwen/qwen3-8b:q4".into() };
        let s = s.validated().unwrap();
        assert_eq!(s.providers[0].id, "anthropic", "Claude resta sempre disponibile");
        assert_eq!(s.providers[1].base_url, "http://localhost:1234/v1");
        assert_eq!(s.providers[1].context_tokens, None);
        assert_eq!(s.chat_model.provider_id, "lmstudio");
        assert_eq!(s.notes_model.provider_id, "anthropic");
        assert!(bad(|s| s.ics_url = Some("file:///etc/passwd".into())));
        assert!(bad(|s| s.language = "italiano!".into()));
        assert!(bad(|s| {
            s.mic_device = Some("BlackHole 2ch".into());
            s.system_device = Some("BlackHole 2ch".into());
        }));
        assert!(!bad(|s| s.ics_url = Some("webcal://example.com/cal.ics".into())));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: i64,
    pub end: i64,
    pub attendees: Vec<String>,
    pub location: Option<String>,
    pub meeting_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub name: String,
    pub size_mb: u32,
    pub downloaded: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub meeting_id: Option<String>,
    pub recording: bool,
    pub pending_chunks: usize,
}
