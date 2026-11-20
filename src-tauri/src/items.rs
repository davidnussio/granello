//! Elementi che la Libreria mostra attraverso i meeting: decisioni, azioni e citazioni.
//! Non hanno una tabella: si leggono dal Markdown delle note, dove ogni blocco ha già
//! una forma leggibile.
//!
//! - decisione: il riquadro `> [!DECISION]`
//! - azione: una voce di checklist, `- [ ]` oppure `- [x]`
//! - citazione: il blocco `::: quote 12:34 Marco`

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Decision,
    Action,
    Quote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub meeting_id: String,
    pub kind: ItemKind,
    /// Il testo così com'è nella nota (Markdown in linea: menzioni, date, evidenziatore).
    pub text: String,
    /// Solo per le azioni: la voce è spuntata.
    pub done: bool,
    /// Solo per le citazioni: chi l'ha detta.
    pub who: Option<String>,
    /// Solo per le citazioni: il minuto del meeting, in millisecondi.
    pub ms: Option<i64>,
}

/// Gli elementi di un meeting: quelli delle note, più quelli delle note AI che le note
/// non hanno già (le note AI riprendono spesso le stesse azioni con altre parole).
pub fn of_meeting(meeting_id: &str, notes_md: &str, enhanced_md: Option<&str>) -> Vec<Item> {
    let mut items = extract(meeting_id, notes_md);
    let known: Vec<(ItemKind, String)> = items.iter().map(|i| (i.kind, key(&i.text))).collect();
    for item in extract(meeting_id, enhanced_md.unwrap_or_default()) {
        let k = key(&item.text);
        let repeated = known.iter().any(|(kind, other)| *kind == item.kind && (other.contains(&k) || k.contains(other.as_str())));
        if !repeated {
            items.push(item);
        }
    }
    items
}

/// Il testo ridotto a lettere e cifre, senza le date: serve solo a riconoscere i doppioni.
fn key(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        rest = rest[start..].find("]]").map_or("", |end| &rest[start + end + 2..]);
    }
    out.push_str(rest);
    out.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// La riga senza rientro e senza i `>` dei riquadri che la contengono; `true` se ne aveva.
fn unquote(line: &str) -> (&str, bool) {
    let mut rest = line.trim_start();
    let mut quoted = false;
    while let Some(inner) = rest.strip_prefix('>') {
        quoted = true;
        rest = inner.trim_start();
    }
    (rest, quoted)
}

/// `- [ ] testo` → (spuntata, testo).
fn task(line: &str) -> Option<(bool, &str)> {
    let rest = line.strip_prefix(['-', '*', '+'])?.strip_prefix(' ')?.trim_start();
    let rest = rest.strip_prefix('[')?;
    let mark = rest.chars().next()?;
    let text = rest[mark.len_utf8()..].strip_prefix(']')?;
    let done = match mark {
        ' ' => false,
        'x' | 'X' => true,
        _ => return None,
    };
    // dopo la casella serve uno spazio: `- [x]fatto` è testo, non una voce
    (text.is_empty() || text.starts_with(' ')).then(|| (done, text.trim()))
}

/// "12:34" oppure "1:02:03" in millisecondi.
fn parse_time(text: &str) -> Option<i64> {
    let parts: Vec<i64> = text.split(':').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match parts[..] {
        [m, s] => Some((m * 60 + s) * 1000),
        [h, m, s] => Some(((h * 60 + m) * 60 + s) * 1000),
        _ => None,
    }
}

fn extract(meeting_id: &str, md: &str) -> Vec<Item> {
    let item = |kind, text: String| Item { meeting_id: meeting_id.to_string(), kind, text, done: false, who: None, ms: None };
    let mut out = Vec::new();
    let mut lines = md.lines().peekable();
    let mut in_code = false;
    while let Some(raw) = lines.next() {
        let (line, quoted) = unquote(raw);
        if line.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        if let Some(info) = line.strip_prefix(":::").map(|l| l.trim_start_matches(':').trim()) {
            let Some(info) = info.strip_prefix("quote").filter(|i| i.is_empty() || i.starts_with(' ')) else { continue };
            let mut text = Vec::new();
            for body in lines.by_ref() {
                let body = unquote(body).0;
                if body.starts_with(":::") {
                    break;
                }
                text.push(body.trim());
            }
            let info = info.trim();
            let (first, who) = info.split_once(' ').unwrap_or((info, ""));
            let ms = parse_time(first);
            let who = if ms.is_some() { who.trim() } else { info };
            let text = text.join(" ").trim().to_string();
            if !text.is_empty() {
                out.push(Item { who: (!who.is_empty()).then(|| who.to_string()), ms, ..item(ItemKind::Quote, text) });
            }
            continue;
        }
        if quoted && line.eq_ignore_ascii_case("[!DECISION]") {
            let mut text = Vec::new();
            while let Some(next) = lines.peek() {
                let (body, still) = unquote(next);
                if !still {
                    break;
                }
                lines.next();
                match task(body) {
                    // una checklist dentro la decisione resta un'azione
                    Some((done, action)) if !action.is_empty() => out.push(Item { done, ..item(ItemKind::Action, action.to_string()) }),
                    Some(_) => {}
                    None if body.is_empty() => {}
                    None => text.push(body.trim_start_matches(['-', '*', '+']).trim()),
                }
            }
            let text = text.join(" ").trim().to_string();
            if !text.is_empty() {
                out.push(item(ItemKind::Decision, text));
            }
            continue;
        }
        if let Some((done, text)) = task(line) {
            if !text.is_empty() {
                out.push(Item { done, ..item(ItemKind::Action, text.to_string()) });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTES: &str = "\
## Dove siamo

::: quote 11:48 Marco Bianchi
Se non arriviamo al 10%, guardiamo altrove.
:::

::: quote Elena
Senza minuto.
:::

::: poll Quando?
- [3] Giovedì
:::

> [!DECISION]
> Controproposta: 8% su due anni.
> Scade il [[2026-12-01]].

> [!NOTE]
> Solo una nota.

```
- [ ] dentro il codice non conta
```

- [x] Calcolare il margine
- [ ] @[Elena Rossi]: mandare la controproposta entro il [[2026-11-22]]
  - [ ] Voce rientrata
- [ ]
";

    #[test]
    fn reads_decisions_actions_and_quotes_from_the_notes() {
        let items = extract("m1", NOTES);
        let of = |kind| items.iter().filter(|i| i.kind == kind).collect::<Vec<_>>();

        let quotes = of(ItemKind::Quote);
        assert_eq!(quotes.len(), 2);
        assert_eq!(quotes[0].text, "Se non arriviamo al 10%, guardiamo altrove.");
        assert_eq!(quotes[0].who.as_deref(), Some("Marco Bianchi"));
        assert_eq!(quotes[0].ms, Some(708_000));
        assert_eq!((quotes[1].who.as_deref(), quotes[1].ms), (Some("Elena"), None));

        let decisions = of(ItemKind::Decision);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].text, "Controproposta: 8% su due anni. Scade il [[2026-12-01]].");

        let actions = of(ItemKind::Action);
        assert_eq!(actions.iter().map(|a| a.done).collect::<Vec<_>>(), vec![true, false, false]);
        assert_eq!(actions[2].text, "Voce rientrata");
        assert!(items.iter().all(|i| i.meeting_id == "m1"));
    }

    #[test]
    fn ai_notes_add_only_what_the_notes_do_not_have() {
        let enhanced = "\
- [ ] Elena Rossi: mandare la controproposta
- [ ] Fissare la call di chiusura

> [!DECISION]
> Controproposta: 8% su due anni.
";
        let items = of_meeting("m1", NOTES, Some(enhanced));
        let actions: Vec<&str> = items.iter().filter(|i| i.kind == ItemKind::Action).map(|i| i.text.as_str()).collect();
        assert_eq!(actions.len(), 4);
        assert_eq!(actions[3], "Fissare la call di chiusura");
        assert_eq!(items.iter().filter(|i| i.kind == ItemKind::Decision).count(), 1);
        assert_eq!(of_meeting("m1", NOTES, None), extract("m1", NOTES));
    }

    #[test]
    fn a_checklist_inside_a_decision_stays_an_action() {
        let items = extract("m1", "> [!decision]\n> Si parte a marzo.\n> - [ ] Avvisare il cliente\n\nTesto");
        assert_eq!(items.len(), 2);
        assert_eq!((items[0].kind, items[0].text.as_str()), (ItemKind::Action, "Avvisare il cliente"));
        assert_eq!((items[1].kind, items[1].text.as_str()), (ItemKind::Decision, "Si parte a marzo."));
    }
}
