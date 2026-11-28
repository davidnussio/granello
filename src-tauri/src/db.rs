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
    &[SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12, SCHEMA_V13, SCHEMA_V14, SCHEMA_V15];

/// Ruolo e altri nomi di una persona (soprannomi, come la scrive il calendario, i nomi uniti a
/// lei), e gli indirizzi email di un gruppo (la mailing list che il calendario invita).
const SCHEMA_V15: &str = r#"
ALTER TABLE people ADD COLUMN role TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE people_groups ADD COLUMN emails TEXT NOT NULL DEFAULT '[]';
"#;

/// Gruppi di persone (team, reparti, clienti, tutta l'azienda), uno dentro l'altro come i
/// progetti. I membri sono nomi della rubrica, come i partecipanti dei meeting: il sync
/// riconosce una persona dal nome. Un meeting ricorda i gruppi presenti per id. La tabella non
/// si chiama `groups`: GROUPS è una parola chiave di SQLite.
const SCHEMA_V14: &str = r#"
CREATE TABLE people_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    parent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'team',
    members TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_people_groups_parent ON people_groups(parent_id);
ALTER TABLE meetings ADD COLUMN group_ids TEXT NOT NULL DEFAULT '[]';
"#;

/// Progetti dentro altri progetti (`dambox › bizcard`). NULL = un progetto di primo livello, come
/// pure un genitore che qui non c'è (cancellato, o non ancora arrivato dal sync). Niente chiave
/// esterna: il sync può portare un figlio prima del genitore.
const SCHEMA_V13: &str = r#"
ALTER TABLE projects ADD COLUMN parent_id TEXT;
CREATE INDEX idx_projects_parent ON projects(parent_id);
"#;

/// Import da altre app (Obsidian) e file senza nota. Un import ricorda da quale cartella è
/// partito e cosa ha creato, per saltare le note già importate e per poterlo annullare. I file
/// senza nota stanno tra gli allegati come gli altri: qui c'è il loro nome e da dove vengono.
const SCHEMA_V12: &str = r#"
CREATE TABLE imports (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    root TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    projects TEXT NOT NULL DEFAULT '[]',
    people TEXT NOT NULL DEFAULT '[]',
    report TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE imported_notes (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    source_hash TEXT NOT NULL
);
CREATE INDEX idx_imported_notes_import ON imported_notes(import_id);
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    folder TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    import_id TEXT REFERENCES imports(id) ON DELETE CASCADE,
    source_path TEXT
);
"#;

/// Quando una nota è stata modificata l'ultima volta (titolo, note, note AI, partecipanti, tag):
/// la barra laterale le ordina così. Per quelle che ci sono già vale la fine del meeting, o la
/// sua creazione. NULL (una riga arrivata dal sync da una versione precedente) = la creazione.
const SCHEMA_V11: &str = r#"
ALTER TABLE meetings ADD COLUMN updated_at INTEGER;
UPDATE meetings SET updated_at = MAX(created_at, COALESCE(ended_at, created_at));
"#;

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
        db.repair()?;
        crate::sync::install(&db.conn)?;
        db.seed_templates()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let current: usize = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current > MIGRATIONS.len() {
            return Err(crate::tra!(
                "Il database è stato creato da una versione più recente di Granello (schema {current}). Installa l'ultima versione: i dati restano come sono.",
                "This database was created by a newer version of Granello (schema {current}). Install the latest version: your data stays as it is."
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

    /// Colonne che una build di sviluppo può aver lasciato fuori da una migrazione poi cambiata
    /// prima del rilascio: la migrazione risulta fatta, la colonna manca. Si aggiungono solo se
    /// mancano, quindi su un database normale non cambia niente.
    fn repair(&self) -> Result<()> {
        const COLUMNS: &[(&str, &str, &str)] = &[
            // la 12 di sviluppo non aveva le persone aggiunte da un import (0.2.8)
            ("imports", "people", "TEXT NOT NULL DEFAULT '[]'"),
        ];
        for (table, column, kind) in COLUMNS {
            let present: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info(?1) WHERE name = ?2",
                [table, column],
                |r| r.get(0),
            )?;
            let exists: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )?;
            if exists && !present {
                log::warn!("colonna mancante aggiunta: {table}.{column}");
                self.conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {kind}"))?;
            }
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
        let created_at: i64 = row.get("created_at")?;
        Ok(Meeting {
            id: row.get("id")?,
            title: row.get("title")?,
            created_at,
            started_at: row.get("started_at")?,
            ended_at: row.get("ended_at")?,
            calendar_event_id: row.get("calendar_event_id")?,
            attendees: serde_json::from_str(&attendees).unwrap_or_default(),
            group_ids: serde_json::from_str(&row.get::<_, String>("group_ids")?).unwrap_or_default(),
            groups_brief: Vec::new(),
            tags: serde_json::from_str(&tags).unwrap_or_default(),
            template_id: row.get("template_id")?,
            notes_md: row.get("notes_md")?,
            enhanced_md: row.get("enhanced_md")?,
            privacy: Privacy::parse(&row.get::<_, String>("privacy")?),
            project_id: row.get("project_id")?,
            pinned_at: row.get("pinned_at")?,
            // una riga arrivata dal sync da una versione precedente non ce l'ha: vale la creazione
            updated_at: row.get::<_, Option<i64>>("updated_at")?.unwrap_or(created_at),
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
        let title = if title.trim().is_empty() { tr("Nuova nota", "New note") } else { title.trim() };
        self.conn.execute(
            "INSERT INTO meetings (id, title, created_at, updated_at, calendar_event_id, attendees, template_id, notes_md,
                                   privacy)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)",
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
        // l'ora di modifica cambia solo se il testo cambia davvero: un salvataggio uguale non sposta
        // la nota in cima alla barra laterale
        let now = now_ms();
        if let Some(t) = title {
            let before: Option<String> =
                self.conn.query_row("SELECT title FROM meetings WHERE id = ?1", [id], |r| r.get(0)).optional()?;
            self.conn.execute(
                "UPDATE meetings SET title = ?1, updated_at = ?3 WHERE id = ?2 AND title IS NOT ?1",
                params![t, id, now],
            )?;
            if let Some(before) = before.filter(|b| b != t) {
                self.rename_links(id, &before, t)?;
            }
        }
        if let Some(n) = notes_md {
            self.conn.execute(
                "UPDATE meetings SET notes_md = ?1, updated_at = ?3 WHERE id = ?2 AND notes_md IS NOT ?1",
                params![n, id, now],
            )?;
        }
        if let Some(e) = enhanced_md {
            self.conn.execute(
                "UPDATE meetings SET enhanced_md = ?1, updated_at = ?3 WHERE id = ?2 AND enhanced_md IS NOT ?1",
                params![e, id, now],
            )?;
        }
        if let Some(t) = template_id {
            let t = if t.is_empty() { None } else { Some(t) };
            self.conn.execute("UPDATE meetings SET template_id = ?1 WHERE id = ?2", params![t, id])?;
        }
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    /// Una nota ha cambiato titolo: i link `[[Vecchio]]` e `[[Vecchio|testo]]` delle altre note
    /// seguono il nuovo. L'ora di modifica di quelle note non cambia.
    fn rename_links(&self, id: &str, before: &str, after: &str) -> Result<()> {
        let (from, to) = (crate::models::link_title(before), crate::models::link_title(after));
        if from.is_empty() || to.is_empty() || from == to {
            return Ok(());
        }
        let (a, b) = (format!("[[{from}]]"), format!("[[{from}|"));
        let (c, d) = (format!("[[{to}]]"), format!("[[{to}|"));
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM meetings WHERE id != ?1 AND (instr(notes_md, ?2) > 0 OR instr(notes_md, ?3) > 0
                 OR instr(COALESCE(enhanced_md, ''), ?2) > 0 OR instr(COALESCE(enhanced_md, ''), ?3) > 0)",
            )?;
            let rows = stmt.query_map(params![id, a, b], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for other in ids {
            self.conn.execute(
                "UPDATE meetings SET notes_md = replace(replace(notes_md, ?2, ?3), ?4, ?5),
                        enhanced_md = replace(replace(enhanced_md, ?2, ?3), ?4, ?5)
                 WHERE id = ?1",
                params![other, a, c, b, d],
            )?;
            self.reindex(&other)?;
        }
        Ok(())
    }

    /// Sostituisce i partecipanti del meeting e li aggiunge alla rubrica.
    /// `people`: (nome, email se nota).
    pub fn set_attendees(&self, id: &str, people: &[(String, Option<String>)]) -> Result<()> {
        let names: Vec<&str> = people.iter().map(|(n, _)| n.as_str()).collect();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE meetings SET attendees = ?1, updated_at = ?3 WHERE id = ?2 AND attendees IS NOT ?1",
            params![serde_json::to_string(&names)?, id, now_ms()],
        )?;
        self.upsert_people(people)?;
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_tags(&self, id: &str, tags: &[String]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE meetings SET tags = ?1, updated_at = ?3 WHERE id = ?2 AND tags IS NOT ?1",
            params![serde_json::to_string(tags)?, id, now_ms()],
        )?;
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
                                       pinned_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE(?4, ?3))",
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
        // i progetti di esempio portano il nome di un tag: ci entrano i meeting con quel tag.
        // `clienti/cliente-nord` mette il progetto dentro `clienti`
        let mut leaves: Vec<String> = Vec::new();
        for (paths, archived) in [(&data.projects, false), (&data.archived, true)] {
            for path in paths {
                let mut parent: Option<String> = None;
                for name in path.split('/') {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO projects (id, name, archived, created_at, parent_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![uuid::Uuid::new_v4().to_string(), name, archived, now_ms(), parent],
                    )?;
                    parent = Some(self.conn.query_row("SELECT id FROM projects WHERE name = ?1", [name], |r| r.get(0))?);
                }
                leaves.extend(path.rsplit('/').next().map(String::from));
            }
        }
        // i gruppi di esempio hanno un id che comincia con `demo-`; uno con lo stesso nome di un
        // gruppo dell'utente non si crea, e le note di esempio restano senza
        for g in &data.groups {
            let id = crate::demo::DemoGroup::id(&g.key);
            let parent = g.parent.as_deref().map(|p| self.demo_group_id(p)).transpose()?.flatten();
            self.conn.execute(
                "INSERT INTO people_groups (id, name, parent_id, kind, members, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT DO NOTHING",
                params![id, g.name, parent, g.kind.as_str(), serde_json::to_string(&g.members)?, now_ms()],
            )?;
            self.add_known_people(&g.members)?;
            self.conn.execute(
                "UPDATE people_groups SET emails = ?1 WHERE id = ?2 AND emails = '[]'",
                params![serde_json::to_string(&g.emails)?, id],
            )?;
        }
        // ruolo e altri nomi solo a chi non li ha già: una persona dell'utente resta com'è
        for p in &data.people {
            self.conn.execute(
                "UPDATE people SET role = ?1 WHERE name = ?2 AND role = ''",
                params![p.role, p.name],
            )?;
            self.conn.execute(
                "UPDATE people SET aliases = ?1 WHERE name = ?2 AND aliases = '[]'",
                params![serde_json::to_string(&p.aliases)?, p.name],
            )?;
        }
        for m in data.meetings.iter().filter(|m| !m.groups.is_empty()) {
            let mut ids = Vec::new();
            for key in &m.groups {
                ids.extend(self.demo_group_id(key)?);
            }
            self.conn.execute(
                "UPDATE meetings SET group_ids = ?1 WHERE id = ?2",
                params![serde_json::to_string(&ids)?, m.id],
            )?;
            self.reindex(&m.id)?;
        }
        for m in &data.meetings {
            if let Some(name) = m.tags.iter().find(|t| leaves.contains(t)) {
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

    /// L'id del gruppo di esempio con quella chiave, se c'è: un gruppo dell'utente con lo stesso
    /// nome ha impedito di crearlo.
    fn demo_group_id(&self, key: &str) -> Result<Option<String>> {
        let id = crate::demo::DemoGroup::id(key);
        let exists: bool =
            self.conn.query_row("SELECT EXISTS(SELECT 1 FROM people_groups WHERE id = ?1)", [&id], |r| r.get(0))?;
        Ok(exists.then_some(id))
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
        // dai sotto-progetti in su: uno con dentro altro dell'utente resta
        for path in data.projects.iter().chain(&data.archived) {
            for name in path.split('/').rev() {
                self.conn.execute(
                    "DELETE FROM projects WHERE name = ?1
                     AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.project_id = projects.id)
                     AND NOT EXISTS (SELECT 1 FROM projects c WHERE c.parent_id = projects.id)",
                    [name],
                )?;
            }
        }
        // dai sotto-gruppi in su: uno usato da una nota dell'utente, o con dentro un suo gruppo, resta
        for g in data.groups.iter().rev() {
            self.conn.execute(
                "DELETE FROM people_groups WHERE id = ?1
                 AND NOT EXISTS (SELECT 1 FROM meetings m, json_each(m.group_ids) j WHERE j.value = ?1)
                 AND NOT EXISTS (SELECT 1 FROM people_groups c WHERE c.parent_id = ?1)",
                [crate::demo::DemoGroup::id(&g.key)],
            )?;
        }
        for name in data.people() {
            self.conn.execute(
                "DELETE FROM people WHERE name = ?1
                 AND NOT EXISTS (SELECT 1 FROM meetings m, json_each(m.attendees) j WHERE j.value = ?1 COLLATE NOCASE)
                 AND NOT EXISTS (SELECT 1 FROM people_groups g, json_each(g.members) j WHERE j.value = ?1 COLLATE NOCASE)",
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
            self.conn.prepare("SELECT id, name, color, description, archived, parent_id FROM projects ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                description: r.get(3)?,
                archived: r.get(4)?,
                parent_id: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Il progetto e quelli sopra, dal primo livello: `dambox`, `bizcard`. Un giro (che solo
    /// un sync andato storto potrebbe lasciare) si ferma.
    fn project_path(&self, id: &str) -> Result<Vec<String>> {
        let mut names = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut next = Some(id.to_string());
        while let Some(id) = next.take() {
            if !seen.insert(id.clone()) {
                break;
            }
            let row: Option<(String, Option<String>)> = self
                .conn
                .query_row("SELECT name, parent_id FROM projects WHERE id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let Some((name, parent)) = row else { break };
            names.push(name);
            next = parent;
        }
        names.reverse();
        Ok(names)
    }

    /// Il progetto e tutti quelli che contiene, a ogni livello.
    pub(crate) fn project_branch(&self, id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "WITH RECURSIVE branch(id) AS (SELECT ?1 UNION SELECT p.id FROM projects p JOIN branch b ON p.parent_id = b.id)
             SELECT id FROM branch",
        )?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Crea un progetto (`id` vuoto) o ne cambia nome, colore e descrizione. Due progetti non
    /// possono avere lo stesso nome, senza distinguere le maiuscole.
    pub fn save_project(
        &self,
        id: &str,
        name: &str,
        color: &str,
        description: &str,
        parent: Option<&str>,
    ) -> Result<Project> {
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
        if let Some(parent) = parent {
            let exists: bool =
                self.conn.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [parent], |r| r.get(0))?;
            if !exists {
                return Err(crate::tra!(
                    "Il progetto che dovrebbe contenerlo non c'è più. Scegline un altro.",
                    "The project meant to contain it no longer exists. Choose another one."
                ));
            }
            if !id.is_empty() && self.project_branch(id)?.iter().any(|p| p == parent) {
                return Err(crate::tra!(
                    "Un progetto non può stare dentro sé stesso o dentro uno dei suoi sotto-progetti. Scegli un altro progetto.",
                    "A project cannot sit inside itself or one of its sub-projects. Choose another project."
                ));
            }
        }
        let id = if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id.to_string() };
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "INSERT INTO projects (id, name, color, description, created_at, parent_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
             description = excluded.description, parent_id = excluded.parent_id",
            params![id, name, color, description, now_ms(), parent],
        )?;
        // i nomi del progetto e di quelli sopra sono nell'indice di ricerca dei meeting, anche
        // di quelli nei sotto-progetti
        for p in self.project_branch(&id)? {
            self.reindex_project(&p)?;
        }
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

    /// Elimina il progetto: i suoi meeting restano, senza progetto, e i suoi sotto-progetti
    /// salgono di un livello.
    pub fn delete_project(&self, id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let branch = self.project_branch(id)?;
        self.conn.execute(
            "UPDATE projects SET parent_id = (SELECT parent_id FROM projects WHERE id = ?1) WHERE parent_id = ?1",
            [id],
        )?;
        let ids = self.project_meetings(id)?;
        self.conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
        for m in ids {
            self.reindex(&m)?;
        }
        for p in branch.iter().filter(|p| *p != id) {
            self.reindex_project(p)?;
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

    // ---------- gruppi di persone ----------

    /// I gruppi in ordine alfabetico, con il numero di note in cui compaiono.
    pub fn list_groups(&self) -> Result<Vec<Group>> {
        let mut stmt = self.conn.prepare(
            "SELECT g.id, g.name, g.color, g.description, g.parent_id, g.kind, g.members, COUNT(m.id), MAX(m.created_at),
                    g.emails
             FROM people_groups g
             LEFT JOIN meetings m ON EXISTS (SELECT 1 FROM json_each(m.group_ids) j WHERE j.value = g.id)
             GROUP BY g.id ORDER BY g.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Group {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                description: r.get(3)?,
                parent_id: r.get(4)?,
                kind: GroupKind::parse(&r.get::<_, String>(5)?),
                members: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
                emails: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(),
                meetings: r.get(7)?,
                last_meeting_at: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn get_group(&self, id: &str) -> Result<Option<Group>> {
        Ok(self.list_groups()?.into_iter().find(|g| g.id == id))
    }

    /// Il gruppo e tutti quelli che contiene, a ogni livello.
    pub(crate) fn group_branch(&self, id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "WITH RECURSIVE branch(id) AS (SELECT ?1 UNION SELECT g.id FROM people_groups g JOIN branch b ON g.parent_id = b.id)
             SELECT id FROM branch",
        )?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Le note in cui compare il gruppo.
    fn group_meetings(&self, id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id FROM meetings m WHERE EXISTS (SELECT 1 FROM json_each(m.group_ids) j WHERE j.value = ?1)",
        )?;
        let rows = stmt.query_map([id], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Crea un gruppo (`id` vuoto) o ne cambia nome, colore, descrizione, genitore, tipo e
    /// membri. Due gruppi non possono avere lo stesso nome; i membri nuovi entrano in rubrica.
    #[allow(clippy::too_many_arguments)]
    pub fn save_group(
        &self,
        id: &str,
        name: &str,
        color: &str,
        description: &str,
        parent: Option<&str>,
        kind: GroupKind,
        members: &[String],
        emails: &[String],
    ) -> Result<Group> {
        let taken: Option<String> = self
            .conn
            .query_row("SELECT id FROM people_groups WHERE name = ?1", [name], |r| r.get(0))
            .optional()?;
        if taken.as_deref().is_some_and(|other| other != id) {
            return Err(crate::tra!(
                "Esiste già un gruppo con il nome «{name}». Scegline un altro.",
                "A group named \"{name}\" already exists. Choose another name."
            ));
        }
        if let Some(parent) = parent {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM people_groups WHERE id = ?1)", [parent], |r| r.get(0))?;
            if !exists {
                return Err(crate::tra!(
                    "Il gruppo che dovrebbe contenerlo non c'è più. Scegline un altro.",
                    "The group meant to contain it no longer exists. Choose another one."
                ));
            }
            if !id.is_empty() && self.group_branch(id)?.iter().any(|g| g == parent) {
                return Err(crate::tra!(
                    "Un gruppo non può stare dentro sé stesso o dentro uno dei gruppi che contiene. Scegli un altro gruppo.",
                    "A group cannot sit inside itself or one of the groups it contains. Choose another group."
                ));
            }
        }
        let renamed = !id.is_empty()
            && self
                .conn
                .query_row("SELECT name FROM people_groups WHERE id = ?1", [id], |r| r.get::<_, String>(0))
                .optional()?
                .is_some_and(|before| before != name);
        let id = if id.is_empty() { uuid::Uuid::new_v4().to_string() } else { id.to_string() };
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "INSERT INTO people_groups (id, name, color, description, parent_id, kind, members, created_at, emails)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
             description = excluded.description, parent_id = excluded.parent_id, kind = excluded.kind,
             members = excluded.members, emails = excluded.emails",
            params![
                id,
                name,
                color,
                description,
                parent,
                kind.as_str(),
                serde_json::to_string(members)?,
                now_ms(),
                serde_json::to_string(emails)?
            ],
        )?;
        self.add_known_people(members)?;
        // il nome del gruppo è nell'indice di ricerca delle sue note
        if renamed {
            for m in self.group_meetings(&id)? {
                self.reindex(&m)?;
            }
        }
        tx.commit()?;
        self.get_group(&id)?.ok_or_else(|| anyhow::anyhow!("gruppo non trovato dopo il salvataggio"))
    }

    /// Aggiunge e toglie membri a un gruppo (la selezione multipla della pagina Persone).
    pub fn change_group_members(&self, id: &str, add: &[String], remove: &[String]) -> Result<Group> {
        let tx = self.conn.unchecked_transaction()?;
        let current: String = self
            .conn
            .query_row("SELECT members FROM people_groups WHERE id = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| crate::tra!("Gruppo non trovato: ricarica l'elenco.", "Group not found: reload the list."))?;
        let mut members: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
        members.retain(|m| !remove.iter().any(|r| r.eq_ignore_ascii_case(m)));
        for name in add {
            if !members.iter().any(|m| m.eq_ignore_ascii_case(name)) && members.len() < MAX_GROUP_MEMBERS {
                members.push(name.clone());
            }
        }
        self.conn.execute(
            "UPDATE people_groups SET members = ?1 WHERE id = ?2",
            params![serde_json::to_string(&members)?, id],
        )?;
        self.add_known_people(add)?;
        tx.commit()?;
        self.get_group(id)?.ok_or_else(|| anyhow::anyhow!("gruppo non trovato dopo il salvataggio"))
    }

    /// Mette in rubrica i nomi che non ci sono ancora, senza toccare "ultimo uso" di chi c'è:
    /// entrare in un gruppo non è partecipare a una nota.
    fn add_known_people(&self, names: &[String]) -> Result<()> {
        let now = now_ms();
        for name in names.iter().map(|n| n.trim()).filter(|n| !n.is_empty()) {
            self.conn.execute(
                "INSERT OR IGNORE INTO people (name, created_at, last_used_at) VALUES (?1, ?2, ?2)",
                params![name, now],
            )?;
        }
        Ok(())
    }

    /// Elimina il gruppo: le note restano (senza quel gruppo), le persone pure, e i gruppi che
    /// conteneva salgono di un livello.
    pub fn delete_group(&self, id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "UPDATE people_groups SET parent_id = (SELECT parent_id FROM people_groups WHERE id = ?1) WHERE parent_id = ?1",
            [id],
        )?;
        for m in self.group_meetings(id)? {
            let current: String = self.conn.query_row("SELECT group_ids FROM meetings WHERE id = ?1", [&m], |r| r.get(0))?;
            let mut ids: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
            ids.retain(|g| g != id);
            self.conn.execute(
                "UPDATE meetings SET group_ids = ?1 WHERE id = ?2",
                params![serde_json::to_string(&ids)?, m],
            )?;
            self.reindex(&m)?;
        }
        self.conn.execute("DELETE FROM people_groups WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    /// Sostituisce i gruppi presenti in un meeting. Gli id che non sono gruppi si scartano.
    pub fn set_meeting_groups(&self, id: &str, groups: &[String]) -> Result<()> {
        let mut ids: Vec<String> = Vec::new();
        for g in groups {
            let exists: bool =
                self.conn.query_row("SELECT EXISTS(SELECT 1 FROM people_groups WHERE id = ?1)", [g], |r| r.get(0))?;
            if exists && !ids.contains(g) && ids.len() < MAX_MEETING_GROUPS {
                ids.push(g.clone());
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute(
            "UPDATE meetings SET group_ids = ?1, updated_at = ?3 WHERE id = ?2 AND group_ids IS NOT ?1",
            params![serde_json::to_string(&ids)?, id, now_ms()],
        )?;
        self.reindex(id)?;
        tx.commit()?;
        Ok(())
    }

    /// I nomi dei gruppi di un meeting, nell'ordine in cui ci sono. Un gruppo eliminato (o non
    /// ancora arrivato dal sync) non c'è.
    pub fn group_names(&self, ids: &[String]) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for id in ids {
            if let Some(name) = self
                .conn
                .query_row("SELECT name FROM people_groups WHERE id = ?1", [id], |r| r.get::<_, String>(0))
                .optional()?
            {
                out.push(name);
            }
        }
        Ok(out)
    }

    /// Porta il nome nuovo di una persona nei gruppi di cui fa parte (senza doppioni), o la
    /// toglie (`new` = `None`). Senza transazione propria: la apre chi chiama.
    fn rename_in_groups(&self, old: &str, new: Option<&str>) -> Result<()> {
        let rows: Vec<(String, String)> = {
            let mut stmt = self.conn.prepare("SELECT id, members FROM people_groups")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (id, json) in rows {
            let list: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
            if !list.iter().any(|m| m.trim().eq_ignore_ascii_case(old)) {
                continue;
            }
            let mut renamed: Vec<String> = Vec::new();
            for m in list {
                let m = if m.trim().eq_ignore_ascii_case(old) {
                    match new {
                        Some(n) => n.to_string(),
                        None => continue,
                    }
                } else {
                    m
                };
                if !renamed.iter().any(|x| x.eq_ignore_ascii_case(&m)) {
                    renamed.push(m);
                }
            }
            self.conn.execute(
                "UPDATE people_groups SET members = ?1 WHERE id = ?2",
                params![serde_json::to_string(&renamed)?, id],
            )?;
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

    /// Rubrica completa, con il numero di meeting di ogni persona e la data dell'ultimo.
    pub fn list_people(&self) -> Result<Vec<Person>> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, p.email, COUNT(m.id), MAX(m.created_at), p.role, p.aliases
             FROM people p
             LEFT JOIN meetings m ON EXISTS (
                 SELECT 1 FROM json_each(m.attendees) j WHERE j.value = p.name COLLATE NOCASE
             )
             GROUP BY p.id ORDER BY p.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Person {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                role: r.get(5)?,
                aliases: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
                meetings: r.get(3)?,
                last_meeting_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Persone il cui nome, email o uno degli altri nomi contiene `query`, le usate più di recente
    /// per prime.
    pub fn search_people(&self, query: &str, limit: usize) -> Result<Vec<Person>> {
        let like = format!("%{}%", query.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email, role, aliases FROM people p
             WHERE name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM json_each(p.aliases) j WHERE j.value LIKE ?1 ESCAPE '\\')
             ORDER BY last_used_at DESC, name LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like, limit as i64], |r| {
            Ok(Person {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                role: r.get(3)?,
                aliases: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
                meetings: 0,
                last_meeting_at: None,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// L'email di una persona in rubrica, se c'è.
    pub fn person_email(&self, name: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT email FROM people WHERE name = ?1", [name.trim()], |r| r.get::<_, Option<String>>(0))
            .optional()?
            .flatten())
    }

    /// Le persone senza email: la rubrica del Mac può completarle.
    pub fn people_without_email(&self) -> Result<Vec<(i64, String)>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM people WHERE email IS NULL OR email = '' ORDER BY name")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Dà l'email a una persona che non ne ha ancora una.
    pub fn fill_person_email(&self, id: i64, email: &str) -> Result<bool> {
        let n = self.conn.execute(
            "UPDATE people SET email = ?1 WHERE id = ?2 AND (email IS NULL OR email = '')",
            params![email.trim(), id],
        )?;
        Ok(n > 0)
    }

    /// Cambia nome ed email di una persona. Il nome nuovo arriva ovunque compaia quello vecchio:
    /// partecipanti dei meeting, menzioni `@[Nome]` e citazioni nelle note.
    #[cfg(test)]
    pub fn update_person(&self, id: i64, name: &str, email: Option<&str>) -> Result<()> {
        self.update_person_details(id, name, email, None, None)
    }

    /// Come `update_person`, e in più ruolo e altri nomi (`None` = restano come sono). Il nome
    /// vecchio diventa uno degli altri nomi: il calendario o un'altra nota possono ancora usarlo.
    pub fn update_person_details(
        &self,
        id: i64,
        name: &str,
        email: Option<&str>,
        role: Option<&str>,
        aliases: Option<&[String]>,
    ) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(crate::tra!(
                "Il nome non può essere vuoto: scrivi come si chiama la persona.",
                "The name can't be empty: type the person's name."
            ));
        }
        let email = email.map(str::trim).filter(|e| !e.is_empty());
        let tx = self.conn.unchecked_transaction()?;
        let (old, created, used, old_role, old_aliases): (String, i64, i64, String, String) = self
            .conn
            .query_row(
                "SELECT name, created_at, last_used_at, role, aliases FROM people WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?
            .ok_or_else(|| crate::tra!("Persona non trovata: ricarica l'elenco.", "Person not found: reload the list."))?;
        let role = role.map(|r| r.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or(old_role);
        let mut others: Vec<String> = match aliases {
            Some(list) => list.to_vec(),
            None => serde_json::from_str(&old_aliases).unwrap_or_default(),
        };
        if old != name {
            others.push(old.clone());
        }
        let others = clean_aliases(others, name);
        if old == name {
            self.conn.execute(
                "UPDATE people SET email = ?1, role = ?2, aliases = ?3 WHERE id = ?4",
                params![email, role, serde_json::to_string(&others)?, id],
            )?;
        } else {
            let taken: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM people WHERE name = ?1 COLLATE NOCASE AND id != ?2)",
                params![name, id],
                |r| r.get(0),
            )?;
            if taken {
                return Err(crate::tra!(
                    "In rubrica c'è già «{name}»: per tenerne una sola usa Unisci.",
                    "“{name}” is already in your people: use Merge to keep just one."
                ));
            }
            // il sync riconosce una persona dal nome: cambiarlo è togliere la vecchia e aggiungere la nuova
            self.conn.execute("DELETE FROM people WHERE id = ?1", [id])?;
            self.conn.execute(
                "INSERT INTO people (id, name, email, created_at, last_used_at, role, aliases)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, name, email, created, used, role, serde_json::to_string(&others)?],
            )?;
            self.rename_in_meetings(&old, name)?;
            self.rename_in_groups(&old, Some(name))?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Unisce due persone che sono la stessa: `from` sparisce e i suoi meeting passano a `into`,
    /// che prende anche l'email di `from` se non ne aveva una.
    pub fn merge_people(&self, from: i64, into: i64) -> Result<()> {
        if from == into {
            return Err(crate::tra!(
                "Scegli una persona diversa con cui unire.",
                "Choose a different person to merge with."
            ));
        }
        let tx = self.conn.unchecked_transaction()?;
        let get = |id: i64| -> Result<(String, Option<String>, i64, i64)> {
            self.conn
                .query_row("SELECT name, email, created_at, last_used_at FROM people WHERE id = ?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .optional()?
                .ok_or_else(|| crate::tra!("Persona non trovata: ricarica l'elenco.", "Person not found: reload the list."))
        };
        let (from_name, from_email, from_created, from_used) = get(from)?;
        let (into_name, ..) = get(into)?;
        // il nome tolto (e i suoi altri nomi) diventa un altro nome di chi resta: «E. Rossi» nel
        // calendario è ancora Elena
        let names = |id: i64| -> Result<(String, Vec<String>)> {
            let (role, aliases): (String, String) =
                self.conn.query_row("SELECT role, aliases FROM people WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            Ok((role, serde_json::from_str(&aliases).unwrap_or_default()))
        };
        let (from_role, from_aliases) = names(from)?;
        let (_, into_aliases) = names(into)?;
        let aliases = clean_aliases(
            into_aliases.into_iter().chain(from_aliases).chain([from_name.clone()]).collect(),
            &into_name,
        );
        self.conn.execute("DELETE FROM people WHERE id = ?1", [from])?;
        self.conn.execute(
            "UPDATE people SET email = COALESCE(NULLIF(email, ''), ?1), created_at = MIN(created_at, ?2),
                    last_used_at = MAX(last_used_at, ?3), role = COALESCE(NULLIF(role, ''), ?5), aliases = ?6
             WHERE id = ?4",
            params![from_email, from_created, from_used, into, from_role, serde_json::to_string(&aliases)?],
        )?;
        self.rename_in_meetings(&from_name, &into_name)?;
        self.rename_in_groups(&from_name, Some(&into_name))?;
        tx.commit()?;
        Ok(())
    }

    /// Porta il nome nuovo nei meeting: partecipanti (senza doppioni), menzioni e citazioni.
    /// Senza transazione propria: la apre chi chiama.
    fn rename_in_meetings(&self, old: &str, new: &str) -> Result<()> {
        let changed: Vec<(String, String, String, Option<String>)> = {
            let mut stmt = self.conn.prepare("SELECT id, attendees, notes_md, enhanced_md FROM meetings")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
            let mut out = Vec::new();
            for row in rows {
                let (id, attendees, notes, enhanced): (String, String, String, Option<String>) = row?;
                let list: Vec<String> = serde_json::from_str(&attendees).unwrap_or_default();
                let mut renamed: Vec<String> = Vec::new();
                for a in list {
                    let a = if a.trim().eq_ignore_ascii_case(old) { new.to_string() } else { a };
                    if !renamed.iter().any(|x| x.eq_ignore_ascii_case(&a)) {
                        renamed.push(a);
                    }
                }
                let attendees_new = serde_json::to_string(&renamed)?;
                let notes_new = rename_in_notes(&notes, old, new);
                let enhanced_new = enhanced.as_deref().map(|e| rename_in_notes(e, old, new));
                if attendees_new != attendees || notes_new != notes || enhanced_new != enhanced {
                    out.push((id, attendees_new, notes_new, enhanced_new));
                }
            }
            out
        };
        for (id, attendees, notes, enhanced) in changed {
            self.conn.execute(
                "UPDATE meetings SET attendees = ?1, notes_md = ?2, enhanced_md = ?3 WHERE id = ?4",
                params![attendees, notes, enhanced, id],
            )?;
            self.reindex(&id)?;
        }
        Ok(())
    }

    /// Toglie una persona dalla rubrica e dai suoi gruppi. I meeting a cui ha partecipato non
    /// cambiano.
    pub fn delete_person(&self, id: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let name: Option<String> =
            self.conn.query_row("SELECT name FROM people WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        self.conn.execute("DELETE FROM people WHERE id = ?1", [id])?;
        if let Some(name) = name {
            self.rename_in_groups(&name, None)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Il nome in rubrica per chi è scritto in un altro modo: uno dei suoi altri nomi, o la sua
    /// email. Chi non si riconosce resta com'è.
    pub fn canonical_people(&self, people: &[(String, Option<String>)]) -> Result<Vec<(String, Option<String>)>> {
        let known = self.list_people()?;
        let mut out: Vec<(String, Option<String>)> = Vec::new();
        for (name, email) in people {
            let found = known.iter().find(|p| p.name.eq_ignore_ascii_case(name.trim())).or_else(|| {
                known
                    .iter()
                    .find(|p| p.aliases.iter().any(|a| a.eq_ignore_ascii_case(name.trim())))
                    .or_else(|| {
                        let email = email.as_deref()?;
                        known.iter().find(|p| p.email.as_deref().is_some_and(|e| e.eq_ignore_ascii_case(email)))
                    })
            });
            let pair = match found {
                Some(p) => (p.name.clone(), email.clone().or_else(|| p.email.clone())),
                None => (name.clone(), email.clone()),
            };
            if !out.iter().any(|(n, _)| n.eq_ignore_ascii_case(&pair.0)) {
                out.push(pair);
            }
        }
        Ok(out)
    }

    /// Coppie di persone che sembrano la stessa: stessa email, stesso nome scritto diversamente
    /// («Rossi, Elena» e «Elena Rossi»), oppure l'iniziale del nome («E. Rossi»). Il primo della
    /// coppia è quello con più note: di solito è quello da tenere.
    pub fn possible_duplicates(&self) -> Result<Vec<Duplicate>> {
        let people = self.list_people()?;
        let mut out: Vec<Duplicate> = Vec::new();
        for (i, a) in people.iter().enumerate() {
            for b in &people[i + 1..] {
                let reason = if a.email.as_deref().zip(b.email.as_deref()).is_some_and(|(x, y)| x.eq_ignore_ascii_case(y)) {
                    "email"
                } else if name_key(&a.name) == name_key(&b.name) {
                    "name"
                } else if initial_of(&a.name, &b.name) || initial_of(&b.name, &a.name) {
                    "initial"
                } else {
                    continue;
                };
                let (keep, drop) = if b.meetings > a.meetings { (b, a) } else { (a, b) };
                out.push(Duplicate { keep: keep.id, drop: drop.id, reason: reason.into() });
            }
        }
        Ok(out)
    }

    /// Aggiunge le persone di un file (CSV o vCard): chi c'è già riceve email e ruolo se non li
    /// aveva; i gruppi indicati si creano se mancano (`Azienda/Sviluppo` dentro `Azienda`), e le
    /// persone ci entrano. Un gruppo nuovo con più di `TEAM_SIZE` membri è un pubblico.
    pub fn import_people(&self, rows: &[ImportedPerson]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let now = now_ms();
        let mut members: Vec<(String, Vec<String>)> = Vec::new();
        for row in rows {
            let name: String = row.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
            if name.is_empty() {
                continue;
            }
            let email = row.email.as_deref().map(str::trim).filter(|e| e.contains('@'));
            let role: String = row.role.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
            self.conn.execute(
                "INSERT INTO people (name, email, role, created_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(name) DO UPDATE SET email = COALESCE(NULLIF(people.email, ''), excluded.email),
                 role = CASE WHEN people.role = '' THEN excluded.role ELSE people.role END",
                params![name, email, role, now],
            )?;
            let name: String = self.conn.query_row("SELECT name FROM people WHERE name = ?1", [&name], |r| r.get(0))?;
            for path in &row.groups {
                let path: Vec<String> = path
                    .split(['/', '›', '>'])
                    .map(|p| p.split_whitespace().collect::<Vec<_>>().join(" "))
                    .filter(|p| !p.is_empty())
                    .collect();
                if path.is_empty() {
                    continue;
                }
                let leaf = path.join("/");
                match members.iter_mut().find(|(p, _)| p.eq_ignore_ascii_case(&leaf)) {
                    Some((_, list)) => list.push(name.clone()),
                    None => members.push((leaf, vec![name.clone()])),
                }
            }
        }
        for (path, names) in members {
            let mut parent: Option<String> = None;
            let parts: Vec<&str> = path.split('/').collect();
            for (depth, part) in parts.iter().enumerate() {
                let existing: Option<(String, String)> = self
                    .conn
                    .query_row("SELECT id, members FROM people_groups WHERE name = ?1", [part], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
                let last = depth == parts.len() - 1;
                let id = match existing {
                    Some((id, _)) => id,
                    None => {
                        let id = uuid::Uuid::new_v4().to_string();
                        let size = if last { names.len() } else { 0 };
                        let kind = if size > crate::models::TEAM_SIZE { GroupKind::Audience } else { GroupKind::Team };
                        self.conn.execute(
                            "INSERT INTO people_groups (id, name, parent_id, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![id, part, parent, kind.as_str(), now],
                        )?;
                        id
                    }
                };
                if last {
                    let current: String =
                        self.conn.query_row("SELECT members FROM people_groups WHERE id = ?1", [&id], |r| r.get(0))?;
                    let mut list: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
                    for n in &names {
                        if !list.iter().any(|m| m.eq_ignore_ascii_case(n)) && list.len() < MAX_GROUP_MEMBERS {
                            list.push(n.clone());
                        }
                    }
                    self.conn.execute(
                        "UPDATE people_groups SET members = ?1 WHERE id = ?2",
                        params![serde_json::to_string(&list)?, id],
                    )?;
                }
                parent = Some(id);
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Il meeting con la descrizione dei suoi gruppi, pronto per un prompt.
    pub fn with_groups(&self, mut meeting: Meeting) -> Result<Meeting> {
        meeting.groups_brief = self.groups_brief(&meeting.group_ids)?;
        Ok(meeting)
    }

    /// I gruppi di un meeting come li legge un modello: nome, tipo e quante persone, mai i nomi
    /// dei membri («Tutta l'azienda (pubblico, 124 persone)»).
    pub fn groups_brief(&self, ids: &[String]) -> Result<Vec<String>> {
        let groups = self.list_groups()?;
        Ok(ids
            .iter()
            .filter_map(|id| groups.iter().find(|g| &g.id == id))
            .map(|g| {
                let kind = match g.kind {
                    GroupKind::Team => tr("team", "team"),
                    GroupKind::Audience => tr("pubblico", "audience"),
                };
                let n = g.members.len();
                let people = if n == 1 { tr("1 persona", "1 person").to_string() } else { crate::trf!("{n} persone", "{n} people") };
                format!("{} ({kind}, {people})", g.name)
            })
            .collect())
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

    /// true se qualche meeting cita ancora quell'allegato nelle note o nelle note AI, o se è
    /// un file senza nota della Libreria.
    pub fn attachment_in_use(&self, path: &str) -> Result<bool> {
        let n: i64 = self.conn.query_row(
            "SELECT (SELECT COUNT(*) FROM meetings
                     WHERE instr(notes_md, ?1) > 0 OR instr(COALESCE(enhanced_md, ''), ?1) > 0)
                  + (SELECT COUNT(*) FROM files WHERE path = ?1)",
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
                            project_id, pinned_at, COALESCE(updated_at, created_at), group_ids
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
                        group_ids: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(),
                        project_id: r.get(6)?,
                        pinned_at: r.get(7)?,
                        updated_at: r.get(8)?,
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
                            snippet(meetings_fts, -1, '«', '»', '…', 12), m.tags, m.project_id, m.pinned_at,
                            COALESCE(m.updated_at, m.created_at), m.group_ids
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
                        group_ids: serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default(),
                        project_id: r.get(7)?,
                        pinned_at: r.get(8)?,
                        updated_at: r.get(9)?,
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
        // il progetto con quelli sopra: cercando `dambox` si trovano anche le note di `bizcard`
        let project = match &m.project_id {
            Some(p) => self.project_path(p)?.join(" "),
            None => String::new(),
        };
        let groups = self.group_names(&m.group_ids)?.join(" ");
        self.conn.execute("DELETE FROM meetings_fts WHERE meeting_id = ?1", [id])?;
        self.conn.execute(
            "INSERT INTO meetings_fts (meeting_id, title, notes, enhanced, transcript) VALUES (?1, ?2, ?3, ?4, ?5)",
            // progetto, tag, partecipanti e gruppi stanno con il titolo: così si trovano cercandoli
            params![
                id,
                [m.title.as_str(), &project, &m.tags.join(" "), &m.attendees.join(" "), &groups]
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

    // ---------- file e import ----------

    /// Il testo di ogni nota (note e note AI), per trovare gli allegati che cita.
    pub fn notes_for_files(&self) -> Result<Vec<(String, String, i64, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, COALESCE(updated_at, created_at), notes_md || char(10) || COALESCE(enhanced_md, '')
             FROM meetings WHERE instr(notes_md, 'attachments/') > 0 OR instr(COALESCE(enhanced_md, ''), 'attachments/') > 0",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// I file senza nota, dal più recente.
    pub fn loose_files(&self) -> Result<Vec<LooseFile>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, name, bytes, folder, created_at FROM files ORDER BY created_at DESC, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(LooseFile {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                bytes: r.get(3)?,
                folder: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Toglie un file senza nota dall'elenco. Ritorna il suo percorso tra gli allegati.
    pub fn delete_file(&self, id: &str) -> Result<Option<String>> {
        let path: Option<String> =
            self.conn.query_row("SELECT path FROM files WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        self.conn.execute("DELETE FROM files WHERE id = ?1", [id])?;
        Ok(path)
    }

    /// Le note e i file senza nota già importati da quella cartella: percorso nella cartella →
    /// impronta del contenuto (vuota per i file).
    pub fn already_imported(&self, root: &str) -> Result<std::collections::HashMap<String, String>> {
        let mut stmt = self.conn.prepare(
            "SELECT n.source_path, n.source_hash FROM imported_notes n JOIN imports i ON i.id = n.import_id
             WHERE i.root = ?1
             UNION ALL
             SELECT f.source_path, '' FROM files f JOIN imports i ON i.id = f.import_id
             WHERE i.root = ?1 AND f.source_path IS NOT NULL",
        )?;
        let rows = stmt.query_map([root], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Scrive un import: le note, i file senza nota, i progetti che mancano. Tutto o niente.
    pub fn save_import(
        &self,
        source: &str,
        root: &str,
        notes: &[NewNote],
        files: &[NewFile],
        privacy: Privacy,
        report: &serde_json::Value,
    ) -> Result<ImportRecord> {
        let tx = self.conn.unchecked_transaction()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO imports (id, source, root, created_at, report) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, source, root, now, report.to_string()],
        )?;
        // ogni livello del percorso è un progetto: uno con lo stesso nome che c'è già si usa
        // com'è (anche se sta altrove), gli altri nascono dentro quello sopra
        let mut created: Vec<String> = Vec::new();
        let mut project_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for path in notes.iter().map(|n| &n.project) {
            let mut parent: Option<String> = None;
            for depth in 1..=path.len() {
                let key = path[..depth].join("/").to_lowercase();
                let name = &path[depth - 1];
                let pid = match project_ids.get(&key) {
                    Some(pid) => pid.clone(),
                    None => {
                        let existing: Option<String> = self
                            .conn
                            .query_row("SELECT id FROM projects WHERE name = ?1", [name], |r| r.get(0))
                            .optional()?;
                        let pid = match existing {
                            Some(pid) => pid,
                            None => {
                                let pid = uuid::Uuid::new_v4().to_string();
                                // archiviato solo se tutte le sue note venivano dall'archivio
                                let archived = notes
                                    .iter()
                                    .filter(|n| {
                                        n.project.len() >= depth
                                            && n.project[..depth].join("/").to_lowercase() == key
                                    })
                                    .all(|n| n.archived_project);
                                self.conn.execute(
                                    "INSERT INTO projects (id, name, archived, created_at, parent_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                                    params![pid, name, archived, now, parent],
                                )?;
                                created.push(pid.clone());
                                pid
                            }
                        };
                        project_ids.insert(key, pid.clone());
                        pid
                    }
                };
                parent = Some(pid);
            }
        }
        self.conn.execute(
            "UPDATE imports SET projects = ?1 WHERE id = ?2",
            params![serde_json::to_string(&created)?, id],
        )?;
        // le persone che la rubrica non aveva: l'annullamento le toglie se non servono ad altri
        let mut new_people: Vec<String> = Vec::new();
        for name in notes.iter().flat_map(|n| &n.attendees) {
            let known: bool = self.conn.query_row("SELECT COUNT(*) > 0 FROM people WHERE name = ?1", [name], |r| r.get(0))?;
            if !known && !new_people.iter().any(|p| p.eq_ignore_ascii_case(name)) {
                new_people.push(name.clone());
            }
        }
        self.conn.execute(
            "UPDATE imports SET people = ?1 WHERE id = ?2",
            params![serde_json::to_string(&new_people)?, id],
        )?;
        for n in notes {
            let mid = uuid::Uuid::new_v4().to_string();
            let project = project_ids.get(&n.project.join("/").to_lowercase());
            self.conn.execute(
                "INSERT INTO meetings (id, title, created_at, updated_at, attendees, tags, notes_md, privacy, project_id)
                 VALUES (?1, ?2, ?3, ?4, ?9, ?5, ?6, ?7, ?8)",
                params![
                    mid,
                    n.title,
                    n.created_at,
                    n.updated_at,
                    serde_json::to_string(&n.tags)?,
                    n.notes_md,
                    privacy.as_str(),
                    project,
                    serde_json::to_string(&n.attendees)?
                ],
            )?;
            self.upsert_people(&n.attendees.iter().map(|a| (a.clone(), None)).collect::<Vec<_>>())?;
            self.conn.execute(
                "INSERT INTO imported_notes (meeting_id, import_id, source_path, source_hash) VALUES (?1, ?2, ?3, ?4)",
                params![mid, id, n.source_path, n.source_hash],
            )?;
            self.reindex(&mid)?;
        }
        for f in files {
            self.conn.execute(
                "INSERT INTO files (id, path, name, bytes, folder, created_at, import_id, source_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![uuid::Uuid::new_v4().to_string(), f.path, f.name, f.bytes, f.folder, f.created_at, id, f.source_path],
            )?;
        }
        tx.commit()?;
        self.list_imports()?.into_iter().find(|i| i.id == id).ok_or_else(|| anyhow::anyhow!("import non trovato"))
    }

    /// Gli import fatti, dal più recente, con quante note e file ne restano.
    pub fn list_imports(&self) -> Result<Vec<ImportRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT i.id, i.source, i.root, i.created_at, i.report,
                    (SELECT COUNT(*) FROM imported_notes n WHERE n.import_id = i.id),
                    (SELECT COUNT(*) FROM files f WHERE f.import_id = i.id)
             FROM imports i ORDER BY i.created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            let report: String = r.get(4)?;
            Ok(ImportRecord {
                id: r.get(0)?,
                source: r.get(1)?,
                root: r.get(2)?,
                created_at: r.get(3)?,
                report: serde_json::from_str(&report).unwrap_or(serde_json::Value::Null),
                notes: r.get(5)?,
                files: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Annulla un import: toglie le sue note (anche se modificate dopo), i suoi file senza nota e
    /// i progetti che aveva creato e che sono rimasti vuoti. Ritorna il testo delle note tolte e i
    /// percorsi dei file, perché chi chiama elimini gli allegati che non servono più.
    pub fn undo_import(&self, id: &str) -> Result<(Vec<String>, Vec<String>)> {
        let tx = self.conn.unchecked_transaction()?;
        let notes: Vec<(String, String)> = {
            let mut stmt = self.conn.prepare(
                "SELECT m.id, m.notes_md || char(10) || COALESCE(m.enhanced_md, '')
                 FROM imported_notes n JOIN meetings m ON m.id = n.meeting_id WHERE n.import_id = ?1",
            )?;
            let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (mid, _) in &notes {
            self.delete_meeting_rows(mid)?;
        }
        let files: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT path FROM files WHERE import_id = ?1")?;
            let rows = stmt.query_map([id], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        self.conn.execute("DELETE FROM files WHERE import_id = ?1", [id])?;
        let (projects, people): (Option<String>, Option<String>) = self
            .conn
            .query_row("SELECT projects, people FROM imports WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .unzip();
        for name in serde_json::from_str::<Vec<String>>(&people.unwrap_or_default()).unwrap_or_default() {
            self.conn.execute(
                "DELETE FROM people WHERE name = ?1
                 AND NOT EXISTS (SELECT 1 FROM meetings m, json_each(m.attendees) j WHERE j.value = ?1 COLLATE NOCASE)",
                [&name],
            )?;
        }
        // dai sotto-progetti in su: un progetto se ne va solo se non ha più note né sotto-progetti
        for pid in serde_json::from_str::<Vec<String>>(&projects.unwrap_or_default()).unwrap_or_default().iter().rev() {
            self.conn.execute(
                "DELETE FROM projects WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM meetings WHERE project_id = ?1)
                 AND NOT EXISTS (SELECT 1 FROM projects WHERE parent_id = ?1)",
                [pid],
            )?;
        }
        self.conn.execute("DELETE FROM imports WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok((notes.into_iter().map(|(_, text)| text).collect(), files))
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

/// Il nome nuovo nelle note: nelle menzioni `@[Nome]` e in chi parla nelle citazioni
/// (`::: quote 12:34 Nome` o `::: quote Nome`, anche dentro un riquadro `>`).
fn rename_in_notes(md: &str, old: &str, new: &str) -> String {
    if !md.contains(old) {
        return md.to_string();
    }
    let md = md.replace(&format!("@[{old}]"), &format!("@[{new}]"));
    let mut out: Vec<String> = Vec::new();
    for line in md.split('\n') {
        out.push(rename_quote(line, old, new).unwrap_or_else(|| line.to_string()));
    }
    out.join("\n")
}

/// `short` è l'iniziale del nome di `long`, con lo stesso cognome: «E. Rossi» e «Elena Rossi».
fn initial_of(short: &str, long: &str) -> bool {
    let (s, l) = (name_key(short), name_key(long));
    let sw: Vec<&str> = s.split(' ').collect();
    let lw: Vec<&str> = l.split(' ').collect();
    if sw.len() != 2 || lw.len() != 2 {
        return false;
    }
    // le parole sono in ordine alfabetico: l'iniziale è quella di una lettera sola
    let (initial, surname) = match (sw[0].chars().count(), sw[1].chars().count()) {
        (1, n) if n > 1 => (sw[0], sw[1]),
        (n, 1) if n > 1 => (sw[1], sw[0]),
        _ => return false,
    };
    lw.contains(&surname) && lw.iter().any(|w| *w != surname && w.starts_with(initial))
}

/// Altri nomi di una persona: puliti, senza doppioni e senza il nome stesso.
fn clean_aliases(list: Vec<String>, name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in list {
        let alias: String = raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
        if alias.is_empty() || alias.eq_ignore_ascii_case(name) || out.iter().any(|o| o.eq_ignore_ascii_case(&alias)) {
            continue;
        }
        out.push(alias);
        if out.len() == 20 {
            break;
        }
    }
    out
}

/// Un nome per confrontarlo con un altro: minuscolo, senza accenti né punteggiatura, con le parole
/// in ordine («Rossi, Elena» e «elena rossi» sono uguali).
fn name_key(name: &str) -> String {
    let plain: String = name
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    let mut words: Vec<&str> = plain.split_whitespace().collect();
    words.sort_unstable();
    words.join(" ")
}

fn rename_quote(line: &str, old: &str, new: &str) -> Option<String> {
    let trimmed = line.trim_end();
    let head = trimmed.strip_suffix(old)?;
    if !head.ends_with(' ') {
        return None;
    }
    let h = head.trim_start_matches([' ', '\t', '>']);
    let after = h.trim_start_matches(':');
    if h.len() - after.len() < 3 {
        return None;
    }
    let minute = after.trim_start().strip_prefix("quote")?.trim();
    if !minute.chars().all(|c| c.is_ascii_digit() || c == ':') {
        return None;
    }
    Some(format!("{head}{new}{}", &line[trimmed.len()..]))
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
        let project = db.save_project("", "Mio", "", "", None).unwrap();
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
        let projects = db.list_projects().unwrap();
        let demo_project = projects.iter().find(|p| p.name == "cliente-nord").unwrap();
        assert!(db.list_meetings(None).unwrap().iter().any(|m| m.project_id.as_deref() == Some(&demo_project.id)));
        // `clienti/cliente-nord`: il progetto sta dentro `clienti`
        let clienti = projects.iter().find(|p| p.name == "clienti").unwrap();
        assert_eq!(demo_project.parent_id.as_deref(), Some(clienti.id.as_str()));

        assert_eq!(db.remove_demo(&data).unwrap(), data.meetings.len());
        assert_eq!(db.demo_count().unwrap(), 0);
        let left = db.list_meetings(None).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, mine.id);
        assert_eq!(db.list_projects().unwrap(), vec![project.clone()]);
        assert_eq!(left[0].project_id, Some(project.id));
        assert_eq!(db.list_people().unwrap().len(), before_people);
        assert!(db.list_groups().unwrap().is_empty());
    }

    #[test]
    fn demo_groups_hold_their_notes_and_leave_with_them() {
        let db = Db::open_in_memory().unwrap();
        let mine = db.save_group("", "Clienti", "", "", None, GroupKind::Audience, &[], &[]).unwrap();
        let data = crate::demo::load(crate::i18n::Lang::It).unwrap();
        db.insert_demo(&data).unwrap();
        let groups = db.list_groups().unwrap();
        let mobile = groups.iter().find(|g| g.name == "Team Mobile").unwrap();
        assert!(mobile.meetings >= 5);
        assert_eq!(mobile.kind, GroupKind::Team);
        let company = groups.iter().find(|g| g.name == "Tutta l'azienda").unwrap();
        assert_eq!(mobile.parent_id.as_deref(), Some(company.id.as_str()));
        // il gruppo «Clienti» dell'utente blocca quello di esempio: Nord finisce in primo livello
        let nord = groups.iter().find(|g| g.name == "Nord").unwrap();
        assert_eq!(nord.parent_id, None);
        assert_eq!(groups.iter().filter(|g| g.name == "Clienti").count(), 1);
        // il nome del gruppo si trova cercando
        assert!(!db.list_meetings(Some("Mobile")).unwrap().is_empty());

        db.remove_demo(&data).unwrap();
        assert_eq!(db.list_groups().unwrap().into_iter().map(|g| g.id).collect::<Vec<_>>(), vec![mine.id]);
        assert!(db.list_people().unwrap().is_empty());
    }

    #[test]
    fn other_names_come_from_merges_and_renames_and_are_recognised() {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("Kickoff", None, &["Elena Rossi".into(), "E. Rossi".into(), "Marco".into()], None).unwrap();
        let people = db.list_people().unwrap();
        let id = |n: &str| people.iter().find(|p| p.name == n).unwrap().id;
        db.merge_people(id("E. Rossi"), id("Elena Rossi")).unwrap();
        db.update_person_details(id("Marco"), "Marco Bianchi", Some("marco@example.ch"), Some("  Direttore   acquisti "), None)
            .unwrap();
        let people = db.list_people().unwrap();
        let get = |n: &str| people.iter().find(|p| p.name == n).unwrap().clone();
        assert_eq!(get("Elena Rossi").aliases, vec!["E. Rossi"]);
        let marco = get("Marco Bianchi");
        assert_eq!((marco.role.as_str(), marco.aliases.clone()), ("Direttore acquisti", vec!["Marco".to_string()]));
        // gli altri nomi si cercano, e un nome scritto così (o la sua email) è la persona in rubrica
        assert_eq!(db.search_people("e. ros", 5).unwrap()[0].name, "Elena Rossi");
        let found = db
            .canonical_people(&[
                ("e. rossi".into(), None),
                ("M. Bianchi".into(), Some("MARCO@example.ch".into())),
                ("Nuova Persona".into(), None),
            ])
            .unwrap();
        let names: Vec<&str> = found.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["Elena Rossi", "Marco Bianchi", "Nuova Persona"]);
        // gli altri nomi si scelgono anche a mano, senza doppioni né il nome stesso
        db.update_person_details(marco.id, "Marco Bianchi", None, None, Some(&["Marco".into(), "marco bianchi".into(), " MB ".into()]))
            .unwrap();
        assert_eq!(db.list_people().unwrap().iter().find(|p| p.id == marco.id).unwrap().aliases, vec!["Marco", "MB"]);
    }

    #[test]
    fn possible_duplicates_by_email_spelling_and_initial() {
        let db = Db::open_in_memory().unwrap();
        db.create_meeting("A", None, &["Elena Rossi".into(), "Luca Ferri".into()], None).unwrap();
        db.create_meeting("B", None, &["Elena Rossi".into()], None).unwrap();
        db.upsert_people(&[
            ("E. Rossi".into(), None),
            ("Ferri, Luca".into(), None),
            ("Anna Villa".into(), Some("anna@example.ch".into())),
            ("Annina".into(), Some("ANNA@example.ch".into())),
            ("Elisa Bruno".into(), None),
        ])
        .unwrap();
        let people = db.list_people().unwrap();
        let name = |id: i64| people.iter().find(|p| p.id == id).unwrap().name.clone();
        let mut pairs: Vec<(String, String, String)> = db
            .possible_duplicates()
            .unwrap()
            .into_iter()
            .map(|d| (name(d.keep), name(d.drop), d.reason))
            .collect();
        pairs.sort();
        assert_eq!(
            pairs,
            vec![
                ("Anna Villa".into(), "Annina".into(), "email".into()),
                ("Elena Rossi".into(), "E. Rossi".into(), "initial".into()),
                ("Luca Ferri".into(), "Ferri, Luca".into(), "name".into()),
            ]
        );
    }

    #[test]
    fn importing_people_creates_nested_groups_and_keeps_what_was_there() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_people(&[("Anna Villa".into(), Some("anna@old.ch".into()))]).unwrap();
        let row = |name: &str, email: Option<&str>, role: &str, groups: &[&str]| ImportedPerson {
            name: name.into(),
            email: email.map(String::from),
            known: false,
            role: role.into(),
            groups: groups.iter().map(|g| g.to_string()).collect(),
        };
        let mut rows = vec![
            row("Anna Villa", Some("anna@new.ch"), "Supporto", &["Azienda/Mobile"]),
            row("Luca Ferri", None, "Sviluppo", &["Azienda › Mobile", "Azienda"]),
        ];
        // un reparto grande nasce come pubblico
        for i in 0..20 {
            rows.push(row(&format!("Persona {i}"), None, "", &["Azienda/Vendite"]));
        }
        db.import_people(&rows).unwrap();
        let people = db.list_people().unwrap();
        let anna = people.iter().find(|p| p.name == "Anna Villa").unwrap();
        // chi c'era tiene la sua email, e prende il ruolo che non aveva
        assert_eq!((anna.email.as_deref(), anna.role.as_str()), (Some("anna@old.ch"), "Supporto"));
        let groups = db.list_groups().unwrap();
        let g = |n: &str| groups.iter().find(|g| g.name == n).unwrap().clone();
        let (azienda, mobile, vendite) = (g("Azienda"), g("Mobile"), g("Vendite"));
        assert_eq!(groups.len(), 3);
        assert_eq!(mobile.parent_id.as_deref(), Some(azienda.id.as_str()));
        assert_eq!(mobile.members, vec!["Anna Villa", "Luca Ferri"]);
        assert_eq!(azienda.members, vec!["Luca Ferri"]);
        assert_eq!((mobile.kind, vendite.kind), (GroupKind::Team, GroupKind::Audience));
        // un secondo import non raddoppia niente
        db.import_people(&rows).unwrap();
        assert_eq!(db.list_groups().unwrap().iter().find(|x| x.name == "Mobile").unwrap().members.len(), 2);

        // ai modelli arrivano nome, tipo e dimensione del gruppo, non i membri
        let m = db.create_meeting("All-hands", None, &[], None).unwrap();
        db.set_meeting_groups(&m.id, &[vendite.id.clone(), mobile.id.clone()]).unwrap();
        let m = db.with_groups(db.get_meeting(&m.id).unwrap().unwrap()).unwrap();
        assert_eq!(m.groups_brief, vec!["Vendite (pubblico, 20 persone)", "Mobile (team, 2 persone)"]);
    }

    #[test]
    fn groups_nest_hold_members_and_follow_people() {
        let db = Db::open_in_memory().unwrap();
        let company = db.save_group("", "Azienda", "", "", None, GroupKind::Audience, &[], &[]).unwrap();
        let team = db
            .save_group("", "Mobile", "teal", "App", Some(&company.id), GroupKind::Team, &["Anna".into(), "Luca".into()], &[])
            .unwrap();
        assert_eq!(team.members, vec!["Anna", "Luca"]);
        // i membri entrano in rubrica
        assert_eq!(db.list_people().unwrap().len(), 2);
        // nomi unici, niente giri
        assert!(db.save_group("", "mobile", "", "", None, GroupKind::Team, &[], &[]).is_err());
        assert!(db.save_group(&company.id, "Azienda", "", "", Some(&team.id), GroupKind::Audience, &[], &[]).is_err());

        let m = db.create_meeting("Standup", None, &["Anna".into()], None).unwrap();
        db.set_meeting_groups(&m.id, &[team.id.clone(), "nessuno".into(), team.id.clone()]).unwrap();
        assert_eq!(db.get_meeting(&m.id).unwrap().unwrap().group_ids, vec![team.id.clone()]);
        assert_eq!(db.list_groups().unwrap().iter().find(|g| g.id == team.id).unwrap().meetings, 1);
        // il nome del gruppo è nell'indice, anche dopo averlo cambiato
        db.save_group(&team.id, "Squadra app", "teal", "App", Some(&company.id), GroupKind::Team, &team.members, &[])
            .unwrap();
        assert_eq!(db.list_meetings(Some("Squadra")).unwrap().len(), 1);
        assert!(db.list_meetings(Some("Mobile")).unwrap().is_empty());

        // membri aggiunti e tolti, senza doppioni
        let g = db.change_group_members(&team.id, &["Sara".into(), "anna".into()], &["Luca".into()]).unwrap();
        assert_eq!(g.members, vec!["Anna", "Sara"]);

        // rinominare, unire ed eliminare una persona arriva anche ai gruppi
        let people = db.list_people().unwrap();
        let id = |n: &str| people.iter().find(|p| p.name == n).unwrap().id;
        db.update_person(id("Anna"), "Anna Villa", None).unwrap();
        db.merge_people(id("Sara"), id("Anna")).unwrap();
        let members = |db: &Db| db.list_groups().unwrap().into_iter().find(|g| g.id == team.id).unwrap().members;
        assert_eq!(members(&db), vec!["Anna Villa"]);
        db.delete_person(id("Anna")).unwrap();
        assert!(members(&db).is_empty());

        // eliminato un gruppo, quelli dentro salgono e le note lo perdono
        db.delete_group(&company.id).unwrap();
        assert_eq!(db.list_groups().unwrap()[0].parent_id, None);
        db.delete_group(&team.id).unwrap();
        assert!(db.get_meeting(&m.id).unwrap().unwrap().group_ids.is_empty());
        assert!(db.list_meetings(Some("Squadra")).unwrap().is_empty());
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
        let nord = db.save_project("", "Cliente Nord", "blue", "Rinnovo del contratto", None).unwrap();
        let app = db.save_project("", "App mobile", "", "", None).unwrap();
        assert_eq!((nord.color.as_str(), nord.description.as_str(), nord.archived), ("blue", "Rinnovo del contratto", false));
        // in ordine alfabetico
        let names: Vec<String> = db.list_projects().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["App mobile", "Cliente Nord"]);
        // due progetti non possono avere lo stesso nome, nemmeno con altre maiuscole
        assert!(db.save_project("", "cliente nord", "", "", None).is_err());
        assert!(db.save_project(&app.id, "Cliente Nord", "", "", None).is_err());

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
        let renamed = db.save_project(&nord.id, "Cliente Sud", "blue", "", None).unwrap();
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
    fn projects_sit_inside_other_projects() {
        let db = Db::open_in_memory().unwrap();
        let dambox = db.save_project("", "dambox", "", "", None).unwrap();
        let bizcard = db.save_project("", "bizcard", "", "", Some(&dambox.id)).unwrap();
        let cards = db.save_project("", "Tessere", "", "", Some(&bizcard.id)).unwrap();
        assert_eq!(bizcard.parent_id.as_deref(), Some(dambox.id.as_str()));
        // né dentro sé stesso né dentro un suo sotto-progetto, né dentro uno che non c'è
        assert!(db.save_project(&dambox.id, "dambox", "", "", Some(&dambox.id)).is_err());
        assert!(db.save_project(&dambox.id, "dambox", "", "", Some(&cards.id)).is_err());
        assert!(db.save_project("", "Altro", "", "", Some("nessuno")).is_err());

        // cercando il progetto sopra si trovano le note di quelli sotto, anche dopo un nuovo nome
        let m = db.create_meeting("Demo", None, &[], None).unwrap();
        db.set_meetings_project(std::slice::from_ref(&m.id), Some(&cards.id)).unwrap();
        assert_eq!(db.list_meetings(Some("dambox")).unwrap().len(), 1);
        db.save_project(&dambox.id, "Studio", "", "", None).unwrap();
        assert_eq!(db.list_meetings(Some("dambox")).unwrap().len(), 0);
        assert_eq!(db.list_meetings(Some("studio")).unwrap().len(), 1);

        // eliminando bizcard, Tessere sale sotto Studio e la nota resta dov'era
        db.delete_project(&bizcard.id).unwrap();
        let parent = |id: &str| db.list_projects().unwrap().into_iter().find(|p| p.id == id).unwrap().parent_id;
        assert_eq!(parent(&cards.id), Some(dambox.id.clone()));
        assert_eq!(db.get_meeting(&m.id).unwrap().unwrap().project_id, Some(cards.id.clone()));
        assert_eq!(db.list_meetings(Some("bizcard")).unwrap().len(), 0);
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
    fn notes_get_a_modified_time_on_migration_and_only_real_changes_move_it() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // un database com'era prima dell'ora di modifica: fino allo schema 10
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..10] {
                conn.execute_batch(schema).unwrap();
            }
            conn.pragma_update(None, "user_version", 10).unwrap();
            conn.execute_batch(
                "INSERT INTO meetings (id, title, created_at, ended_at) VALUES ('finito', 'Finito', 100, 500);
                 INSERT INTO meetings (id, title, created_at) VALUES ('aperto', 'Aperto', 200);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let updated = |id: &str| db.list_meetings(None).unwrap().into_iter().find(|m| m.id == id).unwrap().updated_at;
        // per le note che c'erano già vale la fine del meeting, o la creazione
        assert_eq!(updated("finito"), 500);
        assert_eq!(updated("aperto"), 200);
        // salvare lo stesso testo non la sposta, cambiarlo sì
        db.update_meeting("aperto", Some("Aperto"), None, None, None).unwrap();
        assert_eq!(updated("aperto"), 200);
        db.update_meeting("aperto", None, Some("nuove note"), None, None).unwrap();
        assert!(updated("aperto") > 1_000_000);
        // i tag dati a più meeting insieme non spostano le note
        db.tag_meetings(&["finito".to_string()], &["x".to_string()], &[]).unwrap();
        assert_eq!(updated("finito"), 500);
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
        assert_eq!(db.save_project("p", "Lancio", "teal", "Primavera", None).unwrap().color, "teal");
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
    fn renaming_a_person_reaches_meetings_notes_and_quotes() {
        let db = Db::open_in_memory().unwrap();
        let m = db.create_meeting("Kickoff", None, &["Marco".into(), "Elena Rossi".into()], None).unwrap();
        db.update_meeting(
            &m.id,
            None,
            Some("- [ ] @[Marco]: preventivo\n> ::: quote 11:48 Marco\n> Il prezzo conta.\n> :::\n::: quote Marco\nSì.\n:::\nMarcolino resta, e anche @[Marco Polo]"),
            Some("Decide @[Marco]."),
            None,
        )
        .unwrap();
        let marco = db.list_people().unwrap().into_iter().find(|p| p.name == "Marco").unwrap();
        assert_eq!(marco.meetings, 1);
        assert!(marco.last_meeting_at.is_some());

        db.update_person(marco.id, " Marco Bianchi ", Some("marco@example.ch")).unwrap();
        let got = db.get_meeting(&m.id).unwrap().unwrap();
        assert_eq!(got.attendees, vec!["Marco Bianchi", "Elena Rossi"]);
        assert!(got.notes_md.contains("- [ ] @[Marco Bianchi]: preventivo"));
        assert!(got.notes_md.contains("> ::: quote 11:48 Marco Bianchi\n"));
        assert!(got.notes_md.contains("::: quote Marco Bianchi\n"));
        assert!(got.notes_md.contains("Marcolino resta, e anche @[Marco Polo]"), "solo il nome intero");
        assert_eq!(got.enhanced_md.as_deref(), Some("Decide @[Marco Bianchi]."));
        let people = db.list_people().unwrap();
        let renamed = people.iter().find(|p| p.id == marco.id).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.email.as_deref()), ("Marco Bianchi", Some("marco@example.ch")));
        assert_eq!(db.list_meetings(Some("bianchi")).unwrap().len(), 1, "reindicizzato");

        // un nome già in rubrica non si prende: si unisce
        assert!(db.update_person(marco.id, "elena rossi", None).is_err());
        assert!(db.update_person(marco.id, "  ", None).is_err());
        // cambiare solo l'email non tocca i meeting
        db.update_person(marco.id, "Marco Bianchi", None).unwrap();
        assert_eq!(db.list_people().unwrap().iter().find(|p| p.id == marco.id).unwrap().email, None);
    }

    #[test]
    fn merging_two_people_keeps_one_without_duplicates() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_meeting("Uno", None, &["Marco".into(), "Marco Bianchi".into()], None).unwrap();
        let b = db.create_meeting("Due", None, &["Marco".into()], None).unwrap();
        db.update_meeting(&b.id, None, Some("@[Marco] chiama"), None, None).unwrap();
        db.upsert_people(&[("Marco".into(), Some("m@example.ch".into()))]).unwrap();
        let people = db.list_people().unwrap();
        let id = |n: &str| people.iter().find(|p| p.name == n).unwrap().id;
        assert!(db.merge_people(id("Marco"), id("Marco")).is_err());
        db.merge_people(id("Marco"), id("Marco Bianchi")).unwrap();

        assert_eq!(db.get_meeting(&a.id).unwrap().unwrap().attendees, vec!["Marco Bianchi"]);
        let b = db.get_meeting(&b.id).unwrap().unwrap();
        assert_eq!((b.attendees, b.notes_md), (vec!["Marco Bianchi".to_string()], "@[Marco Bianchi] chiama".to_string()));
        let people = db.list_people().unwrap();
        assert_eq!(people.len(), 1);
        assert_eq!((people[0].meetings, people[0].email.as_deref()), (2, Some("m@example.ch")));
    }

    #[test]
    fn missing_emails_are_filled_but_never_overwritten() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_people(&[("Anna".into(), None), ("Luca".into(), Some("luca@example.ch".into()))]).unwrap();
        let missing = db.people_without_email().unwrap();
        assert_eq!(missing.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>(), vec!["Anna"]);
        assert!(db.fill_person_email(missing[0].0, "anna@example.ch").unwrap());
        assert!(!db.fill_person_email(missing[0].0, "altra@example.ch").unwrap());
        assert_eq!(db.person_email("Anna").unwrap().as_deref(), Some("anna@example.ch"));
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
    fn renaming_a_note_updates_links_to_it() {
        let db = Db::open_in_memory().unwrap();
        let target = db.create_meeting("Piano [Q1]", None, &[], None).unwrap();
        let other = db.create_meeting("Altra", None, &[], None).unwrap();
        db.update_meeting(&other.id, None, Some("Vedi [[Piano (Q1)]] e [[Piano (Q1)|il piano]], non [[Piano]]"), None, None).unwrap();
        let before = db.get_meeting(&other.id).unwrap().unwrap().updated_at;
        db.update_meeting(&target.id, Some("Piano 2027"), None, None, None).unwrap();
        let other = db.get_meeting(&other.id).unwrap().unwrap();
        assert_eq!(other.notes_md, "Vedi [[Piano 2027]] e [[Piano 2027|il piano]], non [[Piano]]");
        assert_eq!(other.updated_at, before);
        assert_eq!(db.list_meetings(Some("2027")).unwrap().len(), 2);
    }

    #[test]
    fn repairs_an_import_table_from_a_development_build() {
        let dir = std::env::temp_dir().join(format!("granello-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("db.sqlite");
        {
            // la migrazione 12 come l'aveva una build di sviluppo: senza `people`
            let conn = Connection::open(&path).unwrap();
            for schema in &MIGRATIONS[..11] {
                conn.execute_batch(schema).unwrap();
            }
            conn.execute_batch(&SCHEMA_V12.replace("    people TEXT NOT NULL DEFAULT '[]',\n", "")).unwrap();
            conn.pragma_update(None, "user_version", 12).unwrap();
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM pragma_table_info('imports') WHERE name = 'people'", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "la prova parte da una tabella senza la colonna");
        }
        let db = Db::open(&path).unwrap();
        let rec = db.save_import("obsidian", "/vault", &[], &[], Privacy::Open, &serde_json::json!({})).unwrap();
        assert!(db.undo_import(&rec.id).is_ok());
        drop(db);
        // una seconda apertura non tocca niente
        Db::open(&path).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn saves_and_undoes_an_import() {
        let db = Db::open_in_memory().unwrap();
        let existing = db.save_project("", "Lavoro", "blue", "", None).unwrap();
        let note = |title: &str, project: &[&str], path: &str| NewNote {
            title: title.into(),
            notes_md: format!("{title} con ![](attachments/{path}.png)"),
            tags: vec!["obsidian".into()],
            attendees: vec!["Giulia Ferri".into()],
            project: project.iter().map(|p| p.to_string()).collect(),
            archived_project: false,
            created_at: 1_000,
            updated_at: 2_000,
            source_path: format!("{path}.md"),
            source_hash: "h".into(),
        };
        let notes = [note("Acme", &["lavoro"], "a"), note("Diario", &["Personale", "2024"], "b"), note("Sciolta", &[], "c")];
        let files = [NewFile {
            path: "attachments/x.pdf".into(),
            name: "vecchio.pdf".into(),
            bytes: 10,
            folder: "Archivio".into(),
            created_at: 500,
            source_path: "Archivio/vecchio.pdf".into(),
        }];
        let rec = db.save_import("obsidian", "/vault", &notes, &files, Privacy::Audio, &serde_json::json!({"skipped": []})).unwrap();
        assert_eq!((rec.notes, rec.files, rec.root.as_str()), (3, 1, "/vault"));

        let list = db.list_meetings(None).unwrap();
        let acme = list.iter().find(|m| m.title == "Acme").unwrap();
        assert_eq!(acme.project_id.as_deref(), Some(existing.id.as_str()), "il progetto con lo stesso nome si riusa");
        assert_eq!((acme.created_at, acme.updated_at), (1_000, 2_000));
        let full = db.get_meeting(&acme.id).unwrap().unwrap();
        assert_eq!(full.privacy, Privacy::Audio);
        assert_eq!(full.attendees, ["Giulia Ferri"]);
        assert_eq!(db.search_people("Giulia", 5).unwrap().len(), 1);
        let projects = db.list_projects().unwrap();
        assert_eq!(projects.len(), 3, "Personale e 2024 sono nuovi");
        let id = |name: &str| projects.iter().find(|p| p.name == name).unwrap();
        assert_eq!(id("2024").parent_id.as_deref(), Some(id("Personale").id.as_str()), "2024 sta dentro Personale");
        let diario = list.iter().find(|m| m.title == "Diario").unwrap();
        assert_eq!(diario.project_id.as_deref(), Some(id("2024").id.as_str()));
        assert_eq!(db.list_meetings(Some("Diario")).unwrap().len(), 1, "le note importate si cercano");
        assert_eq!(db.loose_files().unwrap()[0].name, "vecchio.pdf");
        assert!(db.attachment_in_use("attachments/x.pdf").unwrap(), "un file senza nota resta in uso");
        let already = db.already_imported("/vault").unwrap();
        assert_eq!(already.len(), 4);
        assert_eq!(already["a.md"], "h");
        assert!(db.already_imported("/altro").unwrap().is_empty());
        assert_eq!(db.notes_for_files().unwrap().len(), 3);

        // una nota eliminata a mano si può importare di nuovo
        db.delete_meeting(&acme.id).unwrap();
        assert!(!db.already_imported("/vault").unwrap().contains_key("a.md"));

        let (texts, paths) = db.undo_import(&rec.id).unwrap();
        assert_eq!((texts.len(), paths), (2, vec!["attachments/x.pdf".to_string()]));
        assert!(db.list_meetings(None).unwrap().is_empty());
        assert!(db.loose_files().unwrap().is_empty() && db.list_imports().unwrap().is_empty());
        let names: Vec<String> = db.list_projects().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["Lavoro"], "via solo il progetto creato dall'import");
        assert!(db.search_people("Giulia", 5).unwrap().is_empty(), "via la persona arrivata con l'import");
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
