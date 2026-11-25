//! Import di un vault Obsidian. La cartella viene solo letta, mai modificata: le note diventano
//! note di Granello, i file che le note usano diventano allegati e quelli che nessuna nota usa
//! finiscono nella Libreria, sotto File. Le regole sono quelle scritte nel TODO ("Import from
//! other apps"): ogni differenza tra i due formati ha una conversione, o un posto nel rapporto.

use crate::attachments;
use crate::i18n::tr;
use crate::models::{link_title as clean_title, normalize_tags, NewFile, NewNote};
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Una nota più grande viene saltata: non è un testo scritto a mano.
const MAX_NOTE_BYTES: u64 = 5 * 1024 * 1024;
/// Oltre questo numero di file la cartella scelta non è un vault (la home, un disco intero).
const MAX_ENTRIES: usize = 50_000;
/// Il tag che porta ogni nota importata.
pub const TAG: &str = "obsidian";

const IMAGES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic"];

/// Un file o una nota lasciati fuori, con il perché.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

/// Cosa farebbe (o ha fatto) un import: lo mostra la pagina prima di importare e dopo.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// La cartella ha `.obsidian`: è davvero un vault.
    pub obsidian: bool,
    pub notes: usize,
    /// File usati dalle note, copiati tra gli allegati.
    pub attachments: usize,
    /// File che nessuna nota usa: vanno nella Libreria, sotto File.
    pub loose: usize,
    /// I progetti che le cartelle di primo livello danno alle note.
    pub projects: Vec<String>,
    /// Note già importate da questa cartella, saltate.
    pub already: usize,
    /// Note già importate e cambiate in Obsidian da allora: non vengono aggiornate.
    pub changed: Vec<String>,
    /// Link `[[…]]` a note che non ci sono: restano link, segnati come mancanti.
    pub missing_links: usize,
    pub skipped: Vec<Skipped>,
}

/// Il risultato della preparazione: cosa scrivere nel database e cosa è stato copiato.
pub struct Prepared {
    pub summary: Summary,
    pub notes: Vec<NewNote>,
    pub files: Vec<NewFile>,
    /// I percorsi `attachments/…` copiati: se la scrittura nel database fallisce si eliminano.
    pub copied: Vec<String>,
}

/// Legge la cartella e prepara l'import. Con `copy` falso non copia niente (serve al riepilogo
/// prima di importare); `already` sono i percorsi già importati da questa cartella, con
/// l'impronta del loro contenuto.
pub fn prepare(root: &Path, already: &HashMap<String, String>, copy: Option<&Path>) -> Result<Prepared> {
    if !root.is_dir() {
        return Err(tra!("La cartella non esiste più. Scegline un'altra.", "The folder no longer exists. Choose another one."));
    }
    let skip_dirs = obsidian_special_folders(root);
    let mut entries = Vec::new();
    walk(root, root, &skip_dirs, &mut entries)?;
    let mut summary = Summary { obsidian: root.join(".obsidian").is_dir(), ..Default::default() };

    let mut note_paths = Vec::new();
    let mut file_paths = Vec::new();
    for rel in entries {
        let lower = rel.to_lowercase();
        if lower.ends_with(".excalidraw.md") || lower.ends_with(".excalidraw") {
            summary.skipped.push(skip(&rel, tr("disegno di Excalidraw", "Excalidraw drawing")));
        } else if lower.ends_with(".canvas") {
            summary.skipped.push(skip(&rel, tr("canvas di Obsidian", "Obsidian canvas")));
        } else if lower.ends_with(".base") {
            summary.skipped.push(skip(&rel, tr("base di Obsidian", "Obsidian base")));
        } else if lower.ends_with(".md") {
            note_paths.push(rel);
        } else {
            file_paths.push(rel);
        }
    }
    for (folder, why) in &skip_dirs {
        summary.skipped.push(skip(&format!("{folder}/"), why));
    }

    // prima passata: il testo, le proprietà e il titolo di ogni nota, per risolvere i link
    let mut sources = Vec::new();
    for rel in note_paths {
        let path = root.join(&rel);
        let meta = std::fs::metadata(&path)?;
        if meta.len() > MAX_NOTE_BYTES {
            summary.skipped.push(skip(&rel, tr("nota più grande di 5 MB", "note larger than 5 MB")));
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
        let (props, body_start) = frontmatter(&text);
        let file_name = rel.rsplit('/').next().unwrap_or(&rel);
        let stem = file_name[..file_name.len() - 3].to_string();
        let title = props
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("title"))
            .map(|(_, v)| v.text())
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| stem.clone());
        sources.push(Source {
            rel,
            hash: fnv(&bytes),
            body: text[body_start..].to_string(),
            props,
            title: clean_title(&title),
            stem,
            modified: ms(meta.modified().ok()),
            created: ms(meta.created().ok()),
        });
    }
    // due note con lo stesso titolo: la cartella le distingue, perché i link vanno per titolo
    let mut seen: HashMap<String, usize> = HashMap::new();
    for s in &sources {
        *seen.entry(s.title.to_lowercase()).or_default() += 1;
    }
    for s in &mut sources {
        if seen[&s.title.to_lowercase()] > 1 {
            if let Some(parent) = s.rel.rsplit('/').nth(1) {
                s.title = clean_title(&format!("{} ({parent})", s.title));
            }
        }
    }

    let index = Index::new(&sources, &file_paths);
    let mut files = Files { root, copy, done: HashMap::new(), copied: Vec::new() };
    // i file usati dalle note già importate: non sono file senza nota, e non si copiano di nuovo
    let mut used_before = Files { root, copy: None, done: HashMap::new(), copied: Vec::new() };
    let mut notes = Vec::new();
    let mut projects: Vec<String> = Vec::new();
    for s in &sources {
        if let Some(hash) = already.get(&s.rel) {
            summary.already += 1;
            if *hash != s.hash {
                summary.changed.push(s.rel.clone());
            }
            let mut cx = Cx { index: &index, files: &mut used_before, from: s.rel.clone(), tags: Vec::new(), missing_links: 0, missing: Vec::new(), in_table: false };
            convert(&s.body, &mut cx);
            continue;
        }
        let folders: Vec<&str> = s.rel.split('/').collect();
        let place = Place::of(&folders[..folders.len() - 1]);
        // la proprietà `progetto` vince sulla cartella
        let project = prop_list(&s.props, PROJECT_KEYS).into_iter().map(|p| person_or_name(&p)).find(|p| !p.is_empty()).or(place.project);
        if let Some(p) = &project {
            if !projects.iter().any(|x| x.eq_ignore_ascii_case(p)) {
                projects.push(p.clone());
            }
        }
        let mut cx = Cx { index: &index, files: &mut files, from: s.rel.clone(), tags: Vec::new(), missing_links: 0, missing: Vec::new(), in_table: false };
        let body = convert(&s.body, &mut cx);
        let body = drop_title_heading(&body, &s.title, &s.stem);
        let mut tags = vec![TAG.to_string()];
        tags.extend(place.tags);
        tags.extend(prop_list(&s.props, &["tags", "tag"]));
        tags.append(&mut cx.tags);
        summary.missing_links += cx.missing_links;
        for m in cx.missing.drain(..) {
            summary.skipped.push(skip(&m, &trf!("non trovato (usato in {})", "not found (used in {})", s.rel)));
        }
        let created = prop_date(&s.props)
            .or_else(|| date_in(&s.stem))
            .or(s.created)
            .or(s.modified)
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let updated = s.modified.unwrap_or(created).max(created);
        let people: Vec<String> = prop_list(&s.props, PEOPLE_KEYS).iter().map(|p| person_or_name(p)).collect();
        notes.push(NewNote {
            title: s.title.clone(),
            notes_md: with_properties(&s.props, &body),
            tags: normalize_tags(tags),
            attendees: crate::models::normalize_names(people, 80, crate::models::MAX_ATTENDEES),
            archived_project: place.archived,
            project,
            created_at: created,
            updated_at: updated,
            source_path: s.rel.clone(),
            source_hash: s.hash.clone(),
        });
    }
    summary.notes = notes.len();

    // i file che nessuna nota usa: nella Libreria, senza nota
    let mut loose = Vec::new();
    for rel in &file_paths {
        if files.done.contains_key(rel) || used_before.done.contains_key(rel) || already.contains_key(rel) {
            continue;
        }
        match files.attach(rel) {
            Ok(a) => {
                let meta = std::fs::metadata(root.join(rel)).ok();
                let folder = rel.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
                loose.push(NewFile {
                    path: a.path,
                    name: a.name,
                    bytes: a.size as i64,
                    folder,
                    created_at: ms(meta.and_then(|m| m.modified().ok())).unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
                    source_path: rel.clone(),
                });
            }
            Err(reason) => summary.skipped.push(skip(rel, &reason)),
        }
    }
    summary.loose = loose.len();
    summary.attachments = files.done.iter().filter(|(rel, r)| r.is_ok() && !loose.iter().any(|f| &f.source_path == *rel)).count();
    for (rel, r) in &files.done {
        if let Err(reason) = r {
            if !summary.skipped.iter().any(|s| &s.path == rel) {
                summary.skipped.push(skip(rel, reason));
            }
        }
    }
    projects.sort_by_key(|p| p.to_lowercase());
    summary.projects = projects;
    summary.skipped.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Prepared { summary, notes, files: loose, copied: files.copied })
}

fn skip(path: &str, reason: &str) -> Skipped {
    Skipped { path: path.to_string(), reason: reason.to_string() }
}

fn ms(t: Option<std::time::SystemTime>) -> Option<i64> {
    t.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
}

/// Impronta del contenuto (FNV-1a a 64 bit): basta a capire se una nota è cambiata.
fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Le cartelle che Obsidian usa per sé: i template (con i segnaposto `{{date}}`) non sono note.
fn obsidian_special_folders(root: &Path) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for file in ["templates.json", "templater-obsidian/data.json"] {
        let Ok(text) = std::fs::read_to_string(root.join(".obsidian").join(file)) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for key in ["folder", "templates_folder"] {
            if let Some(f) = json.get(key).and_then(|v| v.as_str()) {
                let f = f.trim_matches('/').to_string();
                if !f.is_empty() && !out.iter().any(|(x, _)| *x == f) {
                    out.push((f, tr("cartella dei template di Obsidian", "Obsidian templates folder")));
                }
            }
        }
    }
    // la cartella dei template spesso non è dichiarata: si riconosce dal nome
    if let Ok(list) = std::fs::read_dir(root) {
        for entry in list.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir && ["templates", "template", "modelli"].contains(&bare(&name).as_str()) && !out.iter().any(|(x, _)| *x == name) {
                out.push((name, tr("cartella dei template di Obsidian", "Obsidian templates folder")));
            }
        }
    }
    out
}

/// Tutti i file sotto `dir`, come percorsi relativi con `/`. Salta file e cartelle nascosti
/// (`.obsidian`, `.trash`, `.git`) e i collegamenti simbolici: si legge solo dentro il vault.
fn walk(root: &Path, dir: &Path, skip_dirs: &[(String, &str)], out: &mut Vec<String>) -> Result<()> {
    let mut list: Vec<_> = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    list.sort_by_key(|e| e.file_name());
    for entry in list {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let kind = entry.file_type()?;
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        if kind.is_dir() {
            if !skip_dirs.iter().any(|(f, _)| *f == rel) {
                walk(root, &path, skip_dirs, out)?;
            }
        } else if kind.is_file() {
            out.push(rel);
            if out.len() > MAX_ENTRIES {
                return Err(tra!(
                    "La cartella ha più di 50'000 file: non sembra un vault. Scegli la cartella del vault Obsidian.",
                    "The folder has more than 50,000 files: it does not look like a vault. Choose the Obsidian vault folder."
                ));
            }
        }
    }
    Ok(())
}

// ---------------- proprietà (frontmatter) ----------------

#[derive(Debug, Clone, PartialEq)]
enum Prop {
    Text(String),
    List(Vec<String>),
}

impl Prop {
    fn text(&self) -> String {
        match self {
            Prop::Text(t) => t.clone(),
            Prop::List(l) => l.join(", "),
        }
    }
    fn items(&self) -> Vec<String> {
        match self {
            Prop::Text(t) => t.split([',', ' ']).map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect(),
            Prop::List(l) => l.clone(),
        }
    }
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    for q in ['"', '\''] {
        if s.len() >= 2 && s.starts_with(q) && s.ends_with(q) {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

/// Le proprietà YAML in cima alla nota e dove inizia il testo. Basta un YAML semplice:
/// `chiave: valore`, `chiave: [a, b]` e gli elenchi con `- voce`. Il resto resta testo.
fn frontmatter(text: &str) -> (Vec<(String, Prop)>, usize) {
    let Some(rest) = text.strip_prefix("---\n") else { return (Vec::new(), 0) };
    let mut end = None;
    let mut at = 4;
    for line in rest.split_inclusive('\n') {
        let l = line.trim_end();
        if l == "---" || l == "..." {
            end = Some((at, at + line.len()));
            break;
        }
        at += line.len();
    }
    let Some((yaml_end, body_start)) = end else { return (Vec::new(), 0) };
    let mut props: Vec<(String, Prop)> = Vec::new();
    for line in text[4..yaml_end].lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        let trimmed = line.trim();
        if indented || trimmed.starts_with("- ") {
            let Some((_, last)) = props.last_mut() else { continue };
            if let Some(item) = trimmed.strip_prefix("- ").or_else(|| (trimmed == "-").then_some("")) {
                let item = unquote(item);
                match last {
                    Prop::List(l) => l.push(item),
                    Prop::Text(t) if t.is_empty() => *last = Prop::List(vec![item]),
                    Prop::Text(t) => t.push_str(&format!("; {item}")),
                }
            } else if let Prop::Text(t) = last {
                if !t.is_empty() {
                    t.push_str("; ");
                }
                t.push_str(trimmed);
            }
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        let prop = if value.starts_with('[') && value.ends_with(']') {
            Prop::List(value[1..value.len() - 1].split(',').map(unquote).filter(|s| !s.is_empty()).collect())
        } else {
            Prop::Text(unquote(value))
        };
        props.push((unquote(key), prop));
    }
    for (_, p) in &mut props {
        if let Prop::List(l) = p {
            l.retain(|s| !s.is_empty());
        }
    }
    (props, body_start)
}

fn prop_list(props: &[(String, Prop)], keys: &[&str]) -> Vec<String> {
    props.iter().filter(|(k, _)| keys.iter().any(|x| k.eq_ignore_ascii_case(x))).flat_map(|(_, v)| v.items()).collect()
}

const DATE_KEYS: &[&str] = &["created", "date", "created_at", "creation date", "date created"];
/// Proprietà che danno il progetto e i partecipanti della nota.
const PROJECT_KEYS: &[&str] = &["progetto", "project"];
const PEOPLE_KEYS: &[&str] = &["partecipanti", "attendees", "participants", "persone", "people"];

/// `[[Mario Rossi|Mario]]` o `@Mario Rossi` in una proprietà: resta il nome.
fn person_or_name(value: &str) -> String {
    let v = value.trim().trim_start_matches('@');
    let v = v.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")).unwrap_or(v);
    let v = v.split('|').next().unwrap_or(v);
    v.rsplit('/').next().unwrap_or(v).trim().to_string()
}

/// Il nome di una cartella senza numerazione né trattini davanti (`1 - Projects` → `projects`).
fn bare(name: &str) -> String {
    name.trim_start_matches(|c: char| c.is_ascii_digit() || " ._-".contains(c)).trim().to_lowercase()
}

const PARA: &[(&str, bool)] = &[
    ("projects", false),
    ("progetti", false),
    ("areas", false),
    ("aree", false),
    ("resources", false),
    ("risorse", false),
    ("archive", true),
    ("archivio", true),
];

/// Il progetto e i tag che la cartella dà a una nota.
struct Place {
    project: Option<String>,
    tags: Vec<String>,
    /// La nota sta nell'archivio di un vault PARA: il suo progetto nasce archiviato.
    archived: bool,
}

impl Place {
    /// La cartella di primo livello è il progetto, le altre un tag. In un vault PARA (Projects,
    /// Areas, Resources, Archive) il progetto è la cartella sotto e la categoria è un tag. Una
    /// cartella che comincia con `_` (`_daily`) non diventa mai un progetto, solo un tag.
    fn of(folders: &[&str]) -> Place {
        let clean = |f: &&str| f.trim().trim_start_matches('_').to_string();
        let mut tags = Vec::new();
        let mut archived = false;
        let mut rest: &[&str] = folders;
        if let Some(first) = folders.first() {
            if let Some((_, arch)) = PARA.iter().find(|(name, _)| *name == bare(first)) {
                tags.push(bare(first));
                archived = *arch;
                rest = &folders[1..];
            }
        }
        let project = rest.first().filter(|f| !f.trim().starts_with('_') && !f.trim().is_empty()).map(|f| f.trim().to_string());
        let deeper: Vec<String> = rest.iter().skip(usize::from(project.is_some())).map(clean).filter(|f| !f.is_empty()).collect();
        if !deeper.is_empty() {
            tags.push(deeper.join("/"));
        }
        Place { project, tags, archived }
    }
}
/// Proprietà che diventano altro (titolo, tag, data) o che servono solo alla grafica di Obsidian.
const USED_KEYS: &[&str] = &["title", "tags", "tag", "cssclass", "cssclasses"];

fn prop_date(props: &[(String, Prop)]) -> Option<i64> {
    DATE_KEYS.iter().find_map(|key| {
        props.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).and_then(|(_, v)| parse_date(&v.text()))
    })
}

/// Una data scritta a mano: con o senza ora, con o senza fuso. Senza ora vale mezzogiorno.
fn parse_date(s: &str) -> Option<i64> {
    use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone};
    let s = s.trim();
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.timestamp_millis());
    }
    for f in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"] {
        if let Ok(d) = NaiveDateTime::parse_from_str(s, f) {
            return Local.from_local_datetime(&d).earliest().map(|d| d.timestamp_millis());
        }
    }
    let day = NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()?;
    Local.from_local_datetime(&day.and_hms_opt(12, 0, 0)?).earliest().map(|d| d.timestamp_millis())
}

/// Una data `AAAA-MM-GG` nel nome del file (le note del giorno).
fn date_in(name: &str) -> Option<i64> {
    let b = name.as_bytes();
    (0..b.len().saturating_sub(9)).find_map(|i| {
        let w = &b[i..i + 10];
        let shape = w.iter().enumerate().all(|(j, c)| if j == 4 || j == 7 { *c == b'-' } else { c.is_ascii_digit() });
        if shape { parse_date(&name[i..i + 10]) } else { None }
    })
}

/// Le proprietà che Granello non ha restano in una sezione richiudibile in cima alla nota.
fn with_properties(props: &[(String, Prop)], body: &str) -> String {
    let is = |k: &str, keys: &[&str]| keys.iter().any(|u| k.eq_ignore_ascii_case(u));
    let extra: Vec<_> = props
        .iter()
        .filter(|(k, v)| {
            !v.text().trim().is_empty()
                && !is(k, USED_KEYS)
                && !is(k, PROJECT_KEYS)
                && !is(k, PEOPLE_KEYS)
                // una data diventa la data della nota; una che non si legge resta qui
                && !(is(k, DATE_KEYS) && parse_date(&v.text()).is_some())
        })
        .collect();
    if extra.is_empty() {
        return body.to_string();
    }
    let cell = |s: &str| s.replace('|', "\\|").replace('\n', " ");
    let mut out = format!("::: details {}\n\n| {} | {} |\n| --- | --- |\n", tr("Proprietà", "Properties"), tr("Proprietà", "Property"), tr("Valore", "Value"));
    for (k, v) in extra {
        out += &format!("| {} | {} |\n", cell(k), cell(&v.text()));
    }
    out += "\n:::\n\n";
    out + body
}

// ---------------- link e file ----------------

struct Source {
    rel: String,
    hash: String,
    body: String,
    props: Vec<(String, Prop)>,
    title: String,
    stem: String,
    modified: Option<i64>,
    created: Option<i64>,
}

/// Come Obsidian trova il bersaglio di un link: il percorso, altrimenti il nome del file
/// (il percorso più corto se ce n'è più d'uno), altrimenti un alias.
struct Index {
    notes_by_path: HashMap<String, usize>,
    notes_by_name: HashMap<String, usize>,
    titles: Vec<String>,
    files_by_path: HashMap<String, String>,
    files_by_name: HashMap<String, String>,
}

impl Index {
    fn new(sources: &[Source], files: &[String]) -> Self {
        let mut notes_by_path = HashMap::new();
        let mut notes_by_name: HashMap<String, usize> = HashMap::new();
        let mut order: Vec<usize> = (0..sources.len()).collect();
        order.sort_by_key(|i| (sources[*i].rel.len(), sources[*i].rel.clone()));
        for i in order {
            let s = &sources[i];
            notes_by_path.insert(s.rel[..s.rel.len() - 3].to_lowercase(), i);
            notes_by_name.entry(s.stem.to_lowercase()).or_insert(i);
        }
        for (i, s) in sources.iter().enumerate() {
            for alias in prop_list(&s.props, &["aliases", "alias"]) {
                notes_by_name.entry(alias.to_lowercase()).or_insert(i);
            }
        }
        let mut files_by_path = HashMap::new();
        let mut files_by_name: HashMap<String, String> = HashMap::new();
        let mut sorted: Vec<&String> = files.iter().collect();
        sorted.sort_by_key(|f| (f.len(), f.to_string()));
        for f in sorted {
            files_by_path.insert(f.to_lowercase(), f.clone());
            files_by_name.entry(f.rsplit('/').next().unwrap_or(f).to_lowercase()).or_insert_with(|| f.clone());
        }
        Index { notes_by_path, notes_by_name, titles: sources.iter().map(|s| s.title.clone()).collect(), files_by_path, files_by_name }
    }

    fn note(&self, target: &str, from: &str) -> Option<&str> {
        let t = target.trim();
        let t = t.strip_suffix(".md").or_else(|| t.strip_suffix(".MD")).unwrap_or(t).to_lowercase();
        if t.is_empty() {
            return None;
        }
        let i = joined(from, &t)
            .and_then(|p| self.notes_by_path.get(&p))
            .or_else(|| self.notes_by_path.get(t.trim_start_matches('/')))
            .or_else(|| self.notes_by_name.get(t.rsplit('/').next().unwrap_or(&t)))?;
        Some(&self.titles[*i])
    }

    fn file(&self, target: &str, from: &str) -> Option<&str> {
        let t = target.trim().to_lowercase();
        joined(from, &t)
            .and_then(|p| self.files_by_path.get(&p))
            .or_else(|| self.files_by_path.get(t.trim_start_matches('/')))
            .or_else(|| self.files_by_name.get(t.rsplit('/').next().unwrap_or(&t)))
            .map(String::as_str)
    }
}

/// Un percorso relativo alla cartella della nota, con `..` risolti. None se esce dal vault.
fn joined(from: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for p in target.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/").to_lowercase())
}

/// I file del vault usati dalle note: ognuno copiato una volta sola tra gli allegati.
struct Files<'a> {
    root: &'a Path,
    copy: Option<&'a Path>,
    done: HashMap<String, Result<attachments::Attachment, String>>,
    copied: Vec<String>,
}

impl Files<'_> {
    fn attach(&mut self, rel: &str) -> Result<attachments::Attachment, String> {
        if let Some(r) = self.done.get(rel) {
            return r.clone();
        }
        let source = self.root.join(rel);
        let r = match std::fs::metadata(&source) {
            Err(e) => Err(e.to_string()),
            Ok(m) if m.len() > attachments::MAX_BYTES => Err(tr("più grande di 25 MB", "larger than 25 MB").to_string()),
            Ok(m) => match self.copy {
                Some(dir) => attachments::import(dir, &source).map_err(|e| e.to_string()).inspect(|a| self.copied.push(a.path.clone())),
                None => Ok(attachments::Attachment {
                    path: "attachments/preview".into(),
                    name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
                    size: m.len(),
                }),
            },
        };
        self.done.insert(rel.to_string(), r.clone());
        r
    }
}

fn size_label(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else {
        format!("{} KB", ((bytes as f64 / 1024.0).round() as u64).max(1))
    }
}

fn is_image(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    IMAGES.contains(&ext.as_str())
}

/// Ha un'estensione che non è `.md`: è un file, non una nota.
fn is_file_target(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    match name.rsplit_once('.') {
        // `Riunione 5.7.2025` è una nota: un'estensione ha almeno una lettera
        Some((_, ext)) => {
            !ext.eq_ignore_ascii_case("md")
                && (1..=8).contains(&ext.len())
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
                && ext.chars().any(|c| c.is_ascii_alphabetic())
        }
        None => false,
    }
}

/// Forme `[[…]]` che in Granello sono già altro: un link con quel titolo diventa testo.
fn reserved(title: &str) -> bool {
    let t = title.trim().to_lowercase();
    t == "toc" || t == "progress" || ["rating:", "timer:", "chart:"].iter().any(|p| t.starts_with(p))
}

fn decode_percent(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---------------- conversione del testo ----------------

/// Il contesto della nota che si sta convertendo.
struct Cx<'a, 'b> {
    index: &'a Index,
    files: &'a mut Files<'b>,
    /// Il percorso della nota, per i link relativi.
    from: String,
    tags: Vec<String>,
    missing_links: usize,
    missing: Vec<String>,
    /// La riga è di una tabella: la barra di un link va scritta `\|`.
    in_table: bool,
}

impl Cx<'_, '_> {
    fn note_link(&mut self, target: &str, alias: Option<&str>) -> String {
        let alias = alias.map(str::trim).filter(|a| !a.is_empty());
        let (title, found) = match self.index.note(target, &self.from) {
            Some(t) => (t.to_string(), true),
            None => (clean_title(target.trim()), false),
        };
        if title.is_empty() || reserved(&title) {
            return alias.unwrap_or(&title).to_string();
        }
        if !found {
            self.missing_links += 1;
        }
        let bar = if self.in_table { "\\|" } else { "|" };
        match alias.map(clean_title) {
            Some(a) if a != title => format!("[[{title}{bar}{a}]]"),
            _ => format!("[[{title}]]"),
        }
    }

    /// Un file del vault: immagine o allegato. Se non si trova resta il suo nome, in corsivo.
    fn file_link(&mut self, target: &str, text: Option<&str>, embed: bool) -> String {
        let name = target.rsplit('/').next().unwrap_or(target).to_string();
        let Some(rel) = self.index.file(target, &self.from).map(String::from) else {
            if !self.missing.contains(&target.to_string()) {
                self.missing.push(target.to_string());
            }
            return format!("*{}*", text.unwrap_or(&name));
        };
        match self.files.attach(&rel) {
            Ok(a) if embed && is_image(&rel) => {
                let alt = text.unwrap_or("").replace(['[', ']', '\n'], " ");
                format!("![{}]({})", alt.trim(), a.path)
            }
            Ok(a) => {
                let label = text.unwrap_or(&a.name).replace(['[', ']', '\n'], " ");
                format!("[📎 {} ({})]({})", label.trim(), size_label(a.size), a.path)
            }
            Err(_) => format!("*{}*", text.unwrap_or(&name)),
        }
    }

    /// `[[bersaglio#titolo|alias]]`, o `![[…]]` se `embed`.
    fn wiki(&mut self, inner: &str, embed: bool) -> String {
        let inner = inner.replace("\\|", "|");
        let (target, alias) = match inner.split_once('|') {
            Some((t, a)) => (t, Some(a)),
            None => (inner.as_str(), None),
        };
        let (path, heading) = match target.split_once('#') {
            Some((p, h)) => (p, Some(h.trim_start_matches('^'))),
            None => (target, None),
        };
        if path.trim().is_empty() {
            // un link a un titolo della stessa nota: resta il testo
            return alias.or(heading).unwrap_or("").trim().to_string();
        }
        if is_file_target(path) && (self.index.file(path, &self.from).is_some() || self.index.note(path, &self.from).is_none()) {
            // in un'immagine incorporata, dopo la barra c'è la larghezza (`|300`): non è un testo
            let alias = alias.filter(|a| !a.trim().chars().all(|c| c.is_ascii_digit() || c == 'x'));
            return self.file_link(path.trim(), alias, embed);
        }
        self.note_link(path, alias)
    }

    /// `[testo](bersaglio)` e `![alt](bersaglio)` verso un file del vault. None se è un indirizzo
    /// esterno: il link resta com'è.
    fn md_link(&mut self, text: &str, target: &str, embed: bool) -> Option<String> {
        let target = target.trim();
        let target = target.strip_prefix('<').and_then(|t| t.strip_suffix('>')).unwrap_or(target);
        // un titolo dopo l'indirizzo: [x](file.png "titolo")
        let target = target.split(" \"").next().unwrap_or(target);
        if target.is_empty() || target.contains("://") || target.starts_with(['#', '/']) || target.starts_with("mailto:") || target.starts_with("attachments/") {
            return None;
        }
        let target = decode_percent(target);
        let path = target.split('#').next().unwrap_or(&target);
        let text = (!text.trim().is_empty()).then_some(text);
        if is_file_target(path) && (self.index.file(path, &self.from).is_some() || self.index.note(path, &self.from).is_none()) {
            return Some(self.file_link(path, text, embed));
        }
        Some(self.note_link(path, text))
    }
}

/// I tag scritti nel testo (`#progetto/alfa`): non le intestazioni, non `#123`.
fn collect_tags(text: &str, tags: &mut Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '#' && (i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(') {
            let start = i + 1;
            let mut end = start;
            while end < chars.len() && (chars[end].is_alphanumeric() || matches!(chars[end], '_' | '-' | '/')) {
                end += 1;
            }
            let tag: String = chars[start..end].iter().collect();
            if !tag.is_empty() && !tag.chars().all(|c| c.is_ascii_digit()) {
                tags.push(tag);
            }
            i = end;
        } else {
            i += 1;
        }
    }
}

/// Converte una riga: link, file incorporati, tag. Il codice tra apici resta com'è.
fn inline(line: &str, cx: &mut Cx) -> String {
    let mut out = String::with_capacity(line.len());
    let mut plain = String::new();
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        if c == '`' {
            let ticks = rest.len() - rest.trim_start_matches('`').len();
            let fence = &rest[..ticks];
            if let Some(close) = rest[ticks..].find(fence) {
                let end = ticks + close + ticks;
                out.push_str(&rest[..end]);
                rest = &rest[end..];
                continue;
            }
            out.push_str(fence);
            rest = &rest[ticks..];
            continue;
        }
        let embed = rest.starts_with("![[");
        if embed || rest.starts_with("[[") {
            let open = if embed { 3 } else { 2 };
            if let Some(close) = rest[open..].find("]]") {
                let inner = &rest[open..open + close];
                if !inner.contains('\n') && !inner.is_empty() {
                    out.push_str(&cx.wiki(inner, embed));
                    rest = &rest[open + close + 2..];
                    continue;
                }
            }
        }
        let embed = rest.starts_with("![");
        if embed || rest.starts_with('[') {
            let open = if embed { 2 } else { 1 };
            if let Some(close) = rest[open..].find("](") {
                let text = &rest[open..open + close];
                let after = &rest[open + close + 2..];
                if !text.contains(['[', ']']) {
                    if let Some(end) = after.find(')') {
                        if let Some(converted) = cx.md_link(text, &after[..end], embed) {
                            out.push_str(&converted);
                            rest = &after[end + 1..];
                            continue;
                        }
                        let whole = open + close + 2 + end + 1;
                        out.push_str(&rest[..whole]);
                        rest = &rest[whole..];
                        continue;
                    }
                }
            }
        }
        out.push(c);
        plain.push(c);
        rest = &rest[c.len_utf8()..];
    }
    collect_tags(&plain, &mut cx.tags);
    out
}

/// Il tipo di riquadro di Granello più vicino a un callout di Obsidian.
fn callout_kind(kind: &str) -> &'static str {
    match kind.to_lowercase().as_str() {
        "warning" | "caution" | "attention" | "failure" | "fail" | "missing" | "danger" | "error" | "bug" | "important" => "WARNING",
        "decision" => "DECISION",
        _ => "NOTE",
    }
}

/// `> [!tipo]+ Titolo`: tipo, piegabile, titolo.
fn callout_head(line: &str) -> Option<(&str, bool, &str)> {
    let rest = line.strip_prefix('>')?.trim_start();
    let rest = rest.strip_prefix("[!")?;
    let end = rest.find(']')?;
    let kind = &rest[..end];
    if kind.is_empty() || !kind.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    let after = &rest[end + 1..];
    let fold = after.starts_with(['-', '+']);
    let title = if fold { &after[1..] } else { after };
    Some((kind, fold, title.trim()))
}

/// Toglie i commenti `%%…%%`, anche su più righe. `open` dice se si è dentro un commento.
fn strip_comments(line: &str, open: &mut bool) -> String {
    let mut out = String::new();
    let mut rest = line;
    loop {
        if *open {
            match rest.find("%%") {
                Some(i) => {
                    *open = false;
                    rest = &rest[i + 2..];
                }
                None => return out,
            }
        } else {
            match rest.find("%%") {
                Some(i) => {
                    out.push_str(&rest[..i]);
                    *open = true;
                    rest = &rest[i + 2..];
                }
                None => {
                    out.push_str(rest);
                    return out;
                }
            }
        }
    }
}

/// Gli stati dei task che Granello non ha (`[/]`, `[-]`, `[>]`…) diventano task aperti.
fn task_state(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let body = &line[indent..];
    let marker = if body.starts_with(['-', '*', '+']) && body[1..].starts_with(' ') {
        2
    } else {
        let digits = body.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 && body[digits..].starts_with(['.', ')']) && body[digits + 1..].starts_with(' ') { digits + 2 } else { return line.to_string() }
    };
    let after = &body[marker..];
    let b = after.as_bytes();
    if b.len() >= 3 && b[0] == b'[' && b[2] == b']' && !matches!(b[1], b' ' | b'x' | b'X') && b[1].is_ascii() {
        return format!("{}{}[ ]{}", &line[..indent], &body[..marker], &after[3..]);
    }
    line.to_string()
}

/// `testo ^id-blocco` in fondo alla riga: il riferimento sparisce.
fn strip_block_id(line: &str) -> Option<String> {
    let trimmed = line.trim_end();
    if let Some(at) = trimmed.rfind('^') {
        let id = &trimmed[at + 1..];
        let before = &trimmed[..at];
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && (before.is_empty() || before.ends_with(' ')) {
            if before.trim().is_empty() {
                return None;
            }
            return Some(before.trim_end().to_string());
        }
    }
    Some(line.to_string())
}

/// Converte il testo di una nota Obsidian nel Markdown di Granello.
fn convert(body: &str, cx: &mut Cx) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut fence: Option<String> = None;
    let mut comment = false;
    let mut folding = false;
    for raw in body.lines() {
        if let Some(f) = &fence {
            out.push(raw.to_string());
            if raw.trim_start().starts_with(f.as_str()) && raw.trim().chars().all(|c| c == f.chars().next().unwrap()) {
                fence = None;
            }
            continue;
        }
        let was_comment = comment;
        let mut line = strip_comments(raw, &mut comment);
        if (was_comment || comment || raw.contains("%%")) && line.trim().is_empty() {
            continue;
        }
        if folding {
            if let Some(inner) = line.strip_prefix('>') {
                line = inner.strip_prefix(' ').unwrap_or(inner).to_string();
            } else {
                out.extend([String::new(), ":::".into(), String::new()]);
                folding = false;
            }
        }
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            let ch = t.chars().next().unwrap();
            fence = Some(t.chars().take_while(|c| *c == ch).collect());
            out.push(line);
            continue;
        }
        let Some(line) = strip_block_id(&line) else { continue };
        if !folding {
            if let Some((kind, fold, title)) = callout_head(&line) {
                if fold {
                    let title = if title.is_empty() { kind.to_string() } else { inline(title, cx) };
                    out.push(format!("::: details {title}"));
                    out.push(String::new());
                    folding = true;
                } else {
                    out.push(format!("> [!{}]", callout_kind(kind)));
                    if !title.is_empty() {
                        // un titolo già in grassetto non va chiuso in un altro grassetto
                        let bare = title.strip_prefix("**").and_then(|t| t.strip_suffix("**")).unwrap_or(title);
                        out.push(format!("> **{}**", inline(bare.trim(), cx)));
                    }
                }
                continue;
            }
        }
        cx.in_table = line.trim_start().starts_with('|');
        out.push(inline(&task_state(&line), cx));
        cx.in_table = false;
    }
    if folding {
        out.extend([String::new(), ":::".into()]);
    }
    let mut text = out.join("\n");
    while text.contains("\n\n\n") {
        text = text.replace("\n\n\n", "\n\n");
    }
    text.trim().to_string() + "\n"
}

/// Molte note iniziano con `# Titolo`, ripetendo il nome del file: in Granello il titolo c'è già.
fn drop_title_heading(body: &str, title: &str, stem: &str) -> String {
    let first = body.lines().next().unwrap_or("");
    if let Some(h) = first.strip_prefix("# ") {
        let h = h.trim();
        if h.eq_ignore_ascii_case(title) || h.eq_ignore_ascii_case(stem) {
            return body[first.len()..].trim_start().to_string();
        }
    }
    body.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("granello-obs-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, text: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Un piccolo vault con tutto quello che va convertito.
    fn vault(root: &Path) {
        write(root, ".obsidian/app.json", b"{}");
        write(root, ".obsidian/templates.json", br#"{"folder":"Templates"}"#);
        write(root, "Templates/Riunione.md", b"# {{title}}\n{{date}}");
        write(
            root,
            "Lavoro/Clienti/Acme.md",
            "---\ntags: [cliente, Vendite]\naliases:\n  - ACME SA\nstatus: attivo\ncreated: 2024-03-05\n---\n# Acme\n\n\
             Contatto con [[Mario Rossi|Mario]] e [[Nota mancante]], vedi [[Acme#Storia]].\n\
             > [!tip] Da ricordare\n> Pagano a 60 giorni\n\n\
             > [!faq]- Domande\n> - [?] chiedere lo sconto\n\n\
             ![[schema.png|300]] e ![[contratto.pdf]] %%nota privata%% ^abc123\n\
             Link markdown: [il contratto](../../contratto.pdf) e [Mario](<Persone/Mario Rossi.md>)\n\
             #progetto/alfa #42\n\n```dataview\nLIST FROM [[Acme]]\n```\n%%\nriga nascosta\n%%\nfine\n"
                .as_bytes(),
        );
        write(root, "Persone/Mario Rossi.md", b"Mario lavora da [[ACME SA]].\n");
        write(root, "2024-03-07.md", b"Nota del giorno, ![[mancante.png]]\n");
        write(root, "schema.png", b"\x89PNG finto");
        write(root, "contratto.pdf", b"%PDF finto");
        write(root, "Archivio/vecchio.pdf", b"%PDF sciolto");
        write(root, "mappa.canvas", b"{}");
    }

    #[test]
    fn converts_an_obsidian_vault() {
        let root = temp_dir("vault");
        vault(&root);
        let p = prepare(&root, &HashMap::new(), None).unwrap();
        let s = &p.summary;
        assert!(s.obsidian);
        assert_eq!(s.notes, 3, "{:?}", p.notes.iter().map(|n| &n.source_path).collect::<Vec<_>>());
        assert_eq!((s.attachments, s.loose), (2, 1));
        assert_eq!(s.projects, ["Lavoro", "Persone"]);
        assert_eq!(s.missing_links, 1);
        let reasons: Vec<&str> = s.skipped.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(reasons, ["Templates/", "mancante.png", "mappa.canvas"]);

        let acme = p.notes.iter().find(|n| n.title == "Acme").unwrap();
        assert_eq!(acme.project.as_deref(), Some("Lavoro"));
        assert_eq!(acme.tags, ["obsidian", "clienti", "cliente", "vendite", "progetto/alfa"]);
        assert_eq!(acme.created_at, parse_date("2024-03-05").unwrap());
        let md = &acme.notes_md;
        assert!(md.starts_with("::: details "), "{md}");
        assert!(md.contains("| aliases | ACME SA |") && md.contains("| status | attivo |") && !md.contains("| tags |"), "{md}");
        assert!(!md.contains("# Acme"), "il titolo ripetuto sparisce: {md}");
        assert!(md.contains("[[Mario Rossi|Mario]] e [[Nota mancante]], vedi [[Acme]]."), "{md}");
        assert!(md.contains("> [!NOTE]\n> **Da ricordare**\n> Pagano a 60 giorni"), "{md}");
        assert!(md.contains("::: details Domande\n\n- [ ] chiedere lo sconto\n\n:::"), "{md}");
        assert!(md.contains("![](attachments/preview) e [📎 contratto.pdf (1 KB)](attachments/preview)\n"), "{md}");
        assert!(!md.contains("nota privata") && !md.contains("riga nascosta") && !md.contains("^abc123"), "{md}");
        assert!(md.contains("[📎 il contratto (1 KB)](attachments/preview) e [[Mario Rossi|Mario]]"), "{md}");
        assert!(md.contains("```dataview\nLIST FROM [[Acme]]\n```"), "il codice resta com'è: {md}");

        let mario = p.notes.iter().find(|n| n.title == "Mario Rossi").unwrap();
        assert_eq!(mario.notes_md, "Mario lavora da [[Acme]].\n", "l'alias porta alla nota");
        let daily = p.notes.iter().find(|n| n.source_path == "2024-03-07.md").unwrap();
        assert_eq!(daily.project, None);
        assert_eq!(daily.created_at, parse_date("2024-03-07").unwrap());
        assert_eq!(daily.notes_md, "Nota del giorno, *mancante.png*\n");
        assert_eq!(p.files[0].folder, "Archivio");
        assert!(p.copied.is_empty(), "il riepilogo non copia niente");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copies_files_and_never_touches_the_vault() {
        let root = temp_dir("copy");
        let data = temp_dir("copy-data");
        vault(&root);
        let snapshot = |dir: &Path| {
            let mut all = Vec::new();
            walk(dir, dir, &[], &mut all).unwrap();
            all.into_iter().map(|rel| (std::fs::read(dir.join(&rel)).unwrap(), rel)).collect::<Vec<_>>()
        };
        let before = snapshot(&root);
        let p = prepare(&root, &HashMap::new(), Some(&data)).unwrap();
        assert_eq!(p.copied.len(), 3, "schema, contratto e il pdf sciolto, una volta ciascuno");
        for path in &p.copied {
            assert!(attachments::resolve(&data, path).is_ok());
        }
        let acme = p.notes.iter().find(|n| n.title == "Acme").unwrap();
        assert_eq!(attachments::referenced(&acme.notes_md).len(), 2);
        assert_eq!(snapshot(&root), before, "il vault Obsidian resta com'era");
        assert!(!root.join(".obsidian/workspace.json").exists());

        // la seconda volta le note già importate si saltano; una cambiata finisce nel rapporto
        let already: HashMap<String, String> = p
            .notes
            .iter()
            .map(|n| (n.source_path.clone(), n.source_hash.clone()))
            .chain(p.files.iter().map(|f| (f.source_path.clone(), String::new())))
            .collect();
        write(&root, "Persone/Mario Rossi.md", b"Cambiata\n");
        let again = prepare(&root, &already, None).unwrap();
        assert_eq!((again.summary.notes, again.summary.already, again.summary.loose), (0, 3, 0));
        assert_eq!(again.summary.changed, ["Persone/Mario Rossi.md"]);
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn understands_para_folders_and_meeting_properties() {
        let root = temp_dir("para");
        write(&root, ".obsidian/app.json", b"{}");
        write(&root, "_templates/Meeting.md", b"---\ndate: {{date}}\n---\n");
        write(&root, "Untitled.base", b"views: []");
        write(&root, "Areas/Dev/Guida.md", b"> [!tip] **Come usarla**\n> Leggi prima\n");
        write(
            &root,
            "Projects/EOC/EocForms/Riunione Kickoff 5.7.2025.md",
            b"---\ndate: 2025-07-05\npartecipanti:\n  - \"[[Mario Rossi|Mario]]\"\n  - Giulia Ferri\nnote:\nstatus: aperto\n---\nKickoff\n",
        );
        write(&root, "Projects/EOC/Notes.md", b"Vedi [[Riunione Kickoff 5.7.2025]] e [[Intro|l'intro]].\n\n| A | B |\n| --- | --- |\n| [[Intro\\|guida]] | [[Intro]] |\n");
        write(&root, "Resources/Effect/Intro.md", b"---\nprogetto: \"[[Formazione]]\"\n---\nTesto\n");
        write(&root, "4 - Archive/Vecchio/Chiuso.md", b"Fatto\n");
        write(&root, "_daily/2026-11-20.md", b"Oggi\n");

        let p = prepare(&root, &HashMap::new(), None).unwrap();
        let note = |path: &str| p.notes.iter().find(|n| n.source_path == path).unwrap();
        let skipped: Vec<&str> = p.summary.skipped.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(skipped, ["Untitled.base", "_templates/"]);
        assert_eq!((p.summary.notes, p.summary.loose), (6, 0));

        let kickoff = note("Projects/EOC/EocForms/Riunione Kickoff 5.7.2025.md");
        assert_eq!(kickoff.project.as_deref(), Some("EOC"));
        assert_eq!(kickoff.tags[..3], ["obsidian", "projects", "eocforms"]);
        assert_eq!(kickoff.attendees, ["Mario Rossi", "Giulia Ferri"]);
        assert_eq!(kickoff.created_at, parse_date("2025-07-05").unwrap());
        assert!(kickoff.notes_md.contains("| status | aperto |"), "{}", kickoff.notes_md);
        assert!(!kickoff.notes_md.contains("| date |") && !kickoff.notes_md.contains("| note |"), "{}", kickoff.notes_md);
        assert_eq!(
            note("Projects/EOC/Notes.md").notes_md,
            "Vedi [[Riunione Kickoff 5.7.2025]] e [[Intro|l'intro]].\n\n| A | B |\n| --- | --- |\n| [[Intro\\|guida]] | [[Intro]] |\n",
            "in una tabella la barra del link resta `\\|`"
        );
        assert_eq!(p.summary.missing_links, 0, "una nota con il punto nel nome non è un file");

        let intro = note("Resources/Effect/Intro.md");
        assert_eq!(intro.project.as_deref(), Some("Formazione"), "la proprietà vince sulla cartella");
        assert!(!intro.notes_md.contains("::: details"), "{}", intro.notes_md);
        let old = note("4 - Archive/Vecchio/Chiuso.md");
        assert_eq!((old.project.as_deref(), old.archived_project), (Some("Vecchio"), true));
        assert_eq!(old.tags[1], "archive");
        let daily = note("_daily/2026-11-20.md");
        assert_eq!((daily.project.as_deref(), daily.tags[1].as_str()), (None, "daily"));
        assert_eq!(note("Areas/Dev/Guida.md").notes_md, "> [!NOTE]\n> **Come usarla**\n> Leggi prima\n");
        assert_eq!(p.summary.projects, ["Dev", "EOC", "Formazione", "Vecchio"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn reads_frontmatter() {
        let (props, start) = frontmatter("---\ntitle: \"Il: titolo\"\ntags:\n  - a\n  - 'b c'\nempty:\nnested:\n  x: 1\n---\ncorpo");
        assert_eq!(&"---\ntitle: \"Il: titolo\"\ntags:\n  - a\n  - 'b c'\nempty:\nnested:\n  x: 1\n---\ncorpo"[start..], "corpo");
        assert_eq!(props[0], ("title".into(), Prop::Text("Il: titolo".into())));
        assert_eq!(props[1], ("tags".into(), Prop::List(vec!["a".into(), "b c".into()])));
        assert_eq!(props[2], ("empty".into(), Prop::Text(String::new())));
        assert_eq!(props[3], ("nested".into(), Prop::Text("x: 1".into())));
        assert_eq!(frontmatter("---\nsenza chiusura").1, 0);
        assert_eq!(frontmatter("testo").0, vec![]);
    }

    #[test]
    fn small_conversions() {
        assert_eq!(task_state("  - [/] a metà"), "  - [ ] a metà");
        assert_eq!(task_state("1. [>] rimandato"), "1. [ ] rimandato");
        assert_eq!(task_state("- [x] fatto"), "- [x] fatto");
        assert_eq!(task_state("- [link](x)"), "- [link](x)");
        assert_eq!(strip_block_id("testo ^a1-b2"), Some("testo".into()));
        assert_eq!(strip_block_id("^solo"), None);
        assert_eq!(strip_block_id("2^10 resta"), Some("2^10 resta".into()));
        assert_eq!(callout_kind("danger"), "WARNING");
        assert_eq!(callout_kind("abstract"), "NOTE");
        let mut tags = Vec::new();
        collect_tags("# Titolo #uno, (#due) c#tre #4 #è-ok", &mut tags);
        assert_eq!(tags, ["uno", "due", "è-ok"]);
        assert_eq!(date_in("Diario 2024-02-29 sera"), parse_date("2024-02-29"));
        assert_eq!(date_in("2024-13-01"), None);
        assert_eq!(decode_percent("Mario%20Rossi.md"), "Mario Rossi.md");
        assert_eq!(joined("a/b/nota.md", "../c.png").as_deref(), Some("a/c.png"));
        assert_eq!(joined("nota.md", "../fuori.png"), None);
        assert!(reserved("TOC") && reserved("rating:3") && !reserved("Toccata"));
        assert_eq!(clean_title("A [b] | c"), "A (b) - c");
    }
}
