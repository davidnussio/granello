//! Calendario via URL iCal (es. "Indirizzo segreto in formato iCal" di Google Calendar,
//! o la pubblicazione ICS di Outlook). Supporta eventi ricorrenti, EXDATE e override.

use crate::i18n::tr;
use crate::models::CalendarEvent;
use anyhow::Result;
use chrono::{DateTime, Duration, NaiveDateTime, TimeZone, Utc};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default, Clone)]
struct Prop {
    params: HashMap<String, String>,
    value: String,
}

#[derive(Debug, Default)]
struct RawEvent {
    props: HashMap<String, Vec<Prop>>,
}

impl RawEvent {
    fn first(&self, k: &str) -> Option<&Prop> {
        self.props.get(k).and_then(|v| v.first())
    }
    fn all(&self, k: &str) -> &[Prop] {
        self.props.get(k).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

/// Un feed iCal più grande di così è quasi certamente un errore (o un abuso).
const MAX_ICS_BYTES: usize = 20 * 1024 * 1024;

pub async fn fetch_ics(client: &reqwest::Client, url: &str) -> Result<String> {
    use futures_util::StreamExt;
    // webcal:// è solo https:// con un altro nome
    let url = url.trim().replacen("webcal://", "https://", 1);
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        // l'URL iCal è segreto: non deve finire nei messaggi di errore né nei log
        .map_err(|e| tra!("download calendario fallito: {}", "calendar download failed: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(tra!("download calendario fallito: {}", "calendar download failed: {}", resp.status()));
    }
    let mut body: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| tra!("download calendario interrotto: {}", "calendar download interrupted: {}", e.without_url()))?;
        if body.len() + chunk.len() > MAX_ICS_BYTES {
            return Err(tra!("il calendario supera i 20 MB", "the calendar is larger than 20 MB"));
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&body).into_owned();
    if !text.contains("BEGIN:VCALENDAR") {
        return Err(tra!("l'URL non restituisce un calendario iCal", "the URL does not return an iCal calendar"));
    }
    Ok(text)
}

fn unfold(ics: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let raw = raw.trim_end_matches('\r');
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&raw[1..]);
        } else {
            lines.push(raw.to_string());
        }
    }
    lines
}

fn parse_line(line: &str) -> Option<(String, Prop)> {
    // NAME;PARAM=V;PARAM="V:x":VALUE  (i ':' tra virgolette non separano)
    let mut in_quotes = false;
    let mut split = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                split = Some(i);
                break;
            }
            _ => {}
        }
    }
    let i = split?;
    let (head, value) = (&line[..i], &line[i + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let mut params = HashMap::new();
    for p in parts {
        if let Some((k, v)) = p.split_once('=') {
            params.insert(k.to_ascii_uppercase(), v.trim_matches('"').to_string());
        }
    }
    Some((name, Prop { params, value: value.to_string() }))
}

fn parse_events(ics: &str) -> Vec<RawEvent> {
    let mut events = Vec::new();
    let mut cur: Option<RawEvent> = None;
    let mut depth_other = 0; // es. VALARM dentro VEVENT
    for line in unfold(ics) {
        let upper = line.to_ascii_uppercase();
        if upper == "BEGIN:VEVENT" {
            cur = Some(RawEvent::default());
            depth_other = 0;
            continue;
        }
        if upper == "END:VEVENT" {
            if let Some(e) = cur.take() {
                events.push(e);
            }
            continue;
        }
        let Some(ev) = cur.as_mut() else { continue };
        if upper.starts_with("BEGIN:") {
            depth_other += 1;
            continue;
        }
        if upper.starts_with("END:") {
            depth_other -= 1;
            continue;
        }
        if depth_other > 0 {
            continue;
        }
        if let Some((name, prop)) = parse_line(&line) {
            ev.props.entry(name).or_default().push(prop);
        }
    }
    events
}

fn unescape(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Zone {
    Utc,
    Named(chrono_tz::Tz),
    Local,
}

/// Ritorna (istante UTC, zona, data/ora locale) oppure None per eventi "tutto il giorno".
fn parse_dt(p: &Prop) -> Option<(DateTime<Utc>, Zone, NaiveDateTime)> {
    if p.params.get("VALUE").map(|v| v == "DATE").unwrap_or(false) || p.value.len() == 8 {
        return None;
    }
    let v = p.value.trim();
    let (v, utc) = match v.strip_suffix('Z') {
        Some(s) => (s, true),
        None => (v, false),
    };
    let naive = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    if utc {
        return Some((Utc.from_utc_datetime(&naive), Zone::Utc, naive));
    }
    if let Some(tz) = p.params.get("TZID").and_then(|t| t.parse::<chrono_tz::Tz>().ok()) {
        let dt = tz.from_local_datetime(&naive).earliest()?;
        return Some((dt.with_timezone(&Utc), Zone::Named(tz), naive));
    }
    let dt = chrono::Local.from_local_datetime(&naive).earliest()?;
    Some((dt.with_timezone(&Utc), Zone::Local, naive))
}

fn parse_dt_list(p: &Prop) -> Vec<DateTime<Utc>> {
    p.value
        .split(',')
        .filter_map(|v| parse_dt(&Prop { params: p.params.clone(), value: v.to_string() }))
        .map(|(u, _, _)| u)
        .collect()
}

fn parse_duration(s: &str) -> Option<Duration> {
    // PT1H30M, P1D, PT45M
    let s = s.trim().trim_start_matches('+');
    let s = s.strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += match (c, in_time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(total)
}

/// Un invitato che non è una persona: una mailing list (`CUTYPE=GROUP`), una sala o un oggetto.
fn not_a_person(a: &Prop) -> bool {
    a.params
        .get("CUTYPE")
        .is_some_and(|t| ["GROUP", "RESOURCE", "ROOM"].iter().any(|k| t.eq_ignore_ascii_case(k)))
}

/// Gli indirizzi di tutti gli invitati, minuscoli, comprese le mailing list.
fn invitee_emails(e: &RawEvent) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for a in e.all("ATTENDEE") {
        let email = a.value.trim().trim_start_matches("mailto:").trim_start_matches("MAILTO:").to_lowercase();
        if email.contains('@') && !out.contains(&email) {
            out.push(email);
        }
    }
    out
}

/// Partecipanti di un evento come (nome da mostrare, email se presente). Le mailing list e le
/// sale non sono persone: restano fuori.
fn attendee_pairs(e: &RawEvent) -> Vec<(String, Option<String>)> {
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    for a in e.all("ATTENDEE").iter().filter(|a| !not_a_person(a)) {
        let email = a.value.trim().trim_start_matches("mailto:").trim_start_matches("MAILTO:");
        let name = a
            .params
            .get("CN")
            .cloned()
            .filter(|cn| !cn.is_empty() && cn != email)
            .unwrap_or_else(|| email.to_string());
        if !name.is_empty() && !out.iter().any(|(n, _)| *n == name) {
            out.push((name, Some(email.to_string()).filter(|e| e.contains('@'))));
        }
    }
    out
}

/// Tutte le persone che compaiono come partecipanti nel calendario (senza doppioni),
/// per proporle nel completamento automatico.
pub fn all_attendees(ics: &str) -> Vec<(String, Option<String>)> {
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    for e in parse_events(ics) {
        for (name, email) in attendee_pairs(&e) {
            if !out.iter().any(|(n, _)| n.eq_ignore_ascii_case(&name)) {
                out.push((name, email));
            }
        }
    }
    out
}

/// Espande gli eventi nell'intervallo [from, to).
pub fn events_between(ics: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<CalendarEvent> {
    let raw = parse_events(ics);

    // UID -> istanti originali sostituiti da un override (RECURRENCE-ID)
    let mut overridden: HashMap<String, HashSet<i64>> = HashMap::new();
    for e in &raw {
        if let (Some(uid), Some(rid)) = (e.first("UID"), e.first("RECURRENCE-ID")) {
            if let Some((u, _, _)) = parse_dt(rid) {
                overridden.entry(uid.value.clone()).or_default().insert(u.timestamp());
            }
        }
    }

    let mut out = Vec::new();
    for e in &raw {
        if e.first("STATUS").map(|s| s.value.eq_ignore_ascii_case("CANCELLED")).unwrap_or(false) {
            continue;
        }
        let Some(dtstart) = e.first("DTSTART") else { continue };
        let Some((start, zone, naive)) = parse_dt(dtstart) else { continue }; // tutto il giorno
        let uid = e.first("UID").map(|u| u.value.clone()).unwrap_or_default();
        let dur = e
            .first("DTEND")
            .and_then(parse_dt)
            .map(|(end, _, _)| end - start)
            .or_else(|| e.first("DURATION").and_then(|d| parse_duration(&d.value)))
            .unwrap_or_else(|| Duration::hours(1));
        let title = e
            .first("SUMMARY")
            .map(|s| unescape(&s.value))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| tr("(senza titolo)", "(untitled)").into());
        let location = e.first("LOCATION").map(|l| unescape(&l.value)).filter(|l| !l.is_empty());
        let pairs = attendee_pairs(e);
        let people: Vec<String> = pairs.iter().map(|(n, _)| n.clone()).collect();
        let emails = invitee_emails(e);

        let starts: Vec<DateTime<Utc>> = match e.first("RRULE") {
            Some(rule) if e.first("RECURRENCE-ID").is_none() => {
                let exdates: HashSet<i64> = e
                    .all("EXDATE")
                    .iter()
                    .flat_map(parse_dt_list)
                    .map(|d| d.timestamp())
                    .collect();
                let skip = overridden.get(&uid);
                expand_rrule(&rule.value, start, zone, naive, from - dur, to)
                    .into_iter()
                    .filter(|d| !exdates.contains(&d.timestamp()))
                    .filter(|d| skip.map(|s| !s.contains(&d.timestamp())).unwrap_or(true))
                    .collect()
            }
            _ => vec![start],
        };

        for s in starts {
            let end = s + dur;
            if end <= from || s >= to {
                continue;
            }
            out.push(CalendarEvent {
                id: format!("{}@{}", uid, s.timestamp()),
                title: title.clone(),
                start: s.timestamp_millis(),
                end: end.timestamp_millis(),
                attendees: people.clone(),
                emails: emails.clone(),
                people: pairs.clone(),
                location: location.clone(),
                meeting_id: None,
                calendar_id: String::new(),
            });
        }
    }
    out.sort_by_key(|e| e.start);
    out
}

fn expand_rrule(
    rule: &str,
    start: DateTime<Utc>,
    zone: Zone,
    naive: NaiveDateTime,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<DateTime<Utc>> {
    let dtstart_line = match zone {
        Zone::Named(tz) => format!("DTSTART;TZID={}:{}", tz.name(), naive.format("%Y%m%dT%H%M%S")),
        // per l'ora "fluttuante" o UTC si espande in UTC
        Zone::Utc | Zone::Local => format!("DTSTART:{}Z", start.format("%Y%m%dT%H%M%S")),
    };
    let text = format!("{dtstart_line}\nRRULE:{rule}");
    let set: rrule::RRuleSet = match text.parse() {
        Ok(s) => s,
        Err(err) => {
            log::warn!("RRULE non interpretabile ({rule}): {err}");
            return vec![start];
        }
    };
    let set = set
        .after(from.with_timezone(&rrule::Tz::UTC))
        .before(to.with_timezone(&rrule::Tz::UTC));
    set.all(500).dates.into_iter().map(|d| d.with_timezone(&Utc)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n\
BEGIN:VEVENT\r\nUID:weekly-1\r\nSUMMARY:Standup piattaforma\\, CDC\r\n\
DTSTART;TZID=Europe/Zurich:20261102T091500\r\nDTEND;TZID=Europe/Zurich:20261102T093000\r\n\
RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE;TZID=Europe/Zurich:20261111T091500\r\n\
ATTENDEE;CN=Anna Rossi;ROLE=REQ-PARTICIPANT:mailto:anna@example.ch\r\n\
ATTENDEE;CN=\"Bianchi, Luca\":mailto:luca@exa\r\n mple.ch\r\n\
BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:weekly-1\r\nRECURRENCE-ID;TZID=Europe/Zurich:20261116T091500\r\n\
SUMMARY:Standup spostato\r\nDTSTART;TZID=Europe/Zurich:20261116T140000\r\nDURATION:PT30M\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:single\r\nSUMMARY:Call cliente\r\nDTSTART:20261118T130000Z\r\nDTEND:20261118T140000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:cancel\r\nSUMMARY:Annullato\r\nSTATUS:CANCELLED\r\nDTSTART:20261118T150000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:allday\r\nSUMMARY:Ferie\r\nDTSTART;VALUE=DATE:20261118\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn mailing_lists_and_rooms_are_not_people() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:allhands\r\nSUMMARY:All-hands\r\n\
DTSTART:20261118T080000Z\r\nDTEND:20261118T090000Z\r\n\
ATTENDEE;CN=Elena Rossi:mailto:elena@example.ch\r\n\
ATTENDEE;CUTYPE=GROUP;CN=Tutti:mailto:Tutti@Example.ch\r\n\
ATTENDEE;CUTYPE=ROOM;CN=Sala grande:mailto:sala@example.ch\r\n\
END:VEVENT\r\nEND:VCALENDAR\r\n";
        let from = Utc.with_ymd_and_hms(2026, 11, 18, 0, 0, 0).unwrap();
        let ev = events_between(ics, from, from + Duration::days(1));
        assert_eq!(ev[0].attendees, vec!["Elena Rossi"]);
        assert_eq!(ev[0].emails, vec!["elena@example.ch", "tutti@example.ch", "sala@example.ch"]);
        assert_eq!(ev[0].people, vec![("Elena Rossi".to_string(), Some("elena@example.ch".to_string()))]);
        assert_eq!(all_attendees(ics).len(), 1);
    }

    #[test]
    fn expands_recurring_with_exdate_and_override() {
        let from = Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 0).unwrap();
        let to = Utc.with_ymd_and_hms(2026, 11, 20, 0, 0, 0).unwrap();
        let ev = events_between(ICS, from, to);
        let titles: Vec<(&str, String)> = ev
            .iter()
            .map(|e| {
                (
                    e.title.as_str(),
                    DateTime::from_timestamp_millis(e.start).unwrap().format("%m-%d %H:%M").to_string(),
                )
            })
            .collect();
        // lun 9 (08:15 UTC), [mer 11 escluso], lun 16 spostato alle 13:00 UTC, mer 18, call delle 13:00
        assert_eq!(
            titles,
            vec![
                ("Standup piattaforma, CDC", "11-09 08:15".to_string()),
                ("Standup spostato", "11-16 13:00".to_string()),
                ("Standup piattaforma, CDC", "11-18 08:15".to_string()),
                ("Call cliente", "11-18 13:00".to_string()),
            ]
        );
        assert_eq!(ev[0].attendees, vec!["Anna Rossi", "Bianchi, Luca"]);
        assert_eq!(
            all_attendees(ICS),
            vec![
                ("Anna Rossi".to_string(), Some("anna@example.ch".to_string())),
                ("Bianchi, Luca".to_string(), Some("luca@example.ch".to_string())),
            ]
        );
        assert_eq!(ev[1].end - ev[1].start, 30 * 60 * 1000);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(Duration::minutes(90)));
        assert_eq!(parse_duration("P1D"), Some(Duration::days(1)));
    }
}
