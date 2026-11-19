use crate::models::{Meeting, Template, TranscriptSegment};

pub fn builtin_templates() -> Vec<Template> {
    let t = |id: &str, name: &str, description: &str, instructions: &str| Template {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        instructions: instructions.into(),
        builtin: true,
    };
    if crate::i18n::lang() == crate::i18n::Lang::En {
        return vec![
            t(
                "generale",
                "General",
                "For any meeting",
                "Structure the notes in sections with headings (###) that follow the topics actually discussed, \
in the order they came up. End with a \"### Next steps\" section listing the agreed actions \
(owner and due date when mentioned).",
            ),
            t(
                "one-on-one",
                "1:1",
                "One-on-one with a report or a manager",
                "Use these sections:\n### Updates\n### Blockers and difficulties\n### Feedback (given and received)\n\
### Growth and goals\n### Next steps\nSkip empty sections. Keep the tone personal and concise.",
            ),
            t(
                "standup",
                "Standup",
                "Daily or team sync",
                "Group by person. For each: what they did, what they will do, any blockers. \
Then a \"### Blockers to resolve\" section and \"### Next steps\". Be very concise.",
            ),
            t(
                "colloquio",
                "Interview",
                "Job interview",
                "Use these sections:\n### Candidate profile\n### Relevant experience\n### Technical skills\n\
### Soft skills and motivation\n### Candidate's questions\n### Positive signals\n### Doubts or risks\n### Next steps\n\
Report facts and quotes, not judgements the transcript doesn't support.",
            ),
            t(
                "cliente",
                "Client meeting",
                "Sales call or client call",
                "Use these sections:\n### Client context\n### Needs and problems\n### Objections\n\
### Budget, timeline and decision makers\n### What we proposed\n### Next steps\nQuote numbers and dates exactly as stated.",
            ),
        ];
    }
    vec![
        t(
            "generale",
            "Generale",
            "Per qualsiasi meeting",
            "Struttura le note in sezioni con titoli (###) che seguono gli argomenti realmente discussi, \
nell'ordine in cui sono emersi. Chiudi con una sezione \"### Prossimi passi\" con le azioni concordate \
(responsabile e scadenza se menzionati).",
        ),
        t(
            "one-on-one",
            "1:1",
            "Incontro individuale con collaboratore o responsabile",
            "Usa queste sezioni:\n### Aggiornamenti\n### Blocchi e difficoltà\n### Feedback (dato e ricevuto)\n\
### Crescita e obiettivi\n### Prossimi passi\nOmetti le sezioni vuote. Mantieni un tono personale e sintetico.",
        ),
        t(
            "standup",
            "Standup",
            "Daily o sync di team",
            "Raggruppa per persona. Per ognuna: cosa ha fatto, cosa farà, eventuali blocchi. \
Poi una sezione \"### Blocchi da risolvere\" e \"### Prossimi passi\". Sii molto conciso.",
        ),
        t(
            "colloquio",
            "Colloquio",
            "Colloquio di selezione",
            "Usa queste sezioni:\n### Profilo del candidato\n### Esperienza rilevante\n### Competenze tecniche\n\
### Soft skill e motivazione\n### Domande del candidato\n### Segnali positivi\n### Dubbi o rischi\n### Prossimi passi\n\
Riporta fatti e citazioni, non giudizi non supportati dalla trascrizione.",
        ),
        t(
            "cliente",
            "Meeting cliente",
            "Call commerciale o con un cliente",
            "Usa queste sezioni:\n### Contesto del cliente\n### Bisogni e problemi\n### Obiezioni\n\
### Budget, tempi e decisori\n### Cosa abbiamo proposto\n### Prossimi passi\nCita numeri e date esattamente come detti.",
        ),
    ]
}

fn fmt_ts(ms: i64) -> String {
    let s = ms / 1000;
    format!("{:02}:{:02}", s / 60, s % 60)
}

pub fn transcript_text(segments: &[TranscriptSegment], me: &str) -> String {
    let me = if me.trim().is_empty() { "Io" } else { me.trim() };
    let mut out = String::new();
    let mut last_source = "";
    for s in segments {
        let who = if s.source == "me" { me } else { "Altri" };
        if s.source != last_source {
            out.push_str(&format!("\n[{}] {}: ", fmt_ts(s.start_ms), who));
            last_source = &s.source;
        } else {
            out.push(' ');
        }
        out.push_str(s.text.trim());
    }
    out.trim().to_string()
}

pub fn enhance_system(language: &str) -> String {
    let lang = match language {
        "auto" | "" => "nella lingua prevalente della trascrizione".to_string(),
        "it" => "in italiano".into(),
        "en" => "in inglese".into(),
        "de" => "in tedesco".into(),
        "fr" => "in francese".into(),
        other => format!("nella lingua con codice {other}"),
    };
    format!(
        "Sei un assistente che scrive note di meeting eccellenti, nello stile di Granola.\n\
Ricevi: le note grezze scritte a mano dall'utente durante il meeting e la trascrizione automatica.\n\
Il tuo compito è produrre note arricchite in Markdown, {lang}.\n\n\
Regole:\n\
- Le note dell'utente sono lo scheletro: ogni punto che ha scritto deve comparire, espanso con i dettagli \
rilevanti della trascrizione. Ciò che l'utente ha annotato indica cosa per lui conta di più.\n\
- Aggiungi gli argomenti importanti della trascrizione che l'utente non ha annotato.\n\
- Bullet brevi e densi di informazione. Niente frasi di cortesia, niente riassunto introduttivo.\n\
- Riporta nomi, numeri, date e decisioni esattamente. Non inventare nulla che non sia nelle fonti.\n\
- La trascrizione è automatica e può contenere errori di riconoscimento: correggi i termini tecnici \
quando il contesto lo rende evidente.\n\
- \"Altri\" nella trascrizione indica gli altri partecipanti (audio di sistema), non una persona precisa.\n\
- Le azioni vanno come checklist Markdown: \"- [ ] Responsabile: azione (scadenza)\".\n\
- Non usare il trattino lungo.\n\
- Scrivi anche i titoli delle sezioni nella lingua delle note, traducendo quelli indicati dal template se serve.\n\
- Rispondi solo con le note, senza preamboli né blocchi di codice."
    )
}

pub fn enhance_user(
    meeting: &Meeting,
    template: Option<&Template>,
    segments: &[TranscriptSegment],
    me: &str,
) -> String {
    let date = chrono::DateTime::from_timestamp_millis(meeting.started_at.unwrap_or(meeting.created_at))
        .map(|d| d.with_timezone(&chrono::Local).format("%d.%m.%Y %H:%M").to_string())
        .unwrap_or_default();
    let mut s = format!("# Meeting: {}\nData: {}\n", meeting.title, date);
    if !meeting.attendees.is_empty() {
        s.push_str(&format!("Partecipanti: {}\n", meeting.attendees.join(", ")));
    }
    if let Some(t) = template {
        s.push_str(&format!("\n## Template \"{}\"\n{}\n", t.name, t.instructions));
    }
    let notes = meeting.notes_md.trim();
    s.push_str("\n## Note dell'utente\n");
    s.push_str(if notes.is_empty() { "(nessuna nota scritta)" } else { notes });
    s.push_str("\n\n## Trascrizione\n");
    let tr = transcript_text(segments, me);
    s.push_str(if tr.is_empty() { "(nessuna trascrizione)" } else { &tr });
    s
}

pub fn chat_system_meeting(meeting: &Meeting, segments: &[TranscriptSegment], me: &str) -> String {
    format!(
        "Sei l'assistente di Granello e rispondi a domande su UN meeting specifico. Usa solo le informazioni \
qui sotto; se qualcosa non c'è, dillo. Rispondi in modo conciso, in Markdown, nella lingua della domanda. \
Non usare il trattino lungo. Puoi anche redigere email di follow-up, liste di azioni, riassunti.\n\n{}\n\n\
## Note arricchite\n{}",
        enhance_user(meeting, None, segments, me),
        meeting.enhanced_md.as_deref().unwrap_or("(non ancora generate)")
    )
}

pub fn chat_system_global(meetings: &[(Meeting, String)]) -> String {
    let mut s = String::from(
        "Sei l'assistente di Granello e rispondi a domande sull'insieme dei meeting dell'utente. \
Sotto trovi i meeting più pertinenti alla domanda (per ognuno: data, titolo, note e, se presente, un \
estratto della trascrizione). Cita sempre il meeting (titolo e data) da cui prendi un'informazione. \
Se la risposta non è nei meeting forniti, dillo chiaramente. Rispondi in Markdown, conciso, nella lingua \
della domanda. Non usare il trattino lungo.\n",
    );
    for (m, transcript) in meetings {
        let date = chrono::DateTime::from_timestamp_millis(m.started_at.unwrap_or(m.created_at))
            .map(|d| d.with_timezone(&chrono::Local).format("%d.%m.%Y").to_string())
            .unwrap_or_default();
        s.push_str(&format!("\n\n=== {} ({}) ===\n", m.title, date));
        if !m.attendees.is_empty() {
            s.push_str(&format!("Partecipanti: {}\n", m.attendees.join(", ")));
        }
        match m.enhanced_md.as_deref().filter(|e| !e.trim().is_empty()) {
            Some(e) => s.push_str(e),
            None => s.push_str(m.notes_md.trim()),
        }
        if !transcript.is_empty() {
            s.push_str("\n--- trascrizione (estratto) ---\n");
            s.push_str(transcript);
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_groups_by_speaker() {
        let seg = |src: &str, t: i64, txt: &str| TranscriptSegment {
            id: 0,
            meeting_id: "m".into(),
            source: src.into(),
            start_ms: t,
            end_ms: t + 1000,
            text: txt.into(),
        };
        let out = transcript_text(
            &[seg("me", 0, "Ciao."), seg("me", 1000, "Iniziamo?"), seg("them", 65000, "Sì.")],
            "David",
        );
        assert_eq!(out, "[00:00] David: Ciao. Iniziamo?\n[01:05] Altri: Sì.");
    }
}
