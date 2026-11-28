//! Persone che arrivano da fuori: i file vCard scelti dall'utente e la rubrica del Mac.
//!
//! La rubrica si legge solo se l'utente la attiva (Impostazioni → Persone), solo per proporre
//! nomi mentre scrive un partecipante e per completare le email che mancano. Non viene mai
//! copiata per intero in Granello, e nomi ed email non finiscono nei log.

use serde::Serialize;

/// Una persona letta da fuori: nome ed email, se c'è.
pub type Found = (String, Option<String>);

/// Quanto si può leggere della rubrica del Mac.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    /// Non c'è una rubrica (fuori da macOS).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// macOS non ha ancora chiesto il permesso.
    NotDetermined,
    Denied,
    /// Bloccata da un profilo o dal controllo parentale.
    Restricted,
    Authorized,
    /// L'utente ha scelto solo alcuni contatti (macOS 15 e successivi).
    Limited,
}

impl Access {
    pub fn readable(self) -> bool {
        matches!(self, Access::Authorized | Access::Limited)
    }
}

// ---------- CSV ----------

/// Una riga di un elenco CSV: nome, email, ruolo e gruppi (anche più d'uno, separati da `|`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Row {
    pub name: String,
    pub email: Option<String>,
    pub role: String,
    pub groups: Vec<String>,
}

/// Le celle di una riga CSV, con le virgolette (`"Rossi, Elena"`, `""` per una virgoletta).
fn cells(line: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => out.push(std::mem::take(&mut cell)),
            c => cell.push(c),
        }
    }
    out.push(cell);
    out.into_iter().map(|c| c.trim().to_string()).collect()
}

/// Un elenco di persone esportato da un foglio di calcolo o da un'anagrafica: CSV con virgola,
/// punto e virgola o tabulazione. Con un'intestazione (in italiano o in inglese) si riconoscono
/// le colonne nome, cognome, email, ruolo e gruppo; senza, il nome è la prima colonna e l'email
/// la cella con la @. Senza doppioni e senza righe senza nome.
pub fn parse_csv(text: &str) -> Vec<Row> {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_start_matches('\u{feff}')).filter(|l| !l.trim().is_empty()).collect();
    let Some(first) = lines.first() else { return Vec::new() };
    let sep = ['\t', ';', ',']
        .into_iter()
        .max_by_key(|c| first.matches(*c).count())
        .filter(|c| first.contains(*c))
        .unwrap_or(',');
    let head: Vec<String> = cells(first, sep).into_iter().map(|c| c.to_lowercase()).collect();
    let find = |names: &[&str]| head.iter().position(|h| names.iter().any(|n| h == n || h.starts_with(&format!("{n} "))));
    let first_name = find(&["nome", "first name", "given name", "firstname"]);
    let last_name = find(&["cognome", "last name", "surname", "family name", "lastname"]);
    let full = find(&["nome completo", "full name", "name", "persona", "person", "display name"]);
    let email = find(&["email", "e-mail", "mail", "email address", "indirizzo email"]);
    let role = find(&["ruolo", "role", "title", "job title", "funzione", "posizione", "position"]);
    let group = find(&["gruppo", "gruppi", "group", "groups", "team", "reparto", "department", "dipartimento"]);
    let has_head = full.is_some() || first_name.is_some() || email.is_some();
    let mut out: Vec<Row> = Vec::new();
    for line in lines.iter().skip(usize::from(has_head)) {
        let row = cells(line, sep);
        let at = |i: Option<usize>| i.and_then(|i| row.get(i)).map(String::as_str).unwrap_or("").to_string();
        let name = if has_head {
            match (full, first_name, last_name) {
                // «Nome» da solo è il nome completo; con «Cognome» accanto è solo il nome
                (Some(f), _, None) => at(Some(f)),
                (_, Some(n), Some(c)) => format!("{} {}", at(Some(n)), at(Some(c))),
                (Some(f), _, Some(_)) if first_name.is_none() => at(Some(f)),
                (_, Some(n), None) => at(Some(n)),
                (Some(f), None, Some(c)) => format!("{} {}", at(Some(f)), at(Some(c))),
                _ => String::new(),
            }
        } else {
            row.iter().find(|c| !c.contains('@')).cloned().unwrap_or_default()
        };
        let mail = if has_head && email.is_some() { at(email) } else { row.iter().find(|c| c.contains('@')).cloned().unwrap_or_default() };
        let mail = Some(mail).filter(|m| m.contains('@') && !m.contains(char::is_whitespace));
        let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
        // solo l'email: il nome dalla parte prima della @ («marco.bianchi» → «Marco Bianchi»)
        let name = if name.is_empty() {
            mail.as_deref()
                .and_then(|m| m.split('@').next())
                .map(|local| {
                    local
                        .split(['.', '_', '-'])
                        .filter(|w| !w.is_empty())
                        .map(|w| {
                            let mut c = w.chars();
                            c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default()
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default()
        } else {
            name
        };
        if name.is_empty() || out.iter().any(|r| r.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let groups = at(group).split(['|', ';']).map(str::trim).filter(|g| !g.is_empty()).map(String::from).collect();
        out.push(Row { name, email: mail, role: at(role), groups });
    }
    out
}

// ---------- vCard ----------

/// Le persone di un file vCard (.vcf), anche esportato da Contatti, Google o Outlook: nome
/// (FN, o N se manca) e la prima email. Senza doppioni e senza voci senza nome.
pub fn parse_vcard(text: &str) -> Vec<Found> {
    // le righe lunghe continuano nella riga dopo, che comincia con uno spazio o un tab
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        if let Some(rest) = raw.strip_prefix([' ', '\t']) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(raw.to_string());
    }

    let mut out: Vec<Found> = Vec::new();
    let mut card: Option<(Option<String>, Option<String>, Option<String>)> = None;
    for line in lines {
        let Some((key, value)) = line.split_once(':') else { continue };
        // "item1.EMAIL;TYPE=INTERNET" → "EMAIL"
        let prop = key.split(';').next().unwrap_or("");
        let prop = prop.rsplit('.').next().unwrap_or(prop).trim().to_ascii_uppercase();
        let quoted_printable = key.to_ascii_uppercase().contains("QUOTED-PRINTABLE");
        let value = if quoted_printable { decode_qp(value) } else { value.to_string() };
        match prop.as_str() {
            "BEGIN" if value.trim().eq_ignore_ascii_case("VCARD") => card = Some((None, None, None)),
            "END" if value.trim().eq_ignore_ascii_case("VCARD") => {
                if let Some((full, structured, email)) = card.take() {
                    let name = full.filter(|n| !n.is_empty()).or(structured).unwrap_or_default();
                    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
                    if !name.is_empty() && name.chars().count() <= 80 && !out.iter().any(|(n, _)| n.eq_ignore_ascii_case(&name)) {
                        out.push((name, email));
                    }
                }
            }
            "FN" => {
                if let Some(c) = card.as_mut() {
                    c.0 = Some(unescape(&value).trim().to_string());
                }
            }
            "N" => {
                if let Some(c) = card.as_mut() {
                    // cognome;nome;secondi nomi;titolo;suffisso
                    let parts: Vec<String> = split_unescaped(&value, ';').iter().map(|p| unescape(p).trim().to_string()).collect();
                    let given = parts.get(1).cloned().unwrap_or_default();
                    let family = parts.first().cloned().unwrap_or_default();
                    let joined = format!("{given} {family}").trim().to_string();
                    if !joined.is_empty() {
                        c.1 = Some(joined);
                    }
                }
            }
            "EMAIL" => {
                if let Some(c) = card.as_mut() {
                    let email = unescape(&value).trim().to_string();
                    if c.2.is_none() && email.contains('@') {
                        c.2 = Some(email);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn split_unescaped(value: &str, sep: char) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut escaped = false;
    for c in value.chars() {
        if escaped {
            out.last_mut().unwrap().push('\\');
            out.last_mut().unwrap().push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == sep {
            out.push(String::new());
        } else {
            out.last_mut().unwrap().push(c);
        }
    }
    out
}

fn unescape(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// vCard 2.1 di Outlook: `=C3=A8` è una "è" in UTF-8.
fn decode_qp(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'=' {
            let hex = value.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------- rubrica del Mac ----------

#[cfg(target_os = "macos")]
mod mac {
    use super::{Access, Found};
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2_contacts::{
        CNAuthorizationStatus, CNContact, CNContactEmailAddressesKey, CNContactFamilyNameKey, CNContactGivenNameKey,
        CNContactStore, CNEntityType, CNKeyDescriptor,
    };
    use objc2_foundation::{NSArray, NSError, NSString};

    pub fn access() -> Access {
        let status = unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) };
        match status {
            CNAuthorizationStatus::NotDetermined => Access::NotDetermined,
            CNAuthorizationStatus::Restricted => Access::Restricted,
            CNAuthorizationStatus::Authorized => Access::Authorized,
            CNAuthorizationStatus::Limited => Access::Limited,
            _ => Access::Denied,
        }
    }

    /// Chiede il permesso (macOS mostra la sua finestra la prima volta). Blocca finché
    /// l'utente risponde: va chiamata fuori dal thread principale.
    pub fn request() -> Access {
        if access() != Access::NotDetermined {
            return access();
        }
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        let store = unsafe { CNContactStore::new() };
        unsafe { store.requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &block) };
        let _ = rx.recv_timeout(std::time::Duration::from_secs(600));
        access()
    }

    /// I contatti il cui nome contiene `query`, con la prima email.
    pub fn search(query: &str, limit: usize) -> Vec<Found> {
        if !access().readable() {
            return Vec::new();
        }
        autoreleasepool(|_| {
            let store = unsafe { CNContactStore::new() };
            let predicate = unsafe { CNContact::predicateForContactsMatchingName(&NSString::from_str(query)) };
            let keys: [&ProtocolObject<dyn CNKeyDescriptor>; 3] = unsafe {
                [
                    ProtocolObject::from_ref(CNContactGivenNameKey),
                    ProtocolObject::from_ref(CNContactFamilyNameKey),
                    ProtocolObject::from_ref(CNContactEmailAddressesKey),
                ]
            };
            let keys = NSArray::from_slice(&keys);
            let Ok(found) = (unsafe { store.unifiedContactsMatchingPredicate_keysToFetch_error(&predicate, &keys) })
            else {
                return Vec::new();
            };
            let mut out: Vec<Found> = Vec::new();
            for contact in found.iter() {
                let given = unsafe { contact.givenName() }.to_string();
                let family = unsafe { contact.familyName() }.to_string();
                let name = format!("{} {}", given.trim(), family.trim()).trim().to_string();
                if name.is_empty() || out.iter().any(|(n, _)| n.eq_ignore_ascii_case(&name)) {
                    continue;
                }
                let emails = unsafe { contact.emailAddresses() };
                let email = emails.iter().next().map(|labeled| unsafe { labeled.value() }.to_string());
                out.push((name, email));
                if out.len() >= limit {
                    break;
                }
            }
            out
        })
    }
}

/// Quanto si può leggere della rubrica del Mac.
pub fn access() -> Access {
    #[cfg(target_os = "macos")]
    return mac::access();
    #[cfg(not(target_os = "macos"))]
    Access::Unsupported
}

/// Chiede a macOS il permesso di leggere la rubrica. Blocca finché l'utente risponde.
pub fn request_access() -> Access {
    #[cfg(target_os = "macos")]
    return mac::request();
    #[cfg(not(target_os = "macos"))]
    Access::Unsupported
}

/// Contatti della rubrica il cui nome contiene `query` (almeno due lettere). Vuoto se la
/// rubrica non è leggibile.
pub fn search(query: &str, limit: usize) -> Vec<Found> {
    let query = query.trim();
    if query.chars().count() < 2 {
        return Vec::new();
    }
    #[cfg(target_os = "macos")]
    return mac::search(query, limit);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = limit;
        Vec::new()
    }
}

/// L'email del contatto che si chiama esattamente `name`, se la rubrica ne ha una.
pub fn email_for(name: &str) -> Option<String> {
    search(name, 10)
        .into_iter()
        .find(|(n, e)| n.eq_ignore_ascii_case(name.trim()) && e.is_some())
        .and_then(|(_, e)| e)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_csv_with_and_without_header() {
        let sheet = "Nome;Cognome;E-mail;Ruolo;Gruppo\nAnna;Villa;anna@example.ch;Supporto;Azienda/Mobile|Azienda\n\
\"Rossi\";Elena;;Direzione;Azienda\n;;marco.bianchi@example.ch;;\nAnna;Villa;doppia@example.ch;;\n";
        let rows = parse_csv(sheet);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].name, "Anna Villa");
        assert_eq!(rows[0].email.as_deref(), Some("anna@example.ch"));
        assert_eq!(rows[0].role, "Supporto");
        assert_eq!(rows[0].groups, vec!["Azienda/Mobile", "Azienda"]);
        assert_eq!((rows[1].name.as_str(), rows[1].email.as_deref()), ("Rossi Elena", None));
        assert_eq!(rows[2].name, "Marco Bianchi");

        let plain = "Luca Ferri,luca@example.ch\n\"Galli, Francesca\",francesca@example.ch\n";
        let rows = parse_csv(plain);
        assert_eq!(rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), vec!["Luca Ferri", "Galli, Francesca"]);
        assert_eq!(rows[1].email.as_deref(), Some("francesca@example.ch"));

        let english = "Full name,Email,Team\nSara Conti,sara@example.ch,Mobile\n";
        assert_eq!(parse_csv(english)[0].groups, vec!["Mobile"]);
        assert!(parse_csv("").is_empty());
    }

    #[test]
    fn reads_names_and_emails_from_vcards() {
        let vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Rossi;Elena;;;\r\nFN:Elena Rossi\r\nitem1.EMAIL;type=INTERNET;type=pref:elena@example.ch\r\nEMAIL:altra@example.ch\r\nEND:VCARD\r\n\
BEGIN:VCARD\r\nVERSION:3.0\r\nN:Bianchi;Marco;;;\r\nEND:VCARD\r\n\
BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Studio Ferri\\, Lugano con un nome\r\n  molto lungo\r\nEND:VCARD\r\n\
BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Nicol=C3=B2 Sala\r\nEND:VCARD\r\n\
BEGIN:VCARD\r\nVERSION:3.0\r\nFN:elena rossi\r\nEND:VCARD\r\n\
BEGIN:VCARD\r\nVERSION:3.0\r\nTEL:+41 91 000 00 00\r\nEND:VCARD\r\n";
        let people = parse_vcard(vcf);
        assert_eq!(
            people,
            vec![
                ("Elena Rossi".to_string(), Some("elena@example.ch".to_string())),
                ("Marco Bianchi".to_string(), None),
                ("Studio Ferri, Lugano con un nome molto lungo".to_string(), None),
                ("Nicolò Sala".to_string(), None),
            ]
        );
        assert!(parse_vcard("non è una vcard").is_empty());
    }

    #[test]
    fn contacts_stay_off_until_the_user_turns_them_on() {
        assert!(!crate::models::Settings::default().contacts_suggestions);
        let saved: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(!saved.contacts_suggestions, "impostazioni salvate prima della rubrica");
    }

    /// Prova a mano i collegamenti con Contacts.framework: legge solo lo stato del permesso,
    /// senza mai chiederlo (`cargo test contacts -- --ignored`).
    #[test]
    #[ignore]
    fn reads_the_access_status_without_asking() {
        let access = access();
        println!("rubrica: {access:?}");
        if !access.readable() {
            assert!(search("Rossi", 3).is_empty());
            assert_eq!(email_for("Rossi"), None);
        }
    }

    #[test]
    fn contacts_are_not_searched_with_a_single_letter() {
        assert!(search("a", 5).is_empty());
        assert!(search("  ", 5).is_empty());
    }
}
