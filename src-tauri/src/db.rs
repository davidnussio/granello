use crate::models::*;
use crate::i18n::tr;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct Db {
    conn: Connection,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Migrazioni in ordine: l'indice + 1 è la `user_version` del database.
/// Mai modificare una migrazione già rilasciata: se ne aggiunge una nuova in coda.
const MIGRATIONS: &[&str] = &[SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

/// Progetti: tag promossi, che la Libreria mostra a parte e che si possono archiviare.
/// Il legame con i meeting resta il tag: qui c'è solo quali tag sono progetti.
const SCHEMA_V3: &str = r#"
CREATE TABLE projects (
    tag TEXT PRIMARY KEY,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
"#;

/// Tag sui meeting e rubrica delle persone (popolata con i partecipanti già presenti).
const SCHEMA_V2: &str = r#"
ALTER TABLE meetings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO people (name, created_at, last_used_at)
SELECT TRIM(j.value), m.created_at, m.created_at
FROM meetings m, json_each(m.attendees) j
WHERE TRIM(j.value) != '';
"#;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    calendar_event_id TEXT,
    attendees TEXT NOT NULL DEFAULT '[]',
    template_id TEXT,
    notes_md TEXT NOT NULL DEFAULT '',
    enhanced_md TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, start_ms);

CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL,
    builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_scope ON chat_messages(scope, id);

CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
    meeting_id UNINDEXED, title, notes, enhanced, transcript,
    tokenize = 'unicode61 remove_diacritics 2'
);
"#;

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")?;
        let db = Db { conn };
        db.migrate()?;
        db.seed_templates()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let current: usize = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current > MIGRATIONS.len() {
            return Err(crate::tra!(
                "Il database è stato creato da una versione più recente di Granello (schema {current}). Aggiorna l'app.",
                "This database was created by a newer version of Granello (schema {current}). Update the app."
            ));
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i + 1)?;
            tx.commit()?;
            log::info!("database migrato allo schema {}", i + 1);
        }
        if current < MIGRATIONS.len() {
            // l'indice di ricerca può aver cambiato contenuto (es. tag e partecipanti)
            self.reindex_all()?;
        }
        Ok(())
    }

    fn reindex_all(&self) -> Result<()> {
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT id FROM meetings")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for id in ids {
            self.reindex(&id)?;
        }
        Ok(())
    }

    /// Chiude i meeting rimasti "in registrazione" dopo un crash o una chiusura forzata
    /// e ne reindicizza la trascrizione. Ritorna quanti ne ha sistemati.
    pub fn recover_interrupted(&self) -> Result<usize> {
        let ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM meetings WHERE started_at IS NOT NULL AND ended_at IS NULL")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for id in &ids {
            self.mark_ended(id)?;
        }
        Ok(ids.len())
    }

    /// Inserisce o aggiorna i template di sistema nella lingua corrente dell'interfaccia.
    pub fn seed_templates(&self) -> Result<()> {
        for t in crate::prompts::builtin_templates() {
            self.conn.execute(
                "INSERT INTO templates (id, name, description, instructions, builtin) VALUES (?1, ?2, ?3, ?4, 1)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
                 instructions = excluded.instructions WHERE templates.builtin = 1",
                params![t.id, t.name, t.description, t.instructions],
            )?;
        }
        Ok(())
    }

    // ---------- meetings ----------

    fn row_to_meeting(row: &rusqlite::Row) -> rusqlite::Result<Meeting> {
        let attendees: String = row.get("attendees")?;
        let tags: String = row.get("tags")?;
        Ok(Meeting {
            id: row.get("id")?,
            title: row.get("title")?,
            created_at: row.get("created_at")?,
            started_at: row.get("started_at")?,
            ended_at: row.get("ended_at")?,
            calendar_event_id: row.get("calendar_event_id")?,
            attendees: serde_json::from_str(&attendees).unwrap_or_default(),
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            template_id: row.get("template_id")?,
            notes_md: row.get("notes_md")?,
            enhanced_md: row.get("enhanced_md")?,
        })
    }

    pub fn create_meeting(
        &self,
        title: &str,
        calendar_event_id: Option<&str>,
        attendees: &[String],
        template_id: Option<&str>,
    ) -> Result<Meeting> {
        let id = uuid::Uuid::new_v4().to_string();
        let title = if title.trim().is_empty() { tr("Nuovo meeting", "New meeting") } else { title.trim() };
        self.conn.execute(
            "INSERT INTO meetings (id, title, created_at, calendar_event_id, attendees, template_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                title,
                now_ms(),
                calendar_event_id,
                serde_json::to_string(attendees)?,
                template_id
            ],
        )?;
        self.upsert_people(&attendees.iter().map(|a| (a.clone(), None)).collect::<Vec<_>>())?;
        self.reindex(&id)?;
        self.get_meeting(&id)?.ok_or_else(|| anyhow::anyhow!("meeting non trovato dopo insert"))
    }

    pub fn get_meeting(&self, id: &str) -> Result<Option<Meeting>> {
        Ok(self
            .conn
            .query_row("SELECT * FROM meetings WHERE id = ?1", [id], Self::row_to_meeting)
            .optional()?)
    }

    pub fn meeting_for_event(&self, event_id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id FROM meetings WHERE calendar_event_id = ?1 ORDER BY created_at DESC LIMIT 1",
                [event_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn update_meeting(
        &self,
        id: &str,
        title: Option<&str>,
        notes_md: Option<&str>,
        enhanced_md: Option<&str>,
        template_id: Option<&str>,
    ) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        if let Some(t) = title {
            self.conn.execute("UPDATE meetings SET title = ?1 WHERE id = ?2", params![t, id])?;
        }
        if let Some(n) = notes_md {
            self.conn.execute("UPDATE meetings SET notes_md = ?1 WHERE id = ?2", params![n, id])?;
        }
        if let Some(e) = enhanced_md {
            self.conn.execute("UPDATE meetings SET enhanced_md = ?1 WHERE id = ?2", params![e, id])?;
        }
        if let Some(t) = template_id {
            let t = if t.is_empty() { None } else { Some(t) };
            self.conn.execute("UPDATE meetings SET template_id = ?1 WHERE id = ?2", params![t, id])?;
        }
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    /// Sostituisce i partecipanti del meeting e li aggiunge alla rubrica.
    /// `people`: (nome, email se nota).
    pub fn set_attendees(&self, id: &str, people: &[(String, Option<String>)]) -> Result<()> {
        let names: Vec<&str> = people.iter().map(|(n, _)| n.as_str()).collect();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE meetings SET attendees = ?1 WHERE id = ?2",
            params![serde_json::to_string(&names)?, id],
        )?;
        self.upsert_people(people)?;
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_tags(&self, id: &str, tags: &[String]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE meetings SET tags = ?1 WHERE id = ?2", params![serde_json::to_string(tags)?, id])?;
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    /// Tag usati, dal più frequente.
    pub fn all_tags(&self) -> Result<Vec<TagCount>> {
        let mut stmt = self.conn.prepare(
            "SELECT j.value, COUNT(*) FROM meetings m, json_each(m.tags) j
             GROUP BY j.value ORDER BY COUNT(*) DESC, j.value",
        )?;
        let rows = stmt.query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    // ---------- progetti ----------

    /// I tag promossi a progetto, in ordine alfabetico.
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let mut stmt = self.conn.prepare("SELECT tag, archived FROM projects ORDER BY tag")?;
        let rows = stmt.query_map([], |r| Ok(Project { tag: r.get(0)?, archived: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// `Some(archived)`: il tag è un progetto, attivo o archiviato. `None`: torna un tag normale.
    pub fn set_project(&self, tag: &str, archived: Option<bool>) -> Result<()> {
        match archived {
            Some(archived) => self.conn.execute(
                "INSERT INTO projects (tag, archived, created_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(tag) DO UPDATE SET archived = excluded.archived",
                params![tag, archived, now_ms()],
            )?,
            None => self.conn.execute("DELETE FROM projects WHERE tag = ?1", [tag])?,
        };
        Ok(())
    }

    // ---------- rubrica ----------

    /// Aggiunge le persone mancanti e aggiorna "ultimo uso" (ed email, se prima mancava).
    pub fn upsert_people(&self, people: &[(String, Option<String>)]) -> Result<()> {
        let now = now_ms();
        for (name, email) in people {
            if name.trim().is_empty() {
                continue;
            }
            self.conn.execute(
                "INSERT INTO people (name, email, created_at, last_used_at) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(name) DO UPDATE SET last_used_at = excluded.last_used_at,
                 email = COALESCE(people.email, excluded.email)",
                params![name.trim(), email, now],
            )?;
        }
        Ok(())
    }

    /// Rubrica completa, con il numero di meeting di ogni persona.
    pub fn list_people(&self) -> Result<Vec<Person>> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, p.email,
                    (SELECT COUNT(*) FROM meetings m, json_each(m.attendees) j WHERE j.value = p.name COLLATE NOCASE)
             FROM people p ORDER BY p.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Person { id: r.get(0)?, name: r.get(1)?, email: r.get(2)?, meetings: r.get(3)? })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Persone il cui nome (o email) contiene `query`, le usate più di recente per prime.
    pub fn search_people(&self, query: &str, limit: usize) -> Result<Vec<Person>> {
        let like = format!("%{}%", query.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email, 0 FROM people
             WHERE name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\'
             ORDER BY last_used_at DESC, name LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like, limit as i64], |r| {
            Ok(Person { id: r.get(0)?, name: r.get(1)?, email: r.get(2)?, meetings: r.get(3)? })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Toglie una persona dalla rubrica. I meeting a cui ha partecipato non cambiano.
    pub fn delete_person(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM people WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mark_started(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE meetings SET started_at = COALESCE(started_at, ?1), ended_at = NULL WHERE id = ?2",
            params![now_ms(), id],
        )?;
        Ok(())
    }

    pub fn mark_ended(&self, id: &str) -> Result<()> {
        self.conn
            .execute("UPDATE meetings SET ended_at = ?1 WHERE id = ?2", params![now_ms(), id])?;
        self.reindex(id)?;
        Ok(())
    }

    pub fn delete_meeting(&self, id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM meetings WHERE id = ?1", [id])?;
        tx.execute("DELETE FROM meetings_fts WHERE meeting_id = ?1", [id])?;
        tx.execute("DELETE FROM chat_messages WHERE scope = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    /// true se qualche meeting cita ancora quell'allegato nelle note o nelle note AI.
    pub fn attachment_in_use(&self, path: &str) -> Result<bool> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM meetings WHERE instr(notes_md, ?1) > 0 OR instr(COALESCE(enhanced_md, ''), ?1) > 0",
            [path],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    pub fn list_meetings(&self, query: Option<&str>) -> Result<Vec<MeetingSummary>> {
        let q = query.map(str::trim).filter(|q| !q.is_empty());
        let mut out = Vec::new();
        match q {
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT id, title, created_at, enhanced_md IS NOT NULL AND enhanced_md != '', attendees, tags
                     FROM meetings ORDER BY created_at DESC",
                )?;
                let rows = stmt.query_map([], |r| {
                    let att: String = r.get(4)?;
                    let tags: String = r.get(5)?;
                    Ok(MeetingSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        created_at: r.get(2)?,
                        has_enhanced: r.get(3)?,
                        attendees: serde_json::from_str(&att).unwrap_or_default(),
                        tags: serde_json::from_str(&tags).unwrap_or_default(),
                        snippet: None,
                    })
                })?;
                for r in rows {
                    out.push(r?);
                }
            }
            Some(q) => {
                let fts = fts_query(q);
                if fts.is_empty() {
                    return Ok(out);
                }
                let mut stmt = self.conn.prepare(
                    "SELECT m.id, m.title, m.created_at,
                            m.enhanced_md IS NOT NULL AND m.enhanced_md != '', m.attendees,
                            snippet(meetings_fts, -1, '«', '»', '…', 12), m.tags
                     FROM meetings_fts f JOIN meetings m ON m.id = f.meeting_id
                     WHERE meetings_fts MATCH ?1
                     ORDER BY bm25(meetings_fts, 0.0, 10.0, 4.0, 3.0, 1.0) LIMIT 50",
                )?;
                let rows = stmt.query_map([fts], |r| {
                    let att: String = r.get(4)?;
                    let tags: String = r.get(6)?;
                    Ok(MeetingSummary {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        created_at: r.get(2)?,
                        has_enhanced: r.get(3)?,
                        attendees: serde_json::from_str(&att).unwrap_or_default(),
                        tags: serde_json::from_str(&tags).unwrap_or_default(),
                        snippet: r.get(5)?,
                    })
                })?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    /// Meeting piu' rilevanti per una domanda (chat globale): ricerca FTS + i piu' recenti.
    pub fn relevant_meetings(&self, question: &str, limit: usize) -> Result<Vec<Meeting>> {
        let mut ids: Vec<String> = Vec::new();
        let fts = fts_query_any(question);
        if !fts.is_empty() {
            let mut stmt = self.conn.prepare(
                "SELECT meeting_id FROM meetings_fts WHERE meetings_fts MATCH ?1
                 ORDER BY bm25(meetings_fts, 0.0, 10.0, 4.0, 3.0, 1.0) LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![fts, limit as i64], |r| r.get::<_, String>(0))?;
            for r in rows {
                ids.push(r?);
            }
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM meetings ORDER BY created_at DESC LIMIT ?1")?;
        let recent = stmt.query_map([limit as i64], |r| r.get::<_, String>(0))?;
        for r in recent {
            let id = r?;
            if ids.len() >= limit * 2 {
                break;
            }
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        let mut out = Vec::new();
        for id in ids {
            if let Some(m) = self.get_meeting(&id)? {
                out.push(m);
            }
        }
        Ok(out)
    }

    fn reindex(&self, id: &str) -> Result<()> {
        let Some(m) = self.get_meeting(id)? else { return Ok(()) };
        let transcript = self
            .segments(id)?
            .into_iter()
            .map(|s| s.text)
            .collect::<Vec<_>>()
            .join(" ");
        self.conn.execute("DELETE FROM meetings_fts WHERE meeting_id = ?1", [id])?;
        self.conn.execute(
            "INSERT INTO meetings_fts (meeting_id, title, notes, enhanced, transcript) VALUES (?1, ?2, ?3, ?4, ?5)",
            // tag e partecipanti stanno con il titolo: così si trovano cercandoli
            params![
                id,
                [m.title.as_str(), &m.tags.join(" "), &m.attendees.join(" ")].join(" · ").trim_end_matches([' ', '·']),
                m.notes_md,
                m.enhanced_md.unwrap_or_default(),
                transcript
            ],
        )?;
        Ok(())
    }

    // ---------- transcript ----------

    pub fn add_segment(
        &self,
        meeting_id: &str,
        source: &str,
        start_ms: i64,
        end_ms: i64,
        text: &str,
    ) -> Result<TranscriptSegment> {
        self.conn.execute(
            "INSERT INTO transcript_segments (meeting_id, source, start_ms, end_ms, text) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![meeting_id, source, start_ms, end_ms, text],
        )?;
        Ok(TranscriptSegment {
            id: self.conn.last_insert_rowid(),
            meeting_id: meeting_id.into(),
            source: source.into(),
            start_ms,
            end_ms,
            text: text.into(),
        })
    }

    /// Offset (ms) da cui riprendere se si registra di nuovo sullo stesso meeting.
    pub fn transcript_end_ms(&self, meeting_id: &str) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(end_ms), 0) FROM transcript_segments WHERE meeting_id = ?1",
            [meeting_id],
            |r| r.get(0),
        )?)
    }

    pub fn segments(&self, meeting_id: &str) -> Result<Vec<TranscriptSegment>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, meeting_id, source, start_ms, end_ms, text FROM transcript_segments
             WHERE meeting_id = ?1 ORDER BY start_ms, id",
        )?;
        let rows = stmt.query_map([meeting_id], |r| {
            Ok(TranscriptSegment {
                id: r.get(0)?,
                meeting_id: r.get(1)?,
                source: r.get(2)?,
                start_ms: r.get(3)?,
                end_ms: r.get(4)?,
                text: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- templates ----------

    pub fn list_templates(&self) -> Result<Vec<Template>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, instructions, builtin FROM templates ORDER BY builtin DESC, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Template {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                instructions: r.get(3)?,
                builtin: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_template(&self, id: &str) -> Result<Option<Template>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, description, instructions, builtin FROM templates WHERE id = ?1",
                [id],
                |r| {
                    Ok(Template {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        description: r.get(2)?,
                        instructions: r.get(3)?,
                        builtin: r.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn save_template(&self, t: &Template) -> Result<Template> {
        let id = if t.id.is_empty() || t.builtin {
            // i template di sistema non si sovrascrivono: si salva una copia
            uuid::Uuid::new_v4().to_string()
        } else {
            t.id.clone()
        };
        self.conn.execute(
            "INSERT INTO templates (id, name, description, instructions, builtin) VALUES (?1, ?2, ?3, ?4, 0)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             instructions = excluded.instructions",
            params![id, t.name, t.description, t.instructions],
        )?;
        self.get_template(&id)?.ok_or_else(|| anyhow::anyhow!("template non salvato"))
    }

    pub fn delete_template(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM templates WHERE id = ?1 AND builtin = 0", [id])?;
        Ok(())
    }

    // ---------- settings ----------

    pub fn get_settings(&self) -> Result<Settings> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| r.get(0))
            .optional()?;
        let s: Settings = raw
            .and_then(|r| serde_json::from_str(&r).ok())
            .unwrap_or_default();
        Ok(s.with_defaults())
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [serde_json::to_string(s)?],
        )?;
        Ok(())
    }

    // ---------- chat ----------

    pub fn chat_history(&self, scope: &str) -> Result<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, scope, role, content, created_at FROM chat_messages WHERE scope = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map([scope], |r| {
            Ok(ChatMessage {
                id: r.get(0)?,
                scope: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn add_chat_message(&self, scope: &str, role: &str, content: &str) -> Result<ChatMessage> {
        let ts = now_ms();
        self.conn.execute(
            "INSERT INTO chat_messages (scope, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![scope, role, content, ts],
        )?;
        Ok(ChatMessage {
            id: self.conn.last_insert_rowid(),
            scope: scope.into(),
            role: role.into(),
            content: content.into(),
            created_at: ts,
        })
    }

    pub fn delete_chat_message(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM chat_messages WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_chat(&self, scope: &str) -> Result<()> {
        self.conn.execute("DELETE FROM chat_messages WHERE scope = ?1", [scope])?;
        Ok(())
    }
}

fn tokens(q: &str) -> Vec<String> {
    q.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 2)
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect()
}

/// Query FTS5 per la ricerca nella sidebar: tutti i termini, ultimo come prefisso.
fn fts_query(q: &str) -> String {
    let toks = tokens(q);
    toks.iter()
        .enumerate()
        .map(|(i, t)| if i == toks.len() - 1 { format!("{t}*") } else { t.clone() })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Query FTS5 per la chat: basta un termine significativo (OR).
fn fts_query_any(q: &str) -> String {
    const STOP: &[&str] = &[
        "il", "lo", "la", "le", "gli", "un", "una", "di", "da", "in", "con", "su", "per", "tra", "fra",
        "che", "chi", "cosa", "come", "quando", "dove", "perché", "abbiamo", "ho", "hai", "ha", "è",
        "the", "and", "what", "who", "when", "did", "we", "of", "to", "del", "della", "dei", "delle",
        "nel", "nella", "al", "alla", "ai", "e", "o", "ma", "mi", "ti", "ci", "si", "non", "sono",
    ];
    q.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.chars().count() >= 3 && !STOP.contains(&t.to_lowercase().as_str()))
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_and_search() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.list_templates().unwrap().len() >= 5);
        let m = db
            .create_meeting("Standup piattaforma", None, &["anna@eoc.ch".into()], Some("standup"))
            .unwrap();
        db.add_segment(&m.id, "them", 0, 4000, "Il connettore Debezium si è bloccato stanotte")
            .unwrap();
        db.update_meeting(&m.id, None, Some("- rivedere offset kafka"), None, None).unwrap();
        let hits = db.list_meetings(Some("debez")).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.as_deref().unwrap().contains("«"));
        let rel = db.relevant_meetings("cosa è successo a kafka?", 5).unwrap();
        assert_eq!(rel[0].id, m.id);
        assert_eq!(db.transcript_end_ms(&m.id).unwrap(), 4000);
        db.add_chat_message(&m.id, "user", "ciao").unwrap();
        db.delete_meeting(&m.id).unwrap();
        assert!(db.list_meetings(None).unwrap().is_empty());
        assert!(db.chat_history(&m.id).unwrap().is_empty());
    }

    #[test]
    fn projects_are_promoted_tags() {
        let db = Db::open_in_memory().unwrap();
        db.set_project("cliente-x", Some(false)).unwrap();
        db.set_project("rebranding", Some(false)).unwrap();
        db.set_project("cliente-x", Some(true)).unwrap();
        assert_eq!(
            db.list_projects().unwrap(),
            vec![Project { tag: "cliente-x".into(), archived: true }, Project { tag: "rebranding".into(), archived: false }]
        );
        db.set_project("cliente-x", None).unwrap();
        assert_eq!(db.list_projects().unwrap().len(), 1);
    }

    #[test]
    fn tags_and_people() {
        let db = Db::open_in_memory().unwrap();
        let m = db.create_meeting("Kickoff", None, &["Anna Rossi".into()], None).unwrap();
        let other = db.create_meeting("Retro", None, &[], None).unwrap();
        assert!(m.tags.is_empty());

        db.set_tags(&m.id, &["cliente".into(), "q4".into()]).unwrap();
        db.set_tags(&other.id, &["cliente".into()]).unwrap();
        db.set_attendees(
            &m.id,
            &[("anna rossi".into(), Some("anna@example.ch".into())), ("Luca Bianchi".into(), None)],
        )
        .unwrap();

        let got = db.get_meeting(&m.id).unwrap().unwrap();
        assert_eq!(got.tags, vec!["cliente", "q4"]);
        assert_eq!(got.attendees, vec!["anna rossi", "Luca Bianchi"]);
        let tags = db.all_tags().unwrap();
        assert_eq!(tags[0], TagCount { name: "cliente".into(), count: 2 });
        assert_eq!(tags.len(), 2);

        // rubrica: niente doppioni che differiscono solo per maiuscole, email aggiunta dopo
        let people = db.list_people().unwrap();
        assert_eq!(people.len(), 2);
        let anna = people.iter().find(|p| p.name == "Anna Rossi").unwrap();
        assert_eq!(anna.email.as_deref(), Some("anna@example.ch"));
        assert_eq!(anna.meetings, 1);
        assert_eq!(db.search_people("bian", 5).unwrap()[0].name, "Luca Bianchi");
        assert_eq!(db.search_people("example.ch", 5).unwrap()[0].name, "Anna Rossi");
        assert!(db.search_people("100%", 5).unwrap().is_empty());

        // tag e partecipanti si trovano con la ricerca, e compaiono nell'elenco
        assert_eq!(db.list_meetings(Some("q4")).unwrap().len(), 1);
        assert_eq!(db.list_meetings(Some("bianchi")).unwrap()[0].id, m.id);
        let listed = db.list_meetings(None).unwrap();
        assert_eq!(listed.iter().find(|x| x.id == m.id).unwrap().tags, vec!["cliente", "q4"]);

        // togliere una persona dalla rubrica non tocca i meeting
        db.delete_person(anna.id).unwrap();
        assert_eq!(db.list_people().unwrap().len(), 1);
        assert_eq!(db.get_meeting(&m.id).unwrap().unwrap().attendees.len(), 2);
    }

    #[test]
    fn migrates_v1_database_with_existing_attendees() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era prima dei tag: solo lo schema 1
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA_V1).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            conn.execute(
                "INSERT INTO meetings (id, title, created_at, attendees) VALUES ('old', 'Vecchio', 1, ?1)",
                [r#"["Anna Rossi","Luca Bianchi"]"#],
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert!(db.get_meeting("old").unwrap().unwrap().tags.is_empty());
        let names: Vec<String> = db.list_people().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Anna Rossi", "Luca Bianchi"]);
        assert_eq!(db.list_meetings(Some("rossi")).unwrap().len(), 1, "reindicizzato dopo la migrazione");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn migrations_are_versioned_and_idempotent() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        let id = {
            let db = Db::open(&path).unwrap();
            let v: usize = db.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
            assert_eq!(v, MIGRATIONS.len());
            db.create_meeting("Persistente", None, &[], None).unwrap().id
        };
        // riapertura: nessuna migrazione rieseguita, dati intatti
        let db = Db::open(&path).unwrap();
        assert_eq!(db.get_meeting(&id).unwrap().unwrap().title, "Persistente");
        // un database "dal futuro" non viene toccato
        db.conn.pragma_update(None, "user_version", MIGRATIONS.len() + 1).unwrap();
        drop(db);
        assert!(Db::open(&path).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn recovers_meetings_left_recording() {
        let db = Db::open_in_memory().unwrap();
        let m = db.create_meeting("Crash", None, &[], None).unwrap();
        let other = db.create_meeting("Mai registrato", None, &[], None).unwrap();
        db.mark_started(&m.id).unwrap();
        db.add_segment(&m.id, "me", 0, 1000, "parola irripetibile xilofono").unwrap();
        // prima del recupero la trascrizione non è ancora indicizzata
        assert!(db.list_meetings(Some("xilofono")).unwrap().is_empty());
        assert_eq!(db.recover_interrupted().unwrap(), 1);
        assert!(db.get_meeting(&m.id).unwrap().unwrap().ended_at.is_some());
        assert!(db.get_meeting(&other.id).unwrap().unwrap().ended_at.is_none());
        assert_eq!(db.list_meetings(Some("xilofono")).unwrap().len(), 1);
        assert_eq!(db.recover_interrupted().unwrap(), 0);
    }

    #[test]
    fn chat_message_can_be_removed() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_chat_message("global", "user", "uno").unwrap();
        db.add_chat_message("global", "user", "due").unwrap();
        db.delete_chat_message(a.id).unwrap();
        let h = db.chat_history("global").unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].content, "due");
    }

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let mut s = db.get_settings().unwrap();
        assert_eq!(s.language, "it");
        s.user_name = "David".into();
        db.save_settings(&s).unwrap();
        assert_eq!(db.get_settings().unwrap().user_name, "David");
    }
}
