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
