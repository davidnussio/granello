//! Sync tra dispositivi, fase 0: un vault si sincronizza attraverso una cartella (per esempio
//! in iCloud Drive) senza server. Solo nelle build di sviluppo: la cartella contiene note e
//! trascrizioni in chiaro, finché non c'è la cifratura (vedi TODO.md).
//!
//! Il database di un SQLite non si sincronizza come file, quindi viaggiano le modifiche:
//!
//! - dei trigger annotano in `sync_outbox` quale campo di quale riga è cambiato (meeting,
//!   segmenti della trascrizione, progetti, persone);
//! - ogni tanto le annotazioni diventano operazioni con un orologio logico ibrido, scritte in
//!   un file nuovo e immutabile in `log/<dispositivo>/` (mai allungato: il servizio di sync
//!   potrebbe caricarlo a metà);
//! - i file degli altri dispositivi si leggono in ordine, si uniscono per orologio e si
//!   applicano: per ogni campo vince la modifica più recente. Per note e note AI una modifica
//!   concorrente non si perde: la versione rimasta indietro va in `sync_conflicts`.
//!
//! I meeting blindati non escono mai dal Mac, e un vault blindato non si sincronizza.

use crate::commands::{err, AppState, CmdResult};
use crate::db::Db;
use crate::i18n::tr;
use crate::models::Privacy;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Una tabella che si sincronizza.
struct Entity {
    name: &'static str,
    table: &'static str,
    /// La colonna che identifica una riga su ogni dispositivo.
    key: &'static str,
    /// Le colonne che viaggiano.
    fields: &'static [&'static str],
    /// Le colonne la cui modifica diventa un'operazione (le altre viaggiano solo con la riga nuova).
    tracked: &'static [&'static str],
}

const MEETING_FIELDS: &[&str] = &[
    "title",
    "created_at",
    "started_at",
    "ended_at",
    "calendar_event_id",
    "attendees",
    "template_id",
    "notes_md",
    "enhanced_md",
    "tags",
    "privacy",
    "project_id",
    "pinned_at",
];

const ENTITIES: &[Entity] = &[
    Entity {
        name: "project",
        table: "projects",
        key: "id",
        fields: &["name", "color", "description", "archived", "created_at"],
        tracked: &["name", "color", "description", "archived"],
    },
    Entity {
        name: "person",
        table: "people",
        key: "name",
        fields: &["email", "created_at", "last_used_at"],
        tracked: &["email"],
    },
    Entity { name: "meeting", table: "meetings", key: "id", fields: MEETING_FIELDS, tracked: MEETING_FIELDS },
    Entity {
        name: "segment",
        table: "transcript_segments",
        key: "uid",
        fields: &["meeting_id", "source", "start_ms", "end_ms", "text", "review"],
        tracked: &["source", "start_ms", "end_ms", "text", "review"],
    },
];

/// Testi lunghi scritti a mano: una modifica concorrente si tiene da parte invece di perderla.
const KEPT: &[&str] = &["notes_md", "enhanced_md"];

/// Il file che dice quale vault si sincronizza in una cartella.
const MARKER: &str = "granello-sync.json";
/// Ogni quanto il sync gira da solo.
const EVERY: Duration = Duration::from_secs(10);

fn entity(name: &str) -> Option<&'static Entity> {
    ENTITIES.iter().find(|e| e.name == name)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Crea (o ricrea, se le colonne sono cambiate) i trigger che annotano le modifiche. Scrivono
/// solo con il sync attivo e mai mentre si applicano le modifiche di un altro dispositivo.
pub fn install(conn: &Connection) -> Result<()> {
    let on = "(SELECT value FROM sync_state WHERE key = 'record') = '1'";
    let mut sql = String::new();
    for e in ENTITIES {
        let (n, t, k) = (e.name, e.table, e.key);
        let changed: String = e
            .tracked
            .iter()
            .map(|f| {
                format!(
                    "INSERT OR IGNORE INTO sync_outbox (entity, key, field) SELECT '{n}', NEW.{k}, '{f}' WHERE OLD.{f} IS NOT NEW.{f};"
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        sql += &format!(
            "DROP TRIGGER IF EXISTS sync_{n}_ins; DROP TRIGGER IF EXISTS sync_{n}_upd; DROP TRIGGER IF EXISTS sync_{n}_del;
             CREATE TRIGGER sync_{n}_ins AFTER INSERT ON {t} WHEN {on} BEGIN
               INSERT OR IGNORE INTO sync_outbox (entity, key, field) VALUES ('{n}', NEW.{k}, '*');
             END;
             CREATE TRIGGER sync_{n}_upd AFTER UPDATE ON {t} WHEN {on} BEGIN {changed} END;
             CREATE TRIGGER sync_{n}_del AFTER DELETE ON {t} WHEN {on} BEGIN
               DELETE FROM sync_outbox WHERE entity = '{n}' AND key = OLD.{k};
               INSERT INTO sync_outbox (entity, key, field) VALUES ('{n}', OLD.{k}, '-');
             END;
            "
        );
    }
    conn.execute_batch(&sql)?;
    Ok(())
}

// ---------- stato e orologi ----------

fn state_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM sync_state WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn state_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn clock_get(conn: &Connection, e: &str, key: &str, field: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT hlc FROM sync_clock WHERE entity = ?1 AND key = ?2 AND field = ?3",
            params![e, key, field],
            |r| r.get(0),
        )
        .optional()?)
}

fn clock_set(conn: &Connection, e: &str, key: &str, field: &str, hlc: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_clock (entity, key, field, hlc) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(entity, key, field) DO UPDATE SET hlc = excluded.hlc",
        params![e, key, field, hlc],
    )?;
    Ok(())
}

fn clock_forget(conn: &Connection, e: &str, key: &str, field: Option<&str>) -> Result<()> {
    match field {
        Some(f) => conn.execute(
            "DELETE FROM sync_clock WHERE entity = ?1 AND key = ?2 AND field = ?3",
            params![e, key, f],
        )?,
        None => conn.execute("DELETE FROM sync_clock WHERE entity = ?1 AND key = ?2", params![e, key])?,
    };
    Ok(())
}

/// Orologio logico ibrido: il tempo del Mac, più un contatore per le modifiche nello stesso
/// millisecondo, più il dispositivo. Come testo si ordina come l'orologio.
struct Clock {
    ms: i64,
    n: u32,
    device: String,
}

fn parse_hlc(s: &str) -> Option<(i64, u32)> {
    let mut parts = s.split('.');
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

impl Clock {
    fn load(conn: &Connection, device: &str) -> Result<Clock> {
        let (ms, n) = state_get(conn, "clock")?.as_deref().and_then(parse_hlc).unwrap_or((0, 0));
        Ok(Clock { ms, n, device: device.into() })
    }

    fn save(&self, conn: &Connection) -> Result<()> {
        state_set(conn, "clock", &format!("{}.{}", self.ms, self.n))
    }

    fn tick(&mut self) -> String {
        let now = now_ms();
        if now > self.ms {
            self.ms = now;
            self.n = 0;
        } else {
            self.n += 1;
        }
        format!("{:013}.{:05}.{}", self.ms, self.n, self.device)
    }

    /// Un orologio visto in una modifica di un altro dispositivo: il prossimo sarà dopo.
    fn observe(&mut self, hlc: &str) {
        if let Some(seen) = parse_hlc(hlc) {
            if seen > (self.ms, self.n) {
                (self.ms, self.n) = seen;
            }
        }
    }
}

// ---------- operazioni ----------

/// Una modifica come viaggia nel log.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Op {
    hlc: String,
    e: String,
    k: String,
    /// La riga è nuova (o rinata): ci sono tutte le colonne.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    new: bool,
    /// La riga è stata cancellata.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    del: bool,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    f: Map<String, Value>,
    /// Per note e note AI: l'orologio della versione da cui partiva la modifica.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    base: Map<String, Value>,
}

/// I file letti da un dispositivo: numero dell'ultimo, operazioni in ordine.
struct Batch {
    device: String,
    seq: u64,
    ops: Vec<Op>,
}

fn read_row(conn: &Connection, e: &Entity, key: &str) -> Result<Option<Map<String, Value>>> {
    let cols = e.fields.iter().map(|f| format!("'{f}', {f}")).collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT json_object({cols}) FROM {} WHERE {} = ?1", e.table, e.key);
    let raw: Option<String> = conn.query_row(&sql, [key], |r| r.get(0)).optional()?;
    Ok(match raw {
        Some(raw) => Some(serde_json::from_str(&raw)?),
        None => None,
    })
}

fn sql_value(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(V::Integer).unwrap_or_else(|| V::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

/// I meeting blindati, e i loro segmenti, non escono dal Mac.
fn shareable(conn: &Connection, e: &Entity, row: &Map<String, Value>) -> Result<bool> {
    let hardened = Value::String(Privacy::Hardened.as_str().into());
    Ok(match e.name {
        "meeting" => row.get("privacy") != Some(&hardened),
        "segment" => {
            let meeting = row.get("meeting_id").and_then(Value::as_str).unwrap_or_default();
            let privacy: Option<String> = conn
                .query_row("SELECT privacy FROM meetings WHERE id = ?1", [meeting], |r| r.get(0))
                .optional()?;
            privacy.is_some_and(|p| p != Privacy::Hardened.as_str())
        }
        _ => true,
    })
}

/// Le modifiche annotate diventano un file nuovo nel log di questo dispositivo. Ritorna
/// quante operazioni ha scritto. Se il file non si scrive, le annotazioni restano.
fn flush(conn: &Connection, device: &str, dir: &Path) -> Result<usize> {
    let pending: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT entity, key, group_concat(field, ',') FROM sync_outbox GROUP BY entity, key ORDER BY entity, key",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if pending.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut clock = Clock::load(conn, device)?;
    let mut ops = Vec::new();
    // prima i progetti, poi le persone, i meeting e i segmenti: chi li legge li trova in ordine
    let order = |name: &str| ENTITIES.iter().position(|e| e.name == name).unwrap_or(usize::MAX);
    let mut pending = pending;
    pending.sort_by_key(|(e, _, _)| order(e));
    for (name, key, fields) in pending {
        let Some(e) = entity(&name) else { continue };
        let fields: HashSet<&str> = fields.split(',').collect();
        match read_row(conn, e, &key)? {
            None => {
                let hlc = clock.tick();
                clock_forget(conn, e.name, &key, None)?;
                clock_set(conn, e.name, &key, "-", &hlc)?;
                ops.push(Op { hlc, e: name, k: key, del: true, ..Default::default() });
            }
            Some(row) => {
                if !shareable(conn, e, &row)? {
                    continue;
                }
                let new = fields.contains("*") || fields.contains("-");
                let hlc = clock.tick();
                let mut op = Op { hlc: hlc.clone(), e: name, k: key, new, ..Default::default() };
                for f in e.fields.iter().filter(|f| new || fields.contains(**f)) {
                    if KEPT.contains(f) {
                        let base = clock_get(conn, e.name, &op.k, f)?;
                        op.base.insert((*f).into(), base.map(Value::String).unwrap_or(Value::Null));
                    }
                    op.f.insert((*f).into(), row.get(*f).cloned().unwrap_or(Value::Null));
                    clock_set(conn, e.name, &op.k, f, &hlc)?;
                }
                if new {
                    clock_forget(conn, e.name, &op.k, Some("-"))?;
                }
                if !op.f.is_empty() {
                    ops.push(op);
                }
            }
        }
    }
    conn.execute("DELETE FROM sync_outbox", [])?;
    clock.save(conn)?;
    if !ops.is_empty() {
        let seq = state_get(conn, "seq")?.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0) + 1;
        write_log(dir, device, seq, &ops)?;
        state_set(conn, "seq", &seq.to_string())?;
    }
    tx.commit()?;
    Ok(ops.len())
}

fn write_log(dir: &Path, device: &str, seq: u64, ops: &[Op]) -> Result<()> {
    let folder = dir.join("log").join(device);
    std::fs::create_dir_all(&folder)?;
    let mut text = String::new();
    for op in ops {
        text += &serde_json::to_string(op)?;
        text.push('\n');
    }
    // nome temporaneo e poi il nome vero: chi legge non vede mai un file a metà
    let tmp = folder.join(format!(".{seq:010}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, folder.join(format!("{seq:010}.jsonl")))?;
    Ok(())
}

fn cursors(conn: &Connection) -> Result<HashMap<String, u64>> {
    let mut stmt = conn.prepare("SELECT key, value FROM sync_state WHERE key LIKE 'cursor:%'")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        out.insert(key.trim_start_matches("cursor:").to_string(), value.parse().unwrap_or(0));
    }
    Ok(out)
}

/// I file degli altri dispositivi non ancora letti, senza buchi: se ne manca uno (non ancora
/// arrivato dal servizio di sync) ci si ferma lì e si riprova al giro dopo.
fn read_logs(dir: &Path, device: &str, cursors: &HashMap<String, u64>) -> Result<Vec<Batch>> {
    let root = dir.join("log");
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == device || name.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        let mut seqs: Vec<u64> = std::fs::read_dir(entry.path())?
            .filter_map(|f| f.ok()?.file_name().to_str()?.strip_suffix(".jsonl")?.parse().ok())
            .collect();
        seqs.sort_unstable();
        let first = cursors.get(&name).copied().unwrap_or(0) + 1;
        for (next, seq) in (first..).zip(seqs.into_iter().filter(|s| *s >= first)) {
            if seq != next {
                break;
            }
            let text = std::fs::read_to_string(entry.path().join(format!("{seq:010}.jsonl")))?;
            let ops: Result<Vec<Op>, _> =
                text.lines().filter(|l| !l.trim().is_empty()).map(serde_json::from_str).collect();
            match ops {
                Ok(ops) => out.push(Batch { device: name.clone(), seq, ops }),
                Err(e) => {
                    log::warn!("sync: un file del log non si legge, riprovo più tardi: {e}");
                    break;
                }
            }
        }
    }
    Ok(out)
}

/// Applica le modifiche degli altri dispositivi, unite in ordine di orologio. Ritorna i
/// meeting toccati, da ricaricare nell'interfaccia.
fn apply(db: &Db, device: &str, batches: Vec<Batch>) -> Result<Vec<String>> {
    if batches.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.conn();
    let tx = conn.unchecked_transaction()?;
    let record = state_get(conn, "record")?.unwrap_or_else(|| "0".into());
    // le modifiche ricevute non tornano nel log
    state_set(conn, "record", "0")?;
    let mut clock = Clock::load(conn, device)?;
    let mut ops: Vec<&Op> = batches.iter().flat_map(|b| &b.ops).collect();
    ops.sort_by(|a, b| a.hlc.cmp(&b.hlc));
    let mut touched = HashSet::new();
    for op in ops {
        clock.observe(&op.hlc);
        if let Err(e) = apply_op(db, op, &mut touched) {
            log::warn!("sync: una modifica di tipo {} non si applica: {e}", op.e);
        }
    }
    for b in &batches {
        state_set(conn, &format!("cursor:{}", b.device), &b.seq.to_string())?;
    }
    clock.save(conn)?;
    state_set(conn, "record", &record)?;
    for id in &touched {
        db.reindex(id)?;
    }
    tx.commit()?;
    let mut touched: Vec<String> = touched.into_iter().collect();
    touched.sort();
    Ok(touched)
}

/// I meeting di un progetto, o quello di un segmento: cambiano anche loro nella ricerca.
fn meetings_of(conn: &Connection, e: &Entity, key: &str) -> Result<Vec<String>> {
    let sql = match e.name {
        "meeting" => return Ok(vec![key.to_string()]),
        "segment" => "SELECT meeting_id FROM transcript_segments WHERE uid = ?1",
        "project" => "SELECT id FROM meetings WHERE project_id = ?1",
        _ => return Ok(Vec::new()),
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([key], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn apply_op(db: &Db, op: &Op, touched: &mut HashSet<String>) -> Result<()> {
    let conn = db.conn();
    // un tipo che questa versione non conosce: viene da una versione più nuova
    let Some(e) = entity(&op.e) else { return Ok(()) };
    let tomb = clock_get(conn, e.name, &op.k, "-")?;
    if tomb.as_deref().is_some_and(|t| t >= op.hlc.as_str()) {
        return Ok(());
    }
    if op.del {
        touched.extend(meetings_of(conn, e, &op.k)?);
        if e.name == "meeting" {
            db.delete_meeting_rows(&op.k)?;
        } else {
            conn.execute(&format!("DELETE FROM {} WHERE {} = ?1", e.table, e.key), [&op.k])?;
        }
        clock_forget(conn, e.name, &op.k, None)?;
        clock_set(conn, e.name, &op.k, "-", &op.hlc)?;
        return Ok(());
    }

    let mut fields: Map<String, Value> =
        op.f.iter().filter(|(f, _)| e.fields.contains(&f.as_str())).map(|(f, v)| (f.clone(), v.clone())).collect();
    match read_row(conn, e, &op.k)? {
        None => {
            // una modifica di una riga che qui non c'è (cancellata, o di cui manca l'inizio)
            if !op.new {
                return Ok(());
            }
            if e.name == "segment" {
                let meeting = fields.get("meeting_id").and_then(Value::as_str).unwrap_or_default();
                let exists: bool =
                    conn.query_row("SELECT EXISTS(SELECT 1 FROM meetings WHERE id = ?1)", [meeting], |r| r.get(0))?;
                if !exists {
                    return Ok(());
                }
            }
            for (f, v) in fields.iter_mut() {
                *v = fit(db, e, &op.k, f, v.clone(), touched)?;
            }
            let cols: Vec<&str> = std::iter::once(e.key).chain(fields.keys().map(String::as_str)).collect();
            let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            let mut values = vec![rusqlite::types::Value::Text(op.k.clone())];
            values.extend(fields.values().map(sql_value));
            conn.execute(
                &format!("INSERT INTO {} ({}) VALUES ({marks})", e.table, cols.join(", ")),
                rusqlite::params_from_iter(values),
            )?;
            for f in fields.keys() {
                clock_set(conn, e.name, &op.k, f, &op.hlc)?;
            }
            clock_forget(conn, e.name, &op.k, Some("-"))?;
        }
        Some(current) => {
            for (f, value) in fields {
                let local = clock_get(conn, e.name, &op.k, &f)?;
                if local.as_deref() == Some(op.hlc.as_str()) {
                    continue; // già applicata
                }
                let remote_wins = local.as_deref().is_none_or(|l| op.hlc.as_str() > l);
                if e.name == "meeting" && KEPT.contains(&f.as_str()) {
                    let base = op.base.get(&f).and_then(Value::as_str);
                    let concurrent = local.is_some() && local.as_deref() != base;
                    if concurrent && current.get(&f) != Some(&value) {
                        // la versione che resta indietro si tiene da parte
                        let (lost, hlc) = if remote_wins {
                            (current.get(&f), local.clone().unwrap_or_default())
                        } else {
                            (Some(&value), op.hlc.clone())
                        };
                        if let Some(Value::String(text)) = lost {
                            if !text.trim().is_empty() {
                                conn.execute(
                                    "INSERT INTO sync_conflicts (meeting_id, field, value, hlc, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                                    params![op.k, f, text, hlc, now_ms()],
                                )?;
                            }
                        }
                    }
                }
                if !remote_wins {
                    continue;
                }
                let value = fit(db, e, &op.k, &f, value, touched)?;
                conn.execute(
                    &format!("UPDATE {} SET {f} = ?1 WHERE {} = ?2", e.table, e.key),
                    params![sql_value(&value), op.k],
                )?;
                clock_set(conn, e.name, &op.k, &f, &op.hlc)?;
            }
        }
    }
    touched.extend(meetings_of(conn, e, &op.k)?);
    Ok(())
}

/// Adatta un valore ricevuto ai vincoli del database: un progetto che qui non c'è più, o un
/// nome di progetto già preso.
fn fit(db: &Db, e: &Entity, key: &str, field: &str, value: Value, touched: &mut HashSet<String>) -> Result<Value> {
    let conn = db.conn();
    match (e.name, field, &value) {
        ("meeting", "project_id", Value::String(project)) => {
            let exists: bool =
                conn.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)", [project], |r| r.get(0))?;
            Ok(if exists { value } else { Value::Null })
        }
        ("project", "name", Value::String(name)) => {
            let other: Option<String> = conn
                .query_row("SELECT id FROM projects WHERE name = ?1 AND id != ?2", params![name, key], |r| r.get(0))
                .optional()?;
            let Some(other) = other else { return Ok(value) };
            // due progetti con lo stesso nome creati su due Mac: il nome resta a quello con
            // l'id minore, l'altro prende un numero. Uguale su ogni dispositivo.
            if key < other.as_str() {
                let free = free_name(conn, name)?;
                conn.execute("UPDATE projects SET name = ?1 WHERE id = ?2", params![free, other])?;
                touched.extend(meetings_of(conn, e, &other)?);
                Ok(value)
            } else {
                Ok(Value::String(free_name(conn, name)?))
            }
        }
        _ => Ok(value),
    }
}

fn free_name(conn: &Connection, name: &str) -> Result<String> {
    for n in 2.. {
        let candidate = format!("{name} ({n})");
        let taken: bool =
            conn.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE name = ?1)", [&candidate], |r| r.get(0))?;
        if !taken {
            return Ok(candidate);
        }
    }
    unreachable!()
}

// ---------- attivare, spegnere, girare ----------

#[derive(Serialize, Deserialize)]
struct Marker {
    format: u32,
    vault: String,
}

/// Attiva il sync di un vault in una cartella: vuota, oppure quella in cui un altro Mac
/// sincronizza già lo stesso vault. Tutto quello che il vault contiene parte nel primo giro.
pub(crate) fn enable(db: &Db, dir: &Path) -> Result<()> {
    let conn = db.conn();
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(crate::tra!(
            "Quella cartella non c'è più. Scegline un'altra.",
            "That folder no longer exists. Choose another one."
        ));
    }
    let uid = state_get(conn, "vault_uid")?;
    let marker = dir.join(MARKER);
    if marker.is_file() {
        let found: Marker = serde_json::from_str(&std::fs::read_to_string(&marker)?)?;
        match uid {
            Some(uid) if uid != found.vault => {
                return Err(crate::tra!(
                    "In quella cartella si sincronizza un altro vault. Scegline una vuota.",
                    "Another vault syncs in that folder. Choose an empty one."
                ))
            }
            Some(_) => {}
            None => state_set(conn, "vault_uid", &found.vault)?,
        }
    } else {
        let busy = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).any(|e| !e.file_name().to_string_lossy().starts_with('.'));
        if busy {
            return Err(crate::tra!(
                "Scegli una cartella vuota, oppure quella in cui un altro Mac sincronizza già questo vault.",
                "Choose an empty folder, or the one where another Mac already syncs this vault."
            ));
        }
        let uid = uid.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        std::fs::write(&marker, serde_json::to_string_pretty(&Marker { format: 1, vault: uid.clone() })?)?;
        state_set(conn, "vault_uid", &uid)?;
    }
    let tx = conn.unchecked_transaction()?;
    state_set(conn, "record", "1")?;
    for e in ENTITIES {
        conn.execute(
            &format!("INSERT OR IGNORE INTO sync_outbox (entity, key, field) SELECT '{}', {}, '*' FROM {}", e.name, e.key, e.table),
            [],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn disable(db: &Db) -> Result<()> {
    let conn = db.conn();
    state_set(conn, "record", "0")?;
    conn.execute("DELETE FROM sync_outbox", [])?;
    Ok(())
}

/// Un giro completo, con il database in mano: per i test.
#[cfg(test)]
fn sync_once(db: &Db, device: &str, dir: &Path) -> Result<Vec<String>> {
    flush(db.conn(), device, dir)?;
    let batches = read_logs(dir, device, &cursors(db.conn())?)?;
    apply(db, device, batches)
}

/// L'id di questo Mac nel log. Sta nel database dell'app, non nel vault: un vault su un disco
/// esterno può passare da un Mac all'altro.
fn device_id(main: &Db) -> Result<String> {
    if let Some(id) = main.setting("device_id")? {
        return Ok(id);
    }
    let id: String = uuid::Uuid::new_v4().simple().to_string().chars().take(12).collect();
    main.set_setting("device_id", &id)?;
    Ok(id)
}

/// Un giro alla volta, anche se "Sincronizza ora" arriva mentre gira quello automatico.
static TURN: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Scrive le modifiche di questo Mac e applica quelle degli altri. I file si leggono senza
/// tenere il database: con iCloud la lettura può aspettare lo scaricamento. `None` se il
/// vault aperto non si sincronizza.
pub(crate) fn turn(state: &AppState) -> Result<Option<Vec<String>>> {
    let _turn = TURN.lock();
    let (vault_id, min, vault_dir) = {
        let v = state.vault.read();
        (v.id.clone(), v.min_privacy, v.dir.clone())
    };
    let (dir, device) = {
        let main = state.main.lock();
        let Some(dir) = crate::vaults::sync_dir(&main, &vault_id) else { return Ok(None) };
        (dir, device_id(&main)?)
    };
    let same_vault = || state.vault.read().id == vault_id;
    let result = (|| {
        let seen = {
            let db = state.db.lock();
            if !same_vault() {
                return Ok(None);
            }
            flush(db.conn(), &device, &dir)?;
            cursors(db.conn())?
        };
        let batches = read_logs(&dir, &device, &seen)?;
        let db = state.db.lock();
        if !same_vault() {
            return Ok(None);
        }
        let touched = apply(&db, &device, batches)?;
        if !touched.is_empty() {
            // un meeting arrivato sotto la privacy minima del vault si alza subito
            crate::vaults::enforce(&db, &vault_dir, min).map_err(anyhow::Error::msg)?;
        }
        state_set(db.conn(), "last_sync", &now_ms().to_string())?;
        Ok(Some(touched))
    })();
    if same_vault() {
        let message = result.as_ref().err().map(|e: &anyhow::Error| e.to_string()).unwrap_or_default();
        let _ = state_set(state.db.lock().conn(), "last_error", &message);
    }
    result
}

/// Gira ogni pochi secondi, finché il sync è disponibile: nelle build di sviluppo, oppure
/// quando l'utente ha acceso le anteprime per sviluppatori (si possono accendere e spegnere
/// senza riavviare, quindi il controllo si fa a ogni giro).
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(EVERY);
        if available(&app.state::<AppState>()) {
            run(&app);
        }
    });
}

fn run(app: &AppHandle) {
    let state = app.state::<AppState>();
    match turn(&state) {
        Ok(Some(touched)) if !touched.is_empty() => {
            let _ = app.emit("vault-synced", touched);
        }
        Ok(_) => {}
        Err(e) => log::warn!("sync non riuscito: {e}"),
    }
}

/// Il sync è ancora un'anteprima: c'è nelle build di sviluppo e, in quelle pubblicate, solo
/// con le anteprime per sviluppatori accese in Impostazioni → Dati e privacy.
fn available(state: &AppState) -> bool {
    cfg!(debug_assertions) || state.main.lock().get_settings().map(|s| s.developer_previews).unwrap_or(false)
}

// ---------- comandi ----------

/// Il sync del vault aperto, come lo mostra Impostazioni → Vault.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Il sync c'è: build di sviluppo, oppure anteprime per sviluppatori accese.
    available: bool,
    /// Perché il vault aperto non si può sincronizzare, se non si può.
    blocked: Option<String>,
    dir: Option<String>,
    last_sync: Option<i64>,
    /// I dispositivi che hanno scritto nella cartella, questo compreso.
    devices: usize,
    /// Modifiche di questo Mac non ancora scritte nella cartella.
    pending: usize,
    /// Versioni di note tenute da parte dopo una modifica concorrente.
    conflicts: usize,
    error: Option<String>,
}

fn status(state: &AppState) -> CmdResult<Status> {
    let (vault_id, min) = {
        let v = state.vault.read();
        (v.id.clone(), v.min_privacy)
    };
    let dir = crate::vaults::sync_dir(&state.main.lock(), &vault_id);
    let available = available(state);
    let db = state.db.lock();
    let conn = db.conn();
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map(|n| n as usize).map_err(err);
    let devices = dir
        .as_ref()
        .and_then(|d| std::fs::read_dir(d.join("log")).ok())
        .map(|entries| entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).count())
        .unwrap_or(0);
    Ok(Status {
        available,
        blocked: (min == Privacy::Hardened).then(|| {
            tr(
                "Un vault blindato non si sincronizza: niente dei suoi meeting deve uscire dal Mac.",
                "A hardened vault does not sync: none of its meetings may leave the Mac.",
            )
            .to_string()
        }),
        dir: dir.map(|d| d.display().to_string()),
        last_sync: state_get(conn, "last_sync").map_err(err)?.and_then(|v| v.parse().ok()),
        devices,
        pending: count("SELECT COUNT(DISTINCT entity || key) FROM sync_outbox")?,
        conflicts: count("SELECT COUNT(*) FROM sync_conflicts")?,
        error: state_get(conn, "last_error").map_err(err)?.filter(|e| !e.is_empty()),
    })
}

#[tauri::command]
pub fn sync_status(state: State<AppState>) -> CmdResult<Status> {
    status(&state)
}

/// Fa scegliere la cartella di sync. `None` se la scelta viene annullata.
#[tauri::command]
pub async fn pick_sync_dir(app: AppHandle) -> CmdResult<Option<String>> {
    crate::commands::pick_folder(&app, tr("Cartella di sync", "Sync folder")).await
}

/// Attiva il sync del vault aperto in una cartella e fa subito il primo giro.
#[tauri::command]
pub async fn enable_sync(app: AppHandle, dir: String) -> CmdResult<Status> {
    let state = app.state::<AppState>();
    if !available(&state) {
        return Err(tr(
            "Il sync è un'anteprima per sviluppatori: accendila in Impostazioni → Dati e privacy.",
            "Sync is a developer preview: turn it on in Settings → Data and privacy.",
        )
        .into());
    }
    let (vault_id, min) = {
        let v = state.vault.read();
        (v.id.clone(), v.min_privacy)
    };
    if min == Privacy::Hardened {
        return Err(tr(
            "Un vault blindato non si sincronizza: abbassa la sua privacy minima per farlo.",
            "A hardened vault does not sync: lower its minimum privacy to do so.",
        )
        .into());
    }
    let dir = PathBuf::from(dir.trim());
    enable(&state.db.lock(), &dir).map_err(err)?;
    crate::vaults::set_sync_dir(&state.main.lock(), &vault_id, Some(dir.display().to_string()))?;
    log::info!("sync attivato per il vault aperto");
    sync_now(app).await
}

/// Spegne il sync del vault aperto. La cartella e quello che contiene restano.
#[tauri::command]
pub fn disable_sync(state: State<AppState>) -> CmdResult<Status> {
    let _turn = TURN.lock();
    let vault_id = state.vault.read().id.clone();
    disable(&state.db.lock()).map_err(err)?;
    crate::vaults::set_sync_dir(&state.main.lock(), &vault_id, None)?;
    log::info!("sync spento per il vault aperto");
    status(&state)
}

/// Un giro subito, senza aspettare quello automatico.
#[tauri::command]
pub async fn sync_now(app: AppHandle) -> CmdResult<Status> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || run(&handle)).await.map_err(err)?;
    status(&app.state::<AppState>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn developer_previews_stay_off_until_the_user_turns_them_on() {
        assert!(!crate::models::Settings::default().developer_previews);
        let saved: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(!saved.developer_previews, "impostazioni salvate prima delle anteprime");
    }

    struct Mac {
        db: Db,
        id: &'static str,
    }

    impl Mac {
        fn new(id: &'static str, dir: &Path) -> Mac {
            let db = Db::open_in_memory().unwrap();
            enable(&db, dir).unwrap();
            Mac { db, id }
        }
        fn sync(&self, dir: &Path) -> Vec<String> {
            sync_once(&self.db, self.id, dir).unwrap()
        }
        fn meeting(&self, id: &str) -> Option<crate::models::Meeting> {
            self.db.get_meeting(id).unwrap()
        }
    }

    fn folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("granello-sync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn meetings_notes_and_transcripts_reach_the_other_mac() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        // un meeting creato prima di attivare il sync parte con il primo giro
        let before = a.db.create_meeting("Già qui", None, &["Anna Rossi".into()], None).unwrap();
        let project = a.db.save_project("", "Cliente Nord", "blue", "").unwrap();
        let m = a.db.create_meeting("Kickoff", None, &[], None).unwrap();
        a.db.set_meetings_project(std::slice::from_ref(&m.id), Some(&project.id)).unwrap();
        a.db.update_meeting(&m.id, None, Some("- decidere il prezzo"), None, None).unwrap();
        a.db.add_segment(&m.id, "them", 0, 1000, "parliamo del connettore").unwrap();
        a.sync(&dir);

        let b = Mac::new("bbb", &dir);
        let touched = b.sync(&dir);
        assert!(touched.contains(&m.id) && touched.contains(&before.id));
        let got = b.meeting(&m.id).unwrap();
        assert_eq!((got.title.as_str(), got.notes_md.as_str()), ("Kickoff", "- decidere il prezzo"));
        assert_eq!(got.project_id, Some(project.id.clone()));
        assert_eq!(b.db.segments(&m.id).unwrap()[0].text, "parliamo del connettore");
        assert_eq!(b.db.list_people().unwrap()[0].name, "Anna Rossi");
        // e si trova con la ricerca, anche per il nome del progetto
        assert_eq!(b.db.list_meetings(Some("connettore")).unwrap()[0].id, m.id);
        assert_eq!(b.db.list_meetings(Some("nord")).unwrap()[0].id, m.id);

        // le modifiche ricevute non tornano indietro
        b.sync(&dir);
        assert!(!dir.join("log/bbb").exists(), "b non ha scritto niente di suo");

        // modifiche e cancellazioni da b ad a
        b.db.set_tags(&m.id, &["prezzi".into()]).unwrap();
        b.db.delete_meeting(&before.id).unwrap();
        b.sync(&dir);
        a.sync(&dir);
        assert_eq!(a.meeting(&m.id).unwrap().tags, vec!["prezzi"]);
        assert!(a.meeting(&before.id).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn renamed_and_merged_people_reach_the_other_mac() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        let m = a.db.create_meeting("Kickoff", None, &["Marco".into(), "Elena".into(), "E. Rossi".into()], None).unwrap();
        a.db.update_meeting(&m.id, None, Some("@[Marco] chiama"), None, None).unwrap();
        a.sync(&dir);
        let b = Mac::new("bbb", &dir);
        b.sync(&dir);

        let people = a.db.list_people().unwrap();
        let id = |n: &str| people.iter().find(|p| p.name == n).unwrap().id;
        a.db.update_person(id("Marco"), "Marco Bianchi", Some("marco@example.ch")).unwrap();
        a.db.merge_people(id("E. Rossi"), id("Elena")).unwrap();
        a.sync(&dir);
        b.sync(&dir);

        let names: Vec<String> = b.db.list_people().unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Elena", "Marco Bianchi"]);
        assert_eq!(b.db.person_email("Marco Bianchi").unwrap().as_deref(), Some("marco@example.ch"));
        let got = b.meeting(&m.id).unwrap();
        assert_eq!(got.attendees, vec!["Marco Bianchi", "Elena"]);
        assert_eq!(got.notes_md, "@[Marco Bianchi] chiama");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_last_edit_wins_per_field_and_lost_notes_are_kept() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        let b = Mac::new("bbb", &dir);
        let m = a.db.create_meeting("Roadmap", None, &[], None).unwrap();
        a.db.update_meeting(&m.id, None, Some("prima versione"), None, None).unwrap();
        a.sync(&dir);
        b.sync(&dir);

        // a cambia il titolo, b le note: tutte e due le modifiche restano
        a.db.update_meeting(&m.id, Some("Roadmap 2027"), None, None, None).unwrap();
        b.db.update_meeting(&m.id, None, Some("note di b"), None, None).unwrap();
        a.sync(&dir);
        b.sync(&dir);
        a.sync(&dir);
        for mac in [&a, &b] {
            let got = mac.meeting(&m.id).unwrap();
            assert_eq!((got.title.as_str(), got.notes_md.as_str()), ("Roadmap 2027", "note di b"));
        }

        // tutti e due cambiano le note senza essersi visti: vince l'ultima, l'altra si tiene
        a.db.update_meeting(&m.id, None, Some("note di a, offline"), None, None).unwrap();
        a.sync(&dir);
        std::thread::sleep(Duration::from_millis(5));
        b.db.update_meeting(&m.id, None, Some("note di b, offline"), None, None).unwrap();
        b.sync(&dir);
        a.sync(&dir);
        for mac in [&a, &b] {
            assert_eq!(mac.meeting(&m.id).unwrap().notes_md, "note di b, offline");
        }
        let kept: String = a
            .db
            .conn()
            .query_row("SELECT value FROM sync_conflicts WHERE meeting_id = ?1", [&m.id], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, "note di a, offline");
        let on_b: i64 = b.db.conn().query_row("SELECT COUNT(*) FROM sync_conflicts", [], |r| r.get(0)).unwrap();
        assert_eq!(on_b, 1, "anche b tiene la versione di a");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn hardened_meetings_stay_on_the_mac() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        let open = a.db.create_meeting("Aperto", None, &[], None).unwrap();
        let hardened = a.db.create_meeting_with("Blindato", None, &[], None, "", Privacy::Hardened).unwrap();
        a.db.add_segment(&hardened.id, "me", 0, 1000, "segreto").unwrap();
        a.sync(&dir);
        let log = std::fs::read_to_string(dir.join("log/aaa/0000000001.jsonl")).unwrap();
        assert!(!log.contains("Blindato") && !log.contains("segreto"));

        let b = Mac::new("bbb", &dir);
        b.sync(&dir);
        assert!(b.meeting(&open.id).is_some());
        assert!(b.meeting(&hardened.id).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn projects_with_the_same_name_end_up_the_same_on_both_macs() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        let b = Mac::new("bbb", &dir);
        let pa = a.db.save_project("", "Lancio", "", "").unwrap();
        let pb = b.db.save_project("", "Lancio", "", "").unwrap();
        a.sync(&dir);
        b.sync(&dir);
        a.sync(&dir);
        let (first, second) = if pa.id < pb.id { (&pa.id, &pb.id) } else { (&pb.id, &pa.id) };
        for mac in [&a, &b] {
            let names: HashMap<String, String> =
                mac.db.list_projects().unwrap().into_iter().map(|p| (p.id, p.name)).collect();
            assert_eq!(names[first], "Lancio");
            assert_eq!(names[second], "Lancio (2)");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_file_stops_the_reading_until_it_arrives() {
        let dir = folder();
        let a = Mac::new("aaa", &dir);
        let first = a.db.create_meeting("Uno", None, &[], None).unwrap();
        a.sync(&dir);
        let second = a.db.create_meeting("Due", None, &[], None).unwrap();
        a.sync(&dir);
        // il servizio di sync non ha ancora consegnato il primo file
        let one = dir.join("log/aaa/0000000001.jsonl");
        let held = dir.join("trattenuto");
        std::fs::rename(&one, &held).unwrap();

        let b = Mac::new("bbb", &dir);
        b.sync(&dir);
        assert!(b.meeting(&second.id).is_none(), "il secondo aspetta il primo");
        std::fs::rename(&held, &one).unwrap();
        b.sync(&dir);
        assert!(b.meeting(&first.id).is_some() && b.meeting(&second.id).is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_folder_belongs_to_one_vault() {
        let dir = folder();
        let _a = Mac::new("aaa", &dir);
        // un altro vault, che si sincronizzava già altrove
        let other = Db::open_in_memory().unwrap();
        state_set(other.conn(), "vault_uid", "un-altro-vault").unwrap();
        assert!(enable(&other, &dir).is_err());
        // una cartella piena di altre cose
        let busy = folder();
        std::fs::write(busy.join("foto.jpg"), "x").unwrap();
        assert!(enable(&Db::open_in_memory().unwrap(), &busy).is_err());
        // spento il sync, le modifiche non si annotano più
        let db = Db::open_in_memory().unwrap();
        let empty = folder();
        enable(&db, &empty).unwrap();
        disable(&db).unwrap();
        db.create_meeting("Dopo", None, &[], None).unwrap();
        let pending: i64 = db.conn().query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0)).unwrap();
        assert_eq!(pending, 0);
        for d in [dir, busy, empty] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
