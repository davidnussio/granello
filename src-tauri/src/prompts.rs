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
        let who = match s.source.as_str() {
            "me" => me,
            // file caricato: una sola traccia con tutte le voci, non attribuibile
            "file" => "Registrazione",
            "them" => "Altri",
            // dopo l'affinamento online la sorgente è il nome del parlante
            name => name,
        };
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

fn output_language(language: &str) -> String {
    match language {
        "auto" | "" => "nella lingua prevalente della trascrizione".to_string(),
        "it" => "in italiano".into(),
        "en" => "in inglese".into(),
        "de" => "in tedesco".into(),
        "fr" => "in francese".into(),
        other => format!("nella lingua con codice {other}"),
    }
}

/// Quanto audio attorno a un momento segnato si guarda: chi preme il tasto reagisce a
/// qualcosa che è appena stato detto, quindi soprattutto prima.
const MOMENT_BEFORE_MS: i64 = 75_000;
const MOMENT_AFTER_MS: i64 = 20_000;

/// La trascrizione attorno al momento `ms`, vuota se lì non c'è niente.
pub fn moment_excerpt(segments: &[TranscriptSegment], ms: i64, me: &str) -> String {
    let near: Vec<TranscriptSegment> = segments
        .iter()
        .filter(|s| s.end_ms >= ms - MOMENT_BEFORE_MS && s.start_ms <= ms + MOMENT_AFTER_MS)
        .cloned()
        .collect();
    transcript_text(&near, me)
}

pub fn moments_system(language: &str) -> String {
    format!(
        "Durante un meeting l'utente ha premuto un tasto per segnare alcuni momenti importanti. \
Per ogni momento ricevi il minuto e la trascrizione automatica di ciò che si diceva lì attorno \
(soprattutto prima: l'utente reagisce a qualcosa di appena detto).\n\
Per ogni momento scrivi, {lang}, una o due frasi brevi che dicono cosa si stava dicendo o decidendo: \
il contenuto, non \"si parlava di\". Riporta nomi, numeri e date esattamente. Non inventare nulla.\n\
\"Altri\" indica gli altri partecipanti, non una persona precisa. La trascrizione può contenere \
errori di riconoscimento. Non usare il trattino lungo.\n\
Rispondi con una riga per momento, nel formato `N: testo`, dove N è il numero del momento. \
Se la trascrizione di un momento non dice niente di utile, scrivi `N: -`. Nessun altro testo.",
        lang = output_language(language)
    )
}

/// `excerpts`: per ogni momento, il minuto (ms) e la trascrizione lì attorno.
pub fn moments_user(meeting: &Meeting, excerpts: &[(i64, String)]) -> String {
    let mut s = format!("# Meeting: {}\n", meeting.title);
    if !meeting.attendees.is_empty() {
        s.push_str(&format!("Partecipanti: {}\n", meeting.attendees.join(", ")));
    }
    for (i, (ms, excerpt)) in excerpts.iter().enumerate() {
        s.push_str(&format!("\n## Momento {} (segnato a {})\n{}\n", i + 1, fmt_ts(*ms), excerpt));
    }
    s
}

/// Legge la risposta `N: testo` del modello: per ognuno degli `n` momenti il testo, se c'è.
pub fn parse_moments(answer: &str, n: usize) -> Vec<Option<String>> {
    let mut out = vec![None; n];
    for line in answer.lines() {
        let Some((head, text)) = line.split_once(':') else { continue };
        let head = head.trim().trim_matches(|c: char| !c.is_ascii_digit());
        let Ok(i) = head.parse::<usize>() else { continue };
        let text = text.trim().trim_matches('`').trim();
        if i >= 1 && i <= n && text.chars().any(char::is_alphanumeric) {
            out[i - 1] = Some(text.to_string());
        }
    }
    out
}

/// Cosa può chiedere l'editor all'AI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssistKind {
    /// Risposta a una domanda sul meeting (blocco AI dal vivo).
    Answer,
    /// Crea o modifica un blocco della nota nel suo formato Markdown.
    Block,
    /// Riscrive il testo selezionato.
    Rewrite,
    /// Trasforma lo schizzo allegato in un diagramma Mermaid.
    Sketch,
    /// Propone un titolo per il meeting.
    Title,
}

pub fn assist_system(kind: AssistKind, language: &str, format: Option<&str>) -> String {
    let lang = output_language(language);
    let common = "Sei l'assistente AI dentro l'editor delle note di Granello, un'app per le note di riunione. \
Quando la richiesta riguarda il meeting usa solo le note e la trascrizione fornite: non inventare fatti, \
nomi, numeri o date. La trascrizione è automatica e può contenere errori; \"Altri\" indica gli altri \
partecipanti, non una persona precisa. Non usare il trattino lungo.";
    match kind {
        AssistKind::Answer => format!(
            "{common}\nL'utente ha messo nella nota una richiesta che viene ricalcolata mentre la riunione procede. \
Rispondi {lang}, in Markdown breve: bullet densi o poche frasi, senza titoli, senza preamboli e senza \
ripetere la richiesta. Se la trascrizione non contiene ancora nulla di utile, scrivi una sola riga che lo dice."
        ),
        AssistKind::Block => format!(
            "{common}\nL'utente ti chiede di creare o modificare un blocco della nota. Il blocco ha questo formato:\n\n{}\n\n\
Rispondi SOLO con il blocco completo in quel formato, pronto da salvare: nessuna spiegazione, nessun testo \
prima o dopo, nessun recinto di codice aggiuntivo. Scrivi i testi {lang}. Se la richiesta chiede una modifica, \
conserva il resto del blocco attuale.",
            format.unwrap_or("Markdown")
        ),
        AssistKind::Rewrite => format!(
            "{common}\nL'utente ha selezionato un pezzo della nota e ti chiede di riscriverlo. Rispondi SOLO con \
il testo che sostituisce la selezione, in Markdown, senza spiegazioni, senza virgolette attorno e senza recinti \
di codice. Mantieni la lingua del testo selezionato, a meno che la richiesta non chieda di tradurre."
        ),
        AssistKind::Title => format!(
            "{common}\nProponi un titolo per questo meeting, {lang}: da tre a otto parole che dicono di cosa si è \
parlato o cosa si è deciso, abbastanza specifiche da riconoscerlo tra altri meeting. Niente data, niente \
\"Meeting\" o \"Riunione\" all'inizio, niente virgolette, niente punto finale. Rispondi SOLO con il titolo, su una riga."
        ),
        AssistKind::Sketch => "Ricevi l'immagine di uno schizzo fatto a mano su una lavagna. Trasformalo in un \
diagramma Mermaid che ne riproduce la struttura: forme come nodi, frecce e linee come collegamenti, scritte come \
etichette. Scegli il tipo di diagramma più adatto (di solito flowchart). Se una scritta non si legge, usa \
un'etichetta breve e neutra. Rispondi SOLO con il codice Mermaid, senza spiegazioni e senza recinti di codice."
            .to_string(),
    }
}

/// `context`: note e trascrizione del meeting, se la richiesta parte da un meeting.
pub fn assist_user(kind: AssistKind, context: Option<&str>, instruction: &str, current: Option<&str>) -> String {
    let mut s = String::new();
    if let Some(context) = context {
        s.push_str(context);
        s.push_str("\n\n");
    }
    let current = current.map(str::trim).filter(|c| !c.is_empty());
    match kind {
        AssistKind::Answer => s.push_str(&format!("## Richiesta\n{instruction}")),
        AssistKind::Title => s.push_str("## Richiesta\nScrivi il titolo di questo meeting."),
        AssistKind::Block => {
            s.push_str(&format!("## Blocco attuale\n{}\n\n## Richiesta\n{instruction}", current.unwrap_or("(vuoto)")));
        }
        AssistKind::Rewrite => {
            s.push_str(&format!("## Testo selezionato\n{}\n\n## Richiesta\n{instruction}", current.unwrap_or("")));
        }
        AssistKind::Sketch => {
            s.push_str("Trasforma questo schizzo in un diagramma Mermaid.");
            if !instruction.trim().is_empty() {
                s.push_str(&format!("\n{instruction}"));
            }
        }
    }
    s
}

pub fn enhance_system(language: &str) -> String {
    let lang = output_language(language);
    format!(
        "Sei un assistente che scrive note di meeting eccellenti.\n\
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
- Un blocco \"::: moment MM:SS\" nelle note segna un momento che l'utente ha ritenuto importante mentre \
ascoltava: dai risalto a ciò che si diceva in quel punto della trascrizione. Non riportare il blocco nelle note.\n\
- Un blocco \"::: quote MM:SS Nome\" nelle note è una frase della trascrizione che l'utente ha voluto citare: \
riportala testualmente, come citazione Markdown (\">\") con chi l'ha detta, nel punto delle note a cui appartiene.\n\
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
            review: false,
        };
        let out = transcript_text(
            &[seg("me", 0, "Ciao."), seg("me", 1000, "Iniziamo?"), seg("them", 65000, "Sì.")],
            "David",
        );
        assert_eq!(out, "[00:00] David: Ciao. Iniziamo?\n[01:05] Altri: Sì.");
    }

    #[test]
    fn moment_excerpt_looks_mostly_backwards() {
        let seg = |t: i64, txt: &str| TranscriptSegment {
            id: 0,
            meeting_id: "m".into(),
            source: "them".into(),
            start_ms: t,
            end_ms: t + 5000,
            text: txt.into(),
            review: false,
        };
        let segments = [seg(0, "Presto."), seg(60_000, "Il prezzo è 40."), seg(130_000, "Subito dopo."), seg(200_000, "Tardi.")];
        let out = moment_excerpt(&segments, 120_000, "David");
        assert_eq!(out, "[01:00] Altri: Il prezzo è 40. Subito dopo.");
        assert_eq!(moment_excerpt(&segments, 600_000, "David"), "");
    }

    #[test]
    fn parses_one_line_per_moment() {
        let out = parse_moments("1: Il prezzo sale a 40: da gennaio.\n**2**: -\n[3] : Rilascio giovedì.\n9: fuori\nchiacchiere", 3);
        assert_eq!(out, vec![Some("Il prezzo sale a 40: da gennaio.".to_string()), None, Some("Rilascio giovedì.".to_string())]);
    }
}
