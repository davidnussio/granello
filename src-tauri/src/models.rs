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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub user_name: String,
    pub claude_model: String,
    pub language: String,
    pub whisper_model: String,
    pub mic_device: Option<String>,
    pub system_device: Option<String>,
    pub ics_url: Option<String>,
    pub notify_before_min: i64,
}

impl Settings {
    pub fn with_defaults(mut self) -> Self {
        if self.claude_model.is_empty() {
            self.claude_model = "claude-sonnet-5-5".into();
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
        self.claude_model = self.claude_model.trim().to_string();
        if !self.claude_model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:@".contains(c)) {
            return Err("Nome del modello Claude non valido".into());
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
            claude_model: "  claude-opus-5-5 ".into(),
            ics_url: Some("  ".into()),
            notify_before_min: 999,
            language: "IT".into(),
            mic_device: Some(String::new()),
            ..Default::default()
        }
        .validated()
        .unwrap();
        assert_eq!(s.claude_model, "claude-opus-5-5");
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
        assert!(bad(|s| s.claude_model = "claude sonnet\n".into()));
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
