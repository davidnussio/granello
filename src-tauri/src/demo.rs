//! Dati di esempio: una manciata di meeting inventati ma realistici, per vedere cosa sa fare
//! Granello senza aspettare di averne registrati di propri. I testi stanno in `demo/it.txt` e
//! `demo/en.txt`, in un formato semplice da leggere e modificare a mano:
//!
//! ```text
//! projects: clienti/cliente-nord, app-mobile   (`clienti/…`: un progetto dentro un altro)
//! archived: sito-2025
//! group: clienti/nord | Nord | team | Marco Bianchi, Paolo Greco
//!                       (percorso | nome | team o audience | membri: un gruppo dentro un altro)
//!
//! === demo-rinnovo
//! title: Rinnovo contratto 2027
//! when: 1 10:00          (giorni fa, ora di inizio)
//! minutes: 42
//! attendees: Marco Bianchi, Elena Rossi
//! tags: cliente-nord, prezzi
//! groups: nord           (facoltativo: l'ultima parte del percorso dei gruppi)
//! pinned: yes            (facoltativo: fissato in cima alla barra laterale)
//! --- notes
//! …Markdown; {{date:+7}} diventa la data di oggi più sette giorni…
//! --- enhanced
//! …Markdown delle note AI…
//! --- transcript
//! 00:12 them Buongiorno a tutti.
//! ```

use crate::i18n::Lang;
use anyhow::{anyhow, bail, Result};
use chrono::{Duration, Local, NaiveTime, TimeZone};

/// Tutti i meeting di esempio hanno un id con questo prefisso: è così che si riconoscono per toglierli.
pub const ID_PREFIX: &str = "demo-";

/// Tag aggiunto a ogni meeting di esempio, oltre ai suoi: li si riconosce e li si filtra a colpo d'occhio.
pub const TAG: &str = "faker";

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DemoSegment {
    pub source: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DemoMeeting {
    pub id: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub attendees: Vec<String>,
    pub tags: Vec<String>,
    /// Chiavi dei gruppi presenti (l'ultima parte del percorso).
    pub groups: Vec<String>,
    pub notes_md: String,
    pub enhanced_md: Option<String>,
    pub segments: Vec<DemoSegment>,
    /// Fissato in cima alla barra laterale.
    pub pinned: bool,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DemoGroup {
    /// L'ultima parte del percorso: `nord` in `clienti/nord`.
    pub key: String,
    /// La chiave del gruppo che lo contiene.
    pub parent: Option<String>,
    pub name: String,
    pub kind: crate::models::GroupKind,
    pub members: Vec<String>,
}

impl DemoGroup {
    /// L'id del gruppo nel database: comincia anche lui con `ID_PREFIX`.
    pub fn id(key: &str) -> String {
        format!("{ID_PREFIX}group-{key}")
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DemoData {
    /// Tag da mostrare come progetti attivi. `clienti/cliente-nord`: il progetto del tag
    /// `cliente-nord` sta dentro il progetto `clienti`.
    pub projects: Vec<String>,
    /// Tag da mostrare come progetti archiviati.
    pub archived: Vec<String>,
    /// I gruppi, ogni genitore prima dei suoi figli.
    pub groups: Vec<DemoGroup>,
    pub meetings: Vec<DemoMeeting>,
}

impl DemoData {
    /// Tutte le persone che compaiono nei meeting di esempio.
    pub fn people(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .meetings
            .iter()
            .flat_map(|m| m.attendees.clone())
            .chain(self.groups.iter().flat_map(|g| g.members.clone()))
            .collect();
        names.sort();
        names.dedup();
        names
    }
}

/// I dati di esempio nella lingua dell'interfaccia, con le date calcolate a partire da adesso.
pub fn load(lang: Lang) -> Result<DemoData> {
    let text = match lang {
        Lang::It => include_str!("../demo/it.txt"),
        Lang::En => include_str!("../demo/en.txt"),
    };
    let mut data = parse(text, Local::now().timestamp_millis())?;
    for m in &mut data.meetings {
        if !m.tags.iter().any(|t| t == TAG) {
            m.tags.push(TAG.into());
        }
    }
    Ok(data)
}

fn list(value: &str) -> Vec<String> {
    value.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

/// "mm:ss" in millisecondi.
fn clock(text: &str) -> Option<i64> {
    let (m, s) = text.split_once(':')?;
    Some((m.parse::<i64>().ok()? * 60 + s.parse::<i64>().ok()?) * 1000)
}

/// Sostituisce `{{date:+7}}` e `{{date:-3}}` con la data (AAAA-MM-GG) a quei giorni da oggi.
fn fill_dates(text: &str, now_ms: i64) -> String {
    let today = Local.timestamp_millis_opt(now_ms).single().map(|d| d.date_naive()).unwrap_or_default();
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{date:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 7..];
        let Some(end) = after.find("}}") else { break };
        let days: i64 = after[..end].trim().parse().unwrap_or(0);
        out.push_str(&(today + Duration::days(days)).format("%Y-%m-%d").to_string());
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

pub fn parse(text: &str, now_ms: i64) -> Result<DemoData> {
    let text = fill_dates(text, now_ms);
    let today = Local.timestamp_millis_opt(now_ms).single().ok_or_else(|| anyhow!("data non valida"))?.date_naive();
    let mut data = DemoData::default();
    let mut current: Option<DemoMeeting> = None;
    let mut minutes = 30i64;
    // "" = intestazione del meeting, altrimenti notes / enhanced / transcript
    let mut section = String::new();
    let mut body = String::new();

    fn close_section(m: &mut DemoMeeting, section: &str, body: &str) -> Result<()> {
        let body = body.trim();
        match section {
            "notes" => m.notes_md = body.to_string(),
            "enhanced" => m.enhanced_md = Some(body.to_string()).filter(|b| !b.is_empty()),
            "transcript" => {
                for line in body.lines().filter(|l| !l.trim().is_empty()) {
                    let mut parts = line.trim().splitn(3, ' ');
                    let (Some(at), Some(source), Some(text)) = (parts.next(), parts.next(), parts.next()) else {
                        bail!("riga di trascrizione non valida in {}: {line}", m.id);
                    };
                    let start_ms = clock(at).ok_or_else(|| anyhow!("orario non valido in {}: {at}", m.id))?;
                    // circa 15 caratteri al secondo, come il parlato
                    let end_ms = start_ms + (text.chars().count() as i64 * 1000 / 15).max(1500);
                    m.segments.push(DemoSegment { source: source.into(), start_ms, end_ms, text: text.trim().into() });
                }
            }
            _ => {}
        }
        Ok(())
    }

    for line in text.lines() {
        if let Some(id) = line.strip_prefix("=== ") {
            if let Some(mut m) = current.take() {
                close_section(&mut m, &section, &body)?;
                data.meetings.push(m);
            }
            let id = id.trim();
            if !id.starts_with(ID_PREFIX) {
                bail!("l'id {id} non comincia con {ID_PREFIX}");
            }
            current = Some(DemoMeeting { id: id.into(), ..Default::default() });
            minutes = 30;
            section.clear();
            body.clear();
            continue;
        }
        let Some(m) = current.as_mut() else {
            // prima del primo meeting: quali tag sono progetti
            if let Some(v) = line.strip_prefix("projects:") {
                data.projects = list(v);
            } else if let Some(v) = line.strip_prefix("archived:") {
                data.archived = list(v);
            } else if let Some(v) = line.strip_prefix("group:") {
                let parts: Vec<&str> = v.split('|').map(str::trim).collect();
                let [path, name, kind, members] = parts[..] else { bail!("gruppo non valido: {v}") };
                let mut keys: Vec<&str> = path.split('/').collect();
                let key = keys.pop().unwrap_or_default().to_string();
                let parent = keys.pop().map(String::from);
                if parent.as_ref().is_some_and(|p| !data.groups.iter().any(|g| &g.key == p)) {
                    bail!("il gruppo {key} sta dentro un gruppo non ancora definito");
                }
                data.groups.push(DemoGroup {
                    key,
                    parent,
                    name: name.into(),
                    kind: crate::models::GroupKind::parse(kind),
                    members: list(members),
                });
            }
            continue;
        };
        if let Some(name) = line.strip_prefix("--- ") {
            close_section(m, &section, &body)?;
            section = name.trim().to_string();
            body.clear();
            continue;
        }
        if !section.is_empty() {
            body.push_str(line);
            body.push('\n');
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match key.trim() {
            "title" => m.title = value.into(),
            "attendees" => m.attendees = list(value),
            "tags" => m.tags = list(value),
            "groups" => m.groups = list(value),
            "pinned" => m.pinned = value == "yes",
            "minutes" => minutes = value.parse().unwrap_or(30),
            "when" => {
                let (days, at) = value.split_once(' ').ok_or_else(|| anyhow!("when non valido in {}: {value}", m.id))?;
                let days: i64 = days.parse().map_err(|_| anyhow!("giorni non validi in {}: {days}", m.id))?;
                let at = NaiveTime::parse_from_str(at.trim(), "%H:%M").map_err(|_| anyhow!("ora non valida in {}: {at}", m.id))?;
                let start = Local
                    .from_local_datetime(&(today - Duration::days(days)).and_time(at))
                    .earliest()
                    .ok_or_else(|| anyhow!("data non valida in {}", m.id))?;
                m.started_at = start.timestamp_millis();
            }
            _ => {}
        }
        m.ended_at = m.started_at + minutes * 60_000;
    }
    if let Some(mut m) = current.take() {
        close_section(&mut m, &section, &body)?;
        data.meetings.push(m);
    }
    for m in &data.meetings {
        if m.title.is_empty() || m.started_at == 0 {
            bail!("al meeting {} manca il titolo o la data", m.id);
        }
        if let Some(g) = m.groups.iter().find(|g| !data.groups.iter().any(|d| &d.key == *g)) {
            bail!("il meeting {} cita il gruppo {g}, che non è definito", m.id);
        }
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_readable_format() {
        let now = Local.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap().timestamp_millis();
        let data = parse(
            "projects: nord\narchived: sito\n\n=== demo-a\ntitle: Rinnovo\nwhen: 1 10:00\nminutes: 40\nattendees: Marco, Elena\ntags: nord, prezzi\npinned: yes\n\
--- notes\n# Prezzo\nScade il [[{{date:+7}}]]\n--- enhanced\nNote AI\n--- transcript\n00:12 them Buongiorno a tutti.\n01:05 me Cominciamo.\n\
=== demo-b\ntitle: Altro\nwhen: 0 09:30\n--- notes\nciao\n",
            now,
        )
        .unwrap();
        assert_eq!(data.projects, vec!["nord"]);
        assert_eq!(data.archived, vec!["sito"]);
        let a = &data.meetings[0];
        assert_eq!(a.attendees, vec!["Marco", "Elena"]);
        assert_eq!(a.notes_md, "# Prezzo\nScade il [[2026-11-27]]");
        assert_eq!(a.enhanced_md.as_deref(), Some("Note AI"));
        assert_eq!(a.ended_at - a.started_at, 40 * 60_000);
        assert_eq!(Local.timestamp_millis_opt(a.started_at).unwrap().format("%Y-%m-%d %H:%M").to_string(), "2026-11-19 10:00");
        assert_eq!((a.segments[1].source.as_str(), a.segments[1].start_ms), ("me", 65_000));
        assert_eq!(data.meetings[1].enhanced_md, None);
        assert!(a.pinned && !data.meetings[1].pinned);
        assert_eq!(data.people(), vec!["Elena", "Marco"]);
        assert!(parse("=== altro\ntitle: x\nwhen: 0 10:00\n", now).is_err());
    }

    #[test]
    fn parses_groups_inside_groups() {
        let now = Local.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap().timestamp_millis();
        let text = "group: clienti | Clienti | audience |\ngroup: clienti/nord | Nord | team | Marco, Paolo\n\n\
=== demo-a\ntitle: Rinnovo\nwhen: 1 10:00\nattendees: Marco\ngroups: nord\n--- notes\nciao\n";
        let data = parse(text, now).unwrap();
        assert_eq!(data.groups.len(), 2);
        let nord = &data.groups[1];
        assert_eq!((nord.key.as_str(), nord.parent.as_deref(), nord.name.as_str()), ("nord", Some("clienti"), "Nord"));
        assert_eq!(nord.kind, crate::models::GroupKind::Team);
        assert_eq!(data.groups[0].kind, crate::models::GroupKind::Audience);
        assert_eq!(data.meetings[0].groups, vec!["nord"]);
        assert_eq!(data.people(), vec!["Marco", "Paolo"]);
        // un gruppo che non c'è, o un genitore definito dopo il figlio
        assert!(parse(&text.replace("groups: nord", "groups: lago"), now).is_err());
        assert!(parse("group: a/b | B | team | x\ngroup: a | A | team |\n", now).is_err());
    }

    #[test]
    fn shipped_demo_data_is_valid() {
        for lang in [Lang::It, Lang::En] {
            let data = load(lang).unwrap();
            assert!(data.meetings.len() >= 50, "{lang:?}: {} meeting", data.meetings.len());
            assert!(data.meetings.iter().all(|m| m.tags.last().map(String::as_str) == Some(TAG)), "manca #{TAG} ({lang:?})");
            let mut ids: Vec<&str> = data.meetings.iter().map(|m| m.id.as_str()).collect();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), data.meetings.len(), "id ripetuti ({lang:?})");
            for m in &data.meetings {
                assert!(!m.notes_md.is_empty(), "{} senza note", m.id);
                assert!(!m.notes_md.contains("{{"), "{} ha una data non sostituita", m.id);
                assert!(m.segments.windows(2).all(|w| w[0].start_ms < w[1].start_ms), "{} trascrizione non in ordine", m.id);
            }
            // ogni gruppo con dei membri compare in almeno una nota, con gli stessi membri nelle
            // due lingue (un gruppo senza membri fa solo da contenitore)
            for g in data.groups.iter().filter(|g| !g.members.is_empty()) {
                assert!(data.meetings.iter().any(|m| m.groups.contains(&g.key)), "nessun meeting per {} ({lang:?})", g.key);
            }
            let other = load(if lang == Lang::It { Lang::En } else { Lang::It }).unwrap();
            let shape = |d: &DemoData| d.groups.iter().map(|g| (g.key.clone(), g.members.clone())).collect::<Vec<_>>();
            assert_eq!(shape(&data), shape(&other), "gruppi diversi tra le lingue");
            // ogni progetto ha almeno un meeting, altrimenti nella Libreria resta vuoto
            for path in data.projects.iter().chain(&data.archived) {
                let tag = path.rsplit('/').next().unwrap().to_string();
                assert!(data.meetings.iter().any(|m| m.tags.contains(&tag)), "nessun meeting per {tag} ({lang:?})");
            }
        }
    }
}
