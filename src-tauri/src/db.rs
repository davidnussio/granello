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
pub(crate) const MIGRATIONS: &[&str] =
    &[SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10];

/// Meeting fissati: restano in cima alla barra laterale, sotto la Libreria, nell'ordine in
/// cui sono stati fissati. NULL = non fissato.
const SCHEMA_V10: &str = r#"
ALTER TABLE meetings ADD COLUMN pinned_at INTEGER;
"#;

/// Sync tra dispositivi (fase 0, vedi `sync.rs`). Un segmento della trascrizione riceve un id
/// che vale su ogni dispositivo: quello numerico resta locale. Le altre tabelle sono del sync:
/// le modifiche ancora da scrivere nel log, l'orologio di ogni campo, lo stato e le versioni
/// rimaste indietro in una modifica concorrente.
const SCHEMA_V9: &str = r#"
ALTER TABLE transcript_segments ADD COLUMN uid TEXT NOT NULL DEFAULT '';
UPDATE transcript_segments SET uid = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX idx_segments_uid ON transcript_segments(uid);

CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO sync_state (key, value) VALUES ('record', '0'), ('seq', '0');

CREATE TABLE sync_outbox (
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    field TEXT NOT NULL,
    PRIMARY KEY (entity, key, field)
) WITHOUT ROWID;

CREATE TABLE sync_clock (
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    field TEXT NOT NULL,
    hlc TEXT NOT NULL,
    PRIMARY KEY (entity, key, field)
) WITHOUT ROWID;

CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    hlc TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
"#;

/// Un progetto si distingue per colore, non più per un'emoji: la colonna cambia nome e le
/// emoji scelte finora si perdono (il progetto torna al colore predefinito).
const SCHEMA_V8: &str = r#"
ALTER TABLE projects RENAME COLUMN icon TO color;
UPDATE projects SET color = '';
"#;

/// Progetti veri: non più tag promossi, ma voci con un nome, un'icona e una descrizione.
/// Un meeting sta in un progetto al massimo. I tag che erano progetti lo diventano con lo
/// stesso nome, e i meeting che li portano ci entrano (se ne portano più d'uno vale il primo);
/// il tag resta sui meeting come tag normale.
const SCHEMA_V7: &str = r#"
ALTER TABLE projects RENAME TO projects_v3;
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    icon TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
INSERT INTO projects (id, name, archived, created_at)
SELECT lower(hex(randomblob(16))), tag, archived, created_at FROM projects_v3;
DROP TABLE projects_v3;

ALTER TABLE meetings ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
UPDATE meetings SET project_id = (
    SELECT p.id FROM json_each(meetings.tags) j JOIN projects p ON p.name = j.value
    ORDER BY j.key LIMIT 1
);
CREATE INDEX idx_meetings_project ON meetings(project_id);
"#;

/// Template: oltre alle istruzioni per l'AI, le note da cui parte il meeting (Markdown).
const SCHEMA_V6: &str = r#"
ALTER TABLE templates ADD COLUMN notes_md TEXT NOT NULL DEFAULT '';
"#;

/// Registrazioni salvate: una riga per ogni sessione di registrazione di cui si tiene l'audio.
const SCHEMA_V5: &str = r#"
CREATE TABLE recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    trimmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recordings_meeting ON recordings(meeting_id);
"#;

/// Privacy: livello per meeting e parti della trascrizione segnate "da verificare".
const SCHEMA_V4: &str = r#"
ALTER TABLE meetings ADD COLUMN privacy TEXT NOT NULL DEFAULT 'open';
ALTER TABLE transcript_segments ADD COLUMN review INTEGER NOT NULL DEFAULT 0;
"#;

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
        crate::sync::install(&db.conn)?;
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

    /// La connessione, per il sync: legge e scrive le tabelle senza passare dai metodi.
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
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
            privacy: Privacy::parse(&row.get::<_, String>("privacy")?),
            project_id: row.get("project_id")?,
            pinned_at: row.get("pinned_at")?,
        })
    }

    /// Crea un meeting con le note di partenza del suo template, letto da questo database.
    #[cfg(test)]
    pub fn create_meeting(
        &self,
        title: &str,
        calendar_event_id: Option<&str>,
        attendees: &[String],
        template_id: Option<&str>,
    ) -> Result<Meeting> {
        let notes = match template_id {
            Some(t) => self.get_template(t)?.map(|t| t.notes_md).unwrap_or_default(),
            None => String::new(),
        };
        self.create_meeting_with(title, calendar_event_id, attendees, template_id, &notes, Privacy::Open)
    }

    /// Crea un meeting. Le note di partenza e il livello di privacy li decide chi chiama: i
    /// template stanno nel database principale, la privacy minima la dà il vault.
    pub fn create_meeting_with(
        &self,
        title: &str,
        calendar_event_id: Option<&str>,
        attendees: &[String],
        template_id: Option<&str>,
        notes: &str,
        privacy: Privacy,
    ) -> Result<Meeting> {
        let id = uuid::Uuid::new_v4().to_string();
        let title = if title.trim().is_empty() { tr("Nuovo meeting", "New meeting") } else { title.trim() };
        self.conn.execute(
            "INSERT INTO meetings (id, title, created_at, calendar_event_id, attendees, template_id, notes_md, privacy)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                title,
                now_ms(),
                calendar_event_id,
                serde_json::to_string(attendees)?,
                template_id,
                notes,
                privacy.as_str()
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

    /// Aggiunge e toglie tag a più meeting insieme: o riesce per tutti, o per nessuno.
    /// Un meeting che ha già il massimo dei tag non ne riceve altri.
    pub fn tag_meetings(&self, ids: &[String], add: &[String], remove: &[String]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            let current: Option<String> =
                tx.query_row("SELECT tags FROM meetings WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            let Some(current) = current else { continue };
            let mut tags: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            tags.retain(|t| !remove.contains(t));
            for tag in add {
                if !tags.contains(tag) && tags.len() < crate::models::MAX_TAGS {
                    tags.push(tag.clone());
                }
            }
            tx.execute("UPDATE meetings SET tags = ?1 WHERE id = ?2", params![serde_json::to_string(&tags)?, id])?;
            self.reindex(id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Decisioni, azioni e citazioni di tutti i meeting, dal più recente, nell'ordine delle note.
    pub fn list_items(&self) -> Result<Vec<crate::items::Item>> {
        let mut stmt = self.conn.prepare("SELECT id, notes_md, enhanced_md FROM meetings ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, notes, enhanced) = row?;
            out.extend(crate::items::of_meeting(&id, &notes, enhanced.as_deref()));
        }
        Ok(out)
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

    // ---------- dati di esempio ----------

    /// Quanti meeting di esempio ci sono.
    pub fn demo_count(&self) -> Result<usize> {
        let like = format!("{}%", crate::demo::ID_PREFIX);
        Ok(self.conn.query_row("SELECT COUNT(*) FROM meetings WHERE id LIKE ?1", [like], |r| r.get(0))?)
    }

    /// Inserisce i meeting di esempio (sostituendo quelli già presenti) e segna i loro progetti.
    /// Un progetto che l'utente ha già con quel nome resta com'è.
    pub fn insert_demo(&self, data: &crate::demo::DemoData) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for m in &data.meetings {
            self.delete_meeting_rows(&m.id)?;
            self.conn.execute(
                "INSERT INTO meetings (id, title, created_at, started_at, ended_at, attendees, tags, notes_md, enhanced_md,
                                       pinned_at)
                 VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    m.id,
                    m.title,
                    m.started_at,
                    m.ended_at,
                    serde_json::to_string(&m.attendees)?,
                    serde_json::to_string(&m.tags)?,
                    m.notes_md,
                    m.enhanced_md,
                    // un fissato di esempio lo è da quando si è tenuto
                    m.pinned.then_some(m.started_at)
                ],
            )?;
            for s in &m.segments {
                self.add_segment(&m.id, &s.source, s.start_ms, s.end_ms, &s.text)?;
            }
            self.upsert_people(&m.attendees.iter().map(|a| (a.clone(), None)).collect::<Vec<_>>())?;
            self.reindex(&m.id)?;
        }
        // i progetti di esempio portano il nome di un tag: ci entrano i meeting con quel tag
        for (names, archived) in [(&data.projects, false), (&data.archived, true)] {
            for name in names {
                self.conn.execute(
                    "INSERT OR IGNORE INTO projects (id, name, archived, created_at) VALUES (?1, ?2, ?3, ?4)",
                    params![uuid::Uuid::new_v4().to_string(), name, archived, now_ms()],
                )?;
            }
        }
        for m in &data.meetings {
            let names = data.projects.iter().chain(&data.archived);
            if let Some(name) = m.tags.iter().find(|t| names.clone().any(|n| n == *t)) {
                self.conn.execute(
                    "UPDATE meetings SET project_id = (SELECT id FROM projects WHERE name = ?1) WHERE id = ?2",
                    params![name, m.id],
                )?;
                self.reindex(&m.id)?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Toglie i meeting di esempio, e con loro i progetti e le persone che non servono più
    /// a nessun altro meeting. Ritorna quanti meeting ha tolto.
    pub fn remove_demo(&self, data: &crate::demo::DemoData) -> Result<usize> {
        let like = format!("{}%", crate::demo::ID_PREFIX);
        let tx = self.conn.unchecked_transaction()?;
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT id FROM meetings WHERE id LIKE ?1")?;
            let rows = stmt.query_map([&like], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for id in &ids {
            self.delete_meeting_rows(id)?;
        }
        for name in data.projects.iter().chain(&data.archived) {
            self.conn.execute(
                "DELETE FROM projects WHERE name = ?1
                 AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.project_id = projects.id)",
                [name],
            )?;
        }
        for name in data.people() {
            self.conn.execute(
                "DELETE FROM people WHERE name = ?1
                 AND NOT EXISTS (SELECT 1 FROM meetings m, json_each(m.attendees) j WHERE j.value = ?1 COLLATE NOCASE)",
                [name],
            )?;
        }
        tx.commit()?;
        Ok(ids.len())
    }

    // ---------- progetti ----------

    /// I progetti in ordine alfabetico.
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let mut stmt =
            self.conn.prepare("SELECT id, name, color, description, archived FROM projects ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                description: r.get(3)?,
                archived: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Crea un progetto (`id` vuoto) o ne cambia nome, colore e descrizione. Due progetti non
    /// possono avere lo stesso nome, senza distinguere le maiuscole.
    pub fn save_project(&self, id: &str, name: &str, color: &str, description: &str) -> Result<Project> {
        let taken: Option<String> = self
            .conn
            .query_row("SELECT id FROM projects WHERE name = ?1", [name], |r| r.get(0))
            .optional()?;
        if taken.as_deref().is_some_and(|other| other != id) {
            return Err(crate::tra!(
                "Esiste già un progetto con il nome «{name}». Scegline un altro.",
                "A project named \"{name}\" already exists. Choose another name."
            ));
        }
        let id = if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id.to_string() };
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "INSERT INTO projects (id, name, color, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
             description = excluded.description",
            params![id, name, color, description, now_ms()],
        )?;
        // il nome del progetto è nell'indice di ricerca dei suoi meeting
        self.reindex_project(&id)?;
        tx.commit()?;
        self.list_projects()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| anyhow::anyhow!("progetto non trovato dopo il salvataggio"))
    }

    pub fn archive_project(&self, id: &str, archived: bool) -> Result<()> {
        self.conn.execute("UPDATE projects SET archived = ?1 WHERE id = ?2", params![archived, id])?;
        Ok(())
    }

    /// Elimina il progetto: i suoi meeting restano, senza progetto.
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let ids = self.project_meetings(id)?;
        self.conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
        for m in ids {
            self.reindex(&m)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Mette i meeting in un progetto, o li toglie da quello in cui sono (`None`).
    pub fn set_meetings_project(&self, ids: &[String], project: Option<&str>) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            self.conn.execute("UPDATE meetings SET project_id = ?1 WHERE id = ?2", params![project, id])?;
            self.reindex(id)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Fissa i meeting in cima alla barra laterale, o li toglie dai fissati. Uno già fissato
    /// tiene il suo posto: rifissarlo non lo sposta in fondo.
    pub fn set_meetings_pinned(&self, ids: &[String], pinned: bool) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let now = now_ms();
        for (i, id) in ids.iter().enumerate() {
            if pinned {
                // a più meeting fissati insieme resta l'ordine in cui sono stati scelti
                self.conn.execute(
                    "UPDATE meetings SET pinned_at = ?1 WHERE id = ?2 AND pinned_at IS NULL",
                    params![now + i as i64, id],
                )?;
            } else {
                self.conn.execute("UPDATE meetings SET pinned_at = NULL WHERE id = ?1", [id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn project_meetings(&self, id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM meetings WHERE project_id = ?1")?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn reindex_project(&self, id: &str) -> Result<()> {
        for m in self.project_meetings(id)? {
            self.reindex(&m)?;
        }
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
        self.delete_meeting_rows(id)?;
        tx.commit()?;
        Ok(())
    }

    /// Le righe di un meeting, senza aprire una transazione: per chi ne ha già una aperta.
    pub(crate) fn delete_meeting_rows(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM meetings WHERE id = ?1", [id])?;
        self.conn.execute("DELETE FROM meetings_fts WHERE meeting_id = ?1", [id])?;
        self.conn.execute("DELETE FROM chat_messages WHERE scope = ?1", [id])?;
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
                    "SELECT id, title, created_at, enhanced_md IS NOT NULL AND enhanced_md != '', attendees, tags,
                            project_id, pinned_at
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
                        project_id: r.get(6)?,
                        pinned_at: r.get(7)?,
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
                            snippet(meetings_fts, -1, '«', '»', '…', 12), m.tags, m.project_id, m.pinned_at
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
                        project_id: r.get(7)?,
                        pinned_at: r.get(8)?,
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

    pub(crate) fn reindex(&self, id: &str) -> Result<()> {
        let Some(m) = self.get_meeting(id)? else { return Ok(()) };
        let transcript = self
            .segments(id)?
            .into_iter()
            .map(|s| s.text)
            .collect::<Vec<_>>()
            .join(" ");
        let project: String = match &m.project_id {
            Some(p) => self
                .conn
                .query_row("SELECT name FROM projects WHERE id = ?1", [p], |r| r.get(0))
                .optional()?
                .unwrap_or_default(),
            None => String::new(),
        };
        self.conn.execute("DELETE FROM meetings_fts WHERE meeting_id = ?1", [id])?;
        self.conn.execute(
            "INSERT INTO meetings_fts (meeting_id, title, notes, enhanced, transcript) VALUES (?1, ?2, ?3, ?4, ?5)",
            // progetto, tag e partecipanti stanno con il titolo: così si trovano cercandoli
            params![
                id,
                [m.title.as_str(), &project, &m.tags.join(" "), &m.attendees.join(" ")]
                    .join(" · ")
                    .trim_end_matches([' ', '·']),
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
            "INSERT INTO transcript_segments (meeting_id, source, start_ms, end_ms, text, uid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![meeting_id, source, start_ms, end_ms, text, segment_uid()],
        )?;
        Ok(TranscriptSegment {
            id: self.conn.last_insert_rowid(),
            meeting_id: meeting_id.into(),
            source: source.into(),
            start_ms,
            end_ms,
            text: text.into(),
            review: false,
        })
    }

    /// Sostituisce la trascrizione di un meeting dal punto `from_ms` in poi (dopo l'affinamento
    /// online): ciò che viene prima, cioè le registrazioni precedenti, resta com'è.
    /// Ogni riga: sorgente (o nome del parlante), inizio, fine, testo.
    pub fn replace_segments(&self, meeting_id: &str, from_ms: i64, rows: &[(String, i64, i64, String)]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "DELETE FROM transcript_segments WHERE meeting_id = ?1 AND start_ms >= ?2",
            params![meeting_id, from_ms],
        )?;
        for (source, start_ms, end_ms, text) in rows {
            self.conn.execute(
                "INSERT INTO transcript_segments (meeting_id, source, start_ms, end_ms, text, uid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![meeting_id, source, start_ms, end_ms, text, segment_uid()],
            )?;
        }
        self.reindex(meeting_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Attribuisce alcuni segmenti a un parlante (o a "me").
    pub fn set_source(&self, meeting_id: &str, ids: &[i64], source: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            self.conn.execute(
                "UPDATE transcript_segments SET source = ?1 WHERE id = ?2 AND meeting_id = ?3",
                params![source, id, meeting_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Dà un nome a un parlante: cambia la sorgente di tutti i suoi segmenti in quel meeting.
    pub fn rename_source(&self, meeting_id: &str, from: &str, to: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE transcript_segments SET source = ?1 WHERE meeting_id = ?2 AND source = ?3",
            params![to, meeting_id, from],
        )?;
        Ok(())
    }

    // ---------- registrazioni ----------

    pub fn add_recording(&self, meeting_id: &str, path: &str, started_at: i64) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO recordings (meeting_id, path, started_at) VALUES (?1, ?2, ?3)",
            params![meeting_id, path, started_at],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Aggiorna una registrazione dopo la chiusura o la pulizia delle pause.
    pub fn update_recording(&self, id: i64, path: &str, duration_ms: i64, bytes: i64, trimmed: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE recordings SET path = ?1, duration_ms = ?2, bytes = ?3, trimmed = ?4 WHERE id = ?5",
            params![path, duration_ms, bytes, trimmed, id],
        )?;
        Ok(())
    }

    pub fn delete_recording(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM recordings WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Le registrazioni salvate, dalla più recente; solo quelle di un meeting se indicato.
    pub fn recordings(&self, meeting_id: Option<&str>) -> Result<Vec<Recording>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.meeting_id, m.title, r.path, r.started_at, r.duration_ms, r.bytes, r.trimmed
             FROM recordings r JOIN meetings m ON m.id = r.meeting_id
             WHERE ?1 IS NULL OR r.meeting_id = ?1
             ORDER BY r.started_at DESC, r.id DESC",
        )?;
        let rows = stmt.query_map([meeting_id], |r| {
            Ok(Recording {
                id: r.get(0)?,
                meeting_id: r.get(1)?,
                meeting_title: r.get(2)?,
                path: r.get(3)?,
                started_at: r.get(4)?,
                duration_ms: r.get(5)?,
                bytes: r.get(6)?,
                trimmed: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    // ---------- privacy ----------

    pub fn set_privacy(&self, id: &str, privacy: Privacy) -> Result<()> {
        self.conn.execute("UPDATE meetings SET privacy = ?1 WHERE id = ?2", params![privacy.as_str(), id])?;
        Ok(())
    }

    /// Porta al livello `min` i meeting che ne hanno uno più basso. Ritorna i loro id: chi
    /// chiama cancella l'audio che avevano conservato per la trascrizione online.
    pub fn raise_privacy(&self, min: Privacy) -> Result<Vec<String>> {
        let below: &[&str] = match min {
            Privacy::Open => return Ok(Vec::new()),
            Privacy::Audio => &["open"],
            Privacy::Hardened => &["open", "audio"],
        };
        let mut ids = Vec::new();
        for level in below {
            let mut stmt = self.conn.prepare("SELECT id FROM meetings WHERE privacy = ?1")?;
            let rows = stmt.query_map([level], |r| r.get(0))?;
            ids.extend(rows.collect::<rusqlite::Result<Vec<String>>>()?);
            self.conn.execute("UPDATE meetings SET privacy = ?1 WHERE privacy = ?2", params![min.as_str(), level])?;
        }
        Ok(ids)
    }

    /// Quante parti della trascrizione aspettano di essere verificate.
    pub fn pending_reviews(&self, meeting_id: &str) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM transcript_segments WHERE meeting_id = ?1 AND review = 1",
            [meeting_id],
            |r| r.get(0),
        )?)
    }

    /// Segna (o libera) alcuni segmenti come "da verificare".
    pub fn set_review(&self, meeting_id: &str, ids: &[i64], review: bool) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            self.conn.execute(
                "UPDATE transcript_segments SET review = ?1 WHERE id = ?2 AND meeting_id = ?3",
                params![review, id, meeting_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Oscura per sempre parti della trascrizione: del testo originale non resta niente, nemmeno
    /// nell'indice di ricerca. Ogni parte è un segmento e, se serve, l'intervallo di caratteri.
    /// Un segmento oscurato non è più "da verificare".
    pub fn redact(&self, meeting_id: &str, parts: &[(i64, Option<(usize, usize)>)]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for (id, range) in parts {
            let text: Option<String> = self
                .conn
                .query_row(
                    "SELECT text FROM transcript_segments WHERE id = ?1 AND meeting_id = ?2",
                    params![id, meeting_id],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(text) = text else { continue };
            self.conn.execute(
                "UPDATE transcript_segments SET text = ?1, review = 0 WHERE id = ?2",
                params![redact_text(&text, *range), id],
            )?;
        }
        self.reindex(meeting_id)?;
        tx.commit()?;
        Ok(())
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
            "SELECT id, meeting_id, source, start_ms, end_ms, text, review FROM transcript_segments
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
                review: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ---------- templates ----------

    pub fn list_templates(&self) -> Result<Vec<Template>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, instructions, builtin, notes_md FROM templates ORDER BY builtin DESC, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Template {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                instructions: r.get(3)?,
                builtin: r.get(4)?,
                notes_md: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_template(&self, id: &str) -> Result<Option<Template>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, description, instructions, builtin, notes_md FROM templates WHERE id = ?1",
                [id],
                |r| {
                    Ok(Template {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        description: r.get(2)?,
                        instructions: r.get(3)?,
                        builtin: r.get(4)?,
                        notes_md: r.get(5)?,
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
            "INSERT INTO templates (id, name, description, instructions, builtin, notes_md) VALUES (?1, ?2, ?3, ?4, 0, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
             instructions = excluded.instructions, notes_md = excluded.notes_md",
            params![id, t.name, t.description, t.instructions, t.notes_md],
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

    /// Un valore qualsiasi della tabella delle impostazioni (es. l'elenco dei vault).
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
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

/// L'id di un segmento che vale su tutti i dispositivi.
fn segment_uid() -> String {
    uuid::Uuid::new_v4().simple().to_string()
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
    fn tags_several_meetings_at_once_and_lists_their_items() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_meeting("Primo", None, &[], None).unwrap();
        let b = db.create_meeting("Secondo", None, &[], None).unwrap();
        let c = db.create_meeting("Terzo", None, &[], None).unwrap();
        db.set_tags(&a.id, &["prezzi".into(), "vecchio".into()]).unwrap();
        db.set_tags(&c.id, &["vecchio".into()]).unwrap();

        let ids = vec![a.id.clone(), b.id.clone(), "non-esiste".to_string()];
        db.tag_meetings(&ids, &["prezzi".into(), "cliente-nord".into()], &["vecchio".into()]).unwrap();
        let tags = |id: &str| db.get_meeting(id).unwrap().unwrap().tags;
        assert_eq!(tags(&a.id), vec!["prezzi", "cliente-nord"]);
        assert_eq!(tags(&b.id), vec!["prezzi", "cliente-nord"]);
        assert_eq!(tags(&c.id), vec!["vecchio"]);
        // i tag nuovi si trovano con la ricerca
        assert_eq!(db.list_meetings(Some("cliente-nord")).unwrap().len(), 2);

        // oltre il massimo non se ne aggiungono
        let many: Vec<String> = (0..crate::models::MAX_TAGS + 3).map(|i| format!("t{i}")).collect();
        db.tag_meetings(std::slice::from_ref(&b.id), &many, &[]).unwrap();
        assert_eq!(tags(&b.id).len(), crate::models::MAX_TAGS);

        db.update_meeting(&a.id, None, Some("> [!DECISION]\n> Si parte a marzo.\n\n- [ ] Avvisare il cliente"), None, None).unwrap();
        let items = db.list_items().unwrap();
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|i| i.meeting_id == a.id));
    }

    #[test]
    fn demo_data_comes_and_goes_without_touching_real_meetings() {
        let db = Db::open_in_memory().unwrap();
        let mine = db.create_meeting("Il mio meeting", None, &["Marco Bianchi".into()], None).unwrap();
        let project = db.save_project("", "Mio", "", "").unwrap();
        db.set_meetings_project(std::slice::from_ref(&mine.id), Some(&project.id)).unwrap();
        let before_people = db.list_people().unwrap().len();

        let data = crate::demo::load(crate::i18n::Lang::It).unwrap();
        db.insert_demo(&data).unwrap();
        db.insert_demo(&data).unwrap(); // caricarli due volte non li raddoppia
        assert_eq!(db.demo_count().unwrap(), data.meetings.len());
        assert_eq!(db.list_meetings(None).unwrap().len(), data.meetings.len() + 1);
        let first = &data.meetings[0];
        assert_eq!(db.segments(&first.id).unwrap().len(), first.segments.len());
        assert!(db.list_projects().unwrap().len() > 1);
        // i meeting di esempio stanno nel progetto che porta il nome di un loro tag
        let demo_project = db.list_projects().unwrap().into_iter().find(|p| p.name == data.projects[0]).unwrap();
        assert!(db.list_meetings(None).unwrap().iter().any(|m| m.project_id.as_deref() == Some(&demo_project.id)));

        assert_eq!(db.remove_demo(&data).unwrap(), data.meetings.len());
        assert_eq!(db.demo_count().unwrap(), 0);
        let left = db.list_meetings(None).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, mine.id);
        assert_eq!(db.list_projects().unwrap(), vec![project.clone()]);
        assert_eq!(left[0].project_id, Some(project.id));
        assert_eq!(db.list_people().unwrap().len(), before_people);
    }

    #[test]
    fn redaction_is_permanent_and_reviews_are_counted() {
        let db = Db::open_in_memory().unwrap();
        let m = db.create_meeting("Riservato", None, &[], None).unwrap();
        assert_eq!(m.privacy, Privacy::Open);
        db.set_privacy(&m.id, Privacy::Hardened).unwrap();
        assert_eq!(db.get_meeting(&m.id).unwrap().unwrap().privacy, Privacy::Hardened);

        let a = db.add_segment(&m.id, "them", 0, 1000, "Lo stipendio di Carla è 4200 franchi.").unwrap();
        let b = db.add_segment(&m.id, "me", 1000, 2000, "Passiamo al prossimo punto.").unwrap();
        db.set_review(&m.id, &[a.id, b.id], true).unwrap();
        assert_eq!(db.pending_reviews(&m.id).unwrap(), 2);
        db.set_review(&m.id, &[b.id], false).unwrap();

        // "4200 franchi" va dal carattere 24 al 36
        db.redact(&m.id, &[(a.id, Some((24, 36)))]).unwrap();
        let segs = db.segments(&m.id).unwrap();
        assert_eq!(segs[0].text, format!("Lo stipendio di Carla è {REDACTED}."));
        assert!(!segs[0].review);
        assert_eq!(db.pending_reviews(&m.id).unwrap(), 0);
        // nemmeno la ricerca lo trova più
        assert!(db.list_meetings(Some("4200")).unwrap().is_empty());
        assert_eq!(db.list_meetings(Some("stipendio")).unwrap().len(), 1);

        db.redact(&m.id, &[(b.id, None)]).unwrap();
        assert_eq!(db.segments(&m.id).unwrap()[1].text, REDACTED);
        assert_eq!(redact_text("uno due tre", Some((4, 7))), format!("uno {REDACTED} tre"));
        assert_eq!(redact_text(&format!("uno {REDACTED} tre"), Some((3, 4))), format!("uno{REDACTED} tre"));
    }

    #[test]
    fn refining_a_resumed_recording_keeps_what_came_before() {
        let db = Db::open_in_memory().unwrap();
        let m = db.create_meeting("Due riprese", None, &[], None).unwrap();
        db.add_segment(&m.id, "Marco", 1000, 4000, "Prima registrazione, già affinata.").unwrap();
        db.add_segment(&m.id, "me", 60_000, 63_000, "Seconda registrazione, locale.").unwrap();
        db.add_segment(&m.id, "them", 64_000, 66_000, "Ancora locale.").unwrap();
        // l'audio conservato parte dal minuto 1: si sostituisce solo da lì
        db.replace_segments(&m.id, 60_000, &[("Parlante 2".into(), 60_500, 66_000, "Seconda registrazione, affinata.".into())]).unwrap();
        let texts: Vec<String> = db.segments(&m.id).unwrap().into_iter().map(|s| format!("{}: {}", s.source, s.text)).collect();
        assert_eq!(texts, vec!["Marco: Prima registrazione, già affinata.", "Parlante 2: Seconda registrazione, affinata."]);
    }

    #[test]
    fn a_vault_can_raise_the_privacy_of_its_meetings() {
        let db = Db::open_in_memory().unwrap();
        let open = db.create_meeting("Aperto", None, &[], None).unwrap();
        let audio = db.create_meeting("Audio", None, &[], None).unwrap();
        db.set_privacy(&audio.id, Privacy::Audio).unwrap();
        let born = db.create_meeting_with("Nato blindato", None, &[], None, "", Privacy::Hardened).unwrap();
        assert_eq!(born.privacy, Privacy::Hardened);
        assert!(Privacy::Open < Privacy::Audio && Privacy::Audio < Privacy::Hardened);
        let level = |id: &str| db.get_meeting(id).unwrap().unwrap().privacy;

        assert!(db.raise_privacy(Privacy::Open).unwrap().is_empty());
        // solo chi stava sotto il minimo cambia
        assert_eq!(db.raise_privacy(Privacy::Audio).unwrap(), vec![open.id.clone()]);
        assert_eq!((level(&open.id), level(&audio.id)), (Privacy::Audio, Privacy::Audio));
        let mut raised = db.raise_privacy(Privacy::Hardened).unwrap();
        raised.sort();
        let mut expected = vec![open.id.clone(), audio.id.clone()];
        expected.sort();
        assert_eq!(raised, expected);
        assert_eq!((level(&open.id), level(&born.id)), (Privacy::Hardened, Privacy::Hardened));

        assert_eq!(db.setting("vaults").unwrap(), None);
        db.set_setting("vaults", "{}").unwrap();
        db.set_setting("vaults", "[]").unwrap();
        assert_eq!(db.setting("vaults").unwrap().as_deref(), Some("[]"));
    }

    #[test]
    fn projects_hold_meetings_one_each() {
        let db = Db::open_in_memory().unwrap();
        let nord = db.save_project("", "Cliente Nord", "blue", "Rinnovo del contratto").unwrap();
        let app = db.save_project("", "App mobile", "", "").unwrap();
        assert_eq!((nord.color.as_str(), nord.description.as_str(), nord.archived), ("blue", "Rinnovo del contratto", false));
        // in ordine alfabetico
        let names: Vec<String> = db.list_projects().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["App mobile", "Cliente Nord"]);
        // due progetti non possono avere lo stesso nome, nemmeno con altre maiuscole
        assert!(db.save_project("", "cliente nord", "", "").is_err());
        assert!(db.save_project(&app.id, "Cliente Nord", "", "").is_err());

        let a = db.create_meeting("Prezzi", None, &[], None).unwrap();
        let b = db.create_meeting("Roadmap", None, &[], None).unwrap();
        assert_eq!(a.project_id, None);
        db.set_meetings_project(&[a.id.clone(), b.id.clone()], Some(&nord.id)).unwrap();
        // un meeting sta in un progetto solo: spostarlo lo toglie dall'altro
        db.set_meetings_project(std::slice::from_ref(&b.id), Some(&app.id)).unwrap();
        let project = |id: &str| db.get_meeting(id).unwrap().unwrap().project_id;
        assert_eq!((project(&a.id), project(&b.id)), (Some(nord.id.clone()), Some(app.id.clone())));
        // il nome del progetto si trova con la ricerca, anche dopo averlo cambiato
        assert_eq!(db.list_meetings(Some("nord")).unwrap().len(), 1);
        let renamed = db.save_project(&nord.id, "Cliente Sud", "blue", "").unwrap();
        assert_eq!(renamed.id, nord.id);
        assert_eq!(db.list_meetings(Some("nord")).unwrap().len(), 0);
        assert_eq!(db.list_meetings(Some("sud")).unwrap()[0].id, a.id);

        db.archive_project(&nord.id, true).unwrap();
        assert!(db.list_projects().unwrap().iter().find(|p| p.id == nord.id).unwrap().archived);
        // eliminare un progetto lascia i suoi meeting, senza progetto
        db.delete_project(&nord.id).unwrap();
        assert_eq!(project(&a.id), None);
        assert_eq!(db.list_meetings(Some("sud")).unwrap().len(), 0);
        db.set_meetings_project(std::slice::from_ref(&b.id), None).unwrap();
        assert_eq!(project(&b.id), None);
        assert_eq!(db.list_projects().unwrap().len(), 1);
    }

    #[test]
    fn pinned_meetings_keep_the_order_they_were_pinned_in() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_meeting("Uno", None, &[], None).unwrap();
        let b = db.create_meeting("Due", None, &[], None).unwrap();
        let pinned = |id: &str| db.get_meeting(id).unwrap().unwrap().pinned_at;
        assert_eq!(pinned(&a.id), None);
        db.set_meetings_pinned(&[b.id.clone(), a.id.clone()], true).unwrap();
        let (pa, pb) = (pinned(&a.id).unwrap(), pinned(&b.id).unwrap());
        assert!(pb < pa, "chi è scelto prima viene prima");
        // rifissare non sposta: il meeting tiene il suo posto
        db.set_meetings_pinned(std::slice::from_ref(&b.id), true).unwrap();
        assert_eq!(pinned(&b.id), Some(pb));
        let listed = db.list_meetings(None).unwrap();
        assert_eq!(listed.iter().find(|m| m.id == a.id).unwrap().pinned_at, Some(pa));
        db.set_meetings_pinned(std::slice::from_ref(&a.id), false).unwrap();
        assert_eq!(pinned(&a.id), None);
        assert_eq!(pinned(&b.id), Some(pb));
    }

    #[test]
    fn meetings_start_unpinned_after_migration() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era prima dei fissati: fino allo schema 9
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..9] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 9).unwrap();
            conn.execute_batch("INSERT INTO meetings (id, title, created_at) VALUES ('m', 'Vecchio', 1);").unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.get_meeting("m").unwrap().unwrap().pinned_at, None);
        db.set_meetings_pinned(&["m".to_string()], true).unwrap();
        assert!(db.get_meeting("m").unwrap().unwrap().pinned_at.is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn segments_get_an_id_for_every_device_on_migration() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era prima del sync: fino allo schema 8
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..8] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 8).unwrap();
            conn.execute_batch(
                "INSERT INTO meetings (id, title, created_at) VALUES ('m', 'Vecchio', 1);
                 INSERT INTO transcript_segments (meeting_id, source, start_ms, end_ms, text) VALUES
                   ('m', 'me', 0, 1000, 'uno'), ('m', 'them', 1000, 2000, 'due');",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        db.add_segment("m", "me", 2000, 3000, "tre").unwrap();
        let uids: Vec<String> = {
            let mut stmt = db.conn.prepare("SELECT uid FROM transcript_segments ORDER BY start_ms").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
        };
        assert_eq!(uids.len(), 3);
        assert!(uids.iter().all(|u| u.len() == 32));
        assert_eq!(uids.iter().collect::<std::collections::HashSet<_>>().len(), 3, "tutti diversi");
        // il sync parte spento: niente da scrivere nel log
        let record: String = db.conn.query_row("SELECT value FROM sync_state WHERE key = 'record'", [], |r| r.get(0)).unwrap();
        assert_eq!(record, "0");
        let pending: i64 = db.conn.query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0)).unwrap();
        assert_eq!(pending, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn project_icons_give_way_to_colors_on_migration() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era quando un progetto aveva un'emoji: fino allo schema 7
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..7] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 7).unwrap();
            conn.execute_batch(
                "INSERT INTO projects (id, name, icon, description, created_at) VALUES ('p', 'Lancio', '🚀', 'Primavera', 1);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let project = db.list_projects().unwrap().remove(0);
        assert_eq!((project.name.as_str(), project.color.as_str(), project.description.as_str()), ("Lancio", "", "Primavera"));
        assert_eq!(db.save_project("p", "Lancio", "teal", "Primavera").unwrap().color, "teal");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn promoted_tags_become_projects_on_migration() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era quando i progetti erano tag promossi: fino allo schema 6
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..6] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 6).unwrap();
            conn.execute_batch(
                r#"INSERT INTO projects (tag, archived, created_at) VALUES ('cliente-x', 0, 1), ('sito', 1, 2);
                   INSERT INTO meetings (id, title, created_at, tags) VALUES
                     ('uno', 'Uno', 1, '["prezzi","sito","cliente-x"]'),
                     ('due', 'Due', 2, '["cliente-x"]'),
                     ('tre', 'Tre', 3, '["altro"]');"#,
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let projects = db.list_projects().unwrap();
        let id = |name: &str| projects.iter().find(|p| p.name == name).unwrap().id.clone();
        assert_eq!(projects.iter().map(|p| (p.name.as_str(), p.archived)).collect::<Vec<_>>(), vec![("cliente-x", false), ("sito", true)]);
        let meeting = |m: &str| db.get_meeting(m).unwrap().unwrap();
        // con più tag-progetto vale il primo; il tag resta sul meeting
        assert_eq!(meeting("uno").project_id, Some(id("sito")));
        assert_eq!(meeting("uno").tags, vec!["prezzi", "sito", "cliente-x"]);
        assert_eq!(meeting("due").project_id, Some(id("cliente-x")));
        assert_eq!(meeting("tre").project_id, None);
        let _ = std::fs::remove_dir_all(dir);
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
    fn template_notes_survive_migration_and_start_new_meetings() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era prima delle note nei template: fino allo schema 5
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..5] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 5).unwrap();
            conn.execute("INSERT INTO templates (id, name, instructions) VALUES ('mio', 'Mio', 'Sezioni')", []).unwrap();
        }
        let db = Db::open(&path).unwrap();
        let mut mine = db.get_template("mio").unwrap().unwrap();
        assert_eq!((mine.instructions.as_str(), mine.notes_md.as_str()), ("Sezioni", ""));

        mine.notes_md = "## Agenda\n\n- [ ] Primo punto".into();
        let saved = db.save_template(&mine).unwrap();
        assert_eq!(saved.id, "mio");
        assert_eq!(saved.notes_md, mine.notes_md);
        assert_eq!(db.list_templates().unwrap().iter().find(|t| t.id == "mio").unwrap().notes_md, mine.notes_md);

        // un meeting creato con quel template parte dalle sue note; senza, resta vuoto
        assert_eq!(db.create_meeting("Con", None, &[], Some("mio")).unwrap().notes_md, mine.notes_md);
        assert_eq!(db.create_meeting("Senza", None, &[], None).unwrap().notes_md, "");
        assert_eq!(db.create_meeting("Sparito", None, &[], Some("non-esiste")).unwrap().notes_md, "");
        // la copia di un template di sistema porta con sé le note scritte
        let builtin = Template { notes_md: "Appunti".into(), ..db.list_templates().unwrap().into_iter().find(|t| t.builtin).unwrap() };
        let copy = db.save_template(&builtin).unwrap();
        assert!(!copy.builtin && copy.id != builtin.id);
        assert_eq!(copy.notes_md, "Appunti");
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
