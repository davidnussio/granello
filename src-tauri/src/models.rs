use crate::secrets::ANTHROPIC_ID;
use crate::i18n::tr;
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
    pub tags: Vec<String>,
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
    pub tags: Vec<String>,
    pub snippet: Option<String>,
}

/// Una persona della rubrica: chi ha partecipato (o può partecipare) ai meeting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: i64,
    pub name: String,
    pub email: Option<String>,
    /// In quanti meeting compare.
    pub meetings: i64,
}

/// Proposta per il completamento automatico dei partecipanti.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonSuggestion {
    pub name: String,
    pub email: Option<String>,
    /// "people" = già in rubrica, "calendar" = letta dagli eventi del calendario
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

pub const MAX_TAGS: usize = 12;
pub const MAX_ATTENDEES: usize = 100;

/// Pulisce un elenco di nomi: spazi, doppioni (senza distinguere maiuscole), lunghezza.
pub fn normalize_names(items: Vec<String>, max_len: usize, max_items: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in items {
        let name: String = raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max_len).collect();
        if name.is_empty() || out.iter().any(|o| o.to_lowercase() == name.to_lowercase()) {
            continue;
        }
        out.push(name);
        if out.len() == max_items {
            break;
        }
    }
    out
}

/// Tag: minuscoli, senza `#` iniziale, senza spazi né virgole (diventano trattini).
pub fn normalize_tags(items: Vec<String>) -> Vec<String> {
    let cleaned = items
        .into_iter()
        .map(|t| {
            t.trim()
                .trim_start_matches('#')
                .to_lowercase()
                .split(|c: char| c.is_whitespace() || c == ',')
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join("-")
        })
        .collect();
    normalize_names(cleaned, 32, MAX_TAGS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: i64,
    pub meeting_id: String,
    /// "me" = microfono, "them" = audio di sistema / altri partecipanti,
    /// "file" = file audio caricato (tutte le voci insieme)
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
    /// Lingua dell'interfaccia: "system" (default), "it" o "en".
    pub ui_language: String,
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
        if !matches!(self.ui_language.as_str(), "it" | "en") {
            self.ui_language = "system".into();
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
                return Err(tr("Identificatore del provider non valido o duplicato", "Invalid or duplicate provider identifier").into());
            }
            p.name = p.name.trim().chars().take(40).collect();
            if p.name.is_empty() {
                return Err(tr("Ogni provider deve avere un nome", "Every provider needs a name").into());
            }
            p.base_url = p.base_url.trim().trim_end_matches('/').to_string();
            let url_ok = (p.base_url.starts_with("http://") || p.base_url.starts_with("https://"))
                && !p.base_url.chars().any(char::is_whitespace);
            match p.kind {
                ProviderKind::Anthropic if p.base_url.is_empty() => {}
                _ if url_ok => {}
                _ => return Err(trf!("{}: l'indirizzo deve iniziare con http:// o https://", "{}: the address must start with http:// or https://", p.name)),
            }
            p.context_tokens = p.context_tokens.filter(|n| *n > 0);
        }
        for (label, m) in [(tr("le note AI", "AI notes"), &mut self.notes_model), (tr("la chat", "chat"), &mut self.chat_model)] {
            m.model = m.model.trim().to_string();
            if !seen.contains(&m.provider_id) {
                return Err(trf!("Il provider scelto per {label} non esiste più", "The provider selected for {label} no longer exists"));
            }
            // i nomi dei modelli locali contengono "/" e ":" (es. qwen/qwen3-8b, llama3.2:3b)
            let model_ok = !m.model.is_empty()
                && m.model.len() <= 200
                && m.model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:@/+".contains(c));
            if !model_ok {
                return Err(trf!("Scegli un modello valido per {label}", "Choose a valid model for {label}"));
            }
        }
        self.language = self.language.trim().to_ascii_lowercase();
        if !(self.language.is_empty() || self.language == "auto" || is_lang_code(&self.language)) {
            return Err(tr("Lingua non valida", "Invalid language").into());
        }
        self.ics_url = self.ics_url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
        if let Some(u) = &self.ics_url {
            let ok = ["https://", "http://", "webcal://"].iter().any(|p| u.starts_with(p));
            if !ok || u.chars().any(char::is_whitespace) {
                return Err(tr("L'URL del calendario deve iniziare con https:// o webcal://", "The calendar URL must start with https:// or webcal://").into());
            }
        }
        self.mic_device = self.mic_device.filter(|d| !d.is_empty());
        self.system_device = self.system_device.filter(|d| !d.is_empty());
        if self.system_device.is_some() && self.system_device == self.mic_device {
            return Err(tr("Microfono e audio degli altri partecipanti devono essere dispositivi diversi", "The microphone and the other participants' audio must be different devices").into());
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
    fn normalizes_tags_and_names() {
        assert_eq!(
            normalize_tags(vec!["#Cliente".into(), " cliente ".into(), "Sprint Review".into(), "#".into()]),
            vec!["cliente", "sprint-review"]
        );
        assert_eq!(normalize_tags((0..40).map(|i| format!("t{i}")).collect()).len(), MAX_TAGS);
        assert_eq!(
            normalize_names(vec!["  Anna   Rossi ".into(), "anna rossi".into(), "".into(), "Luca".into()], 80, 10),
            vec!["Anna Rossi", "Luca"]
        );
    }

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
    /// true se la sessione in corso trascrive un file caricato invece dell'audio live.
    pub importing: bool,
    pub pending_chunks: usize,
}
