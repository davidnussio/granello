// Un esempio per ogni comando del menu "/" dell'editor, in Markdown, con i dati di esempio.
// `pnpm screenshots` li carica uno alla volta in una nota e fotografa il risultato per la
// documentazione (docs/src/assets/shots/<lingua>/commands/<id>.webp). Ogni id corrisponde a una
// sezione di docs/src/content/docs/reference/slash-commands.md (e della versione italiana).

/** Data ISO a `days` giorni da oggi, come le date `{{date:±N}}` dei dati di esempio. */
const day = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** `image` è un data URL (le immagini vere stanno negli allegati, che l'anteprima non ha). */
export function commandExamples(lang, image) {
  const it = lang === "it";
  const pick = (itText, enText) => (it ? itText : enText);
  return [
    {
      id: "text",
      md: pick(
        "La direzione di Nord ha approvato i due anni. Marco manda il contratto firmato entro venerdì.",
        "Nord's board approved the two years. Marco sends the signed contract by Friday.",
      ),
    },
    { id: "title", md: pick("# Rinnovo contratto Nord 2027", "# Nord contract renewal 2027") },
    {
      id: "section",
      md: pick(
        "## Prossimi passi\n\nLa controproposta parte entro mercoledì.",
        "## Next steps\n\nThe counter-offer goes out by Wednesday.",
      ),
    },
    {
      id: "subsection",
      md: pick(
        "### Prezzi\n\nL'8% su due anni tiene il margine sopra il 30%.",
        "### Pricing\n\n8% over two years keeps the margin above 30%.",
      ),
    },
    {
      id: "toc",
      md: pick(
        "[[toc]]\n\n## Contesto\n\n## Le due strade\n\n### Prezzi\n\n## Prossimi passi",
        "[[toc]]\n\n## Context\n\n## The two options\n\n### Pricing\n\n## Next steps",
      ),
    },
    {
      id: "bullet-list",
      md: pick(
        "- Il prezzo è più alto di quello del concorrente\n- Vogliono l'integrazione con il CRM prima del go-live\n- Due anni vanno approvati dalla loro direzione",
        "- The price is higher than the competitor's\n- They want the CRM integration before go-live\n- Two years need their board's approval",
      ),
    },
    {
      id: "numbered-list",
      md: pick(
        "1. Calcolare il margine\n2. Mandare la controproposta\n3. Fissare la call di chiusura",
        "1. Work out the margin\n2. Send the counter-offer\n3. Schedule the closing call",
      ),
    },
    {
      id: "action-item",
      md: pick(
        `- [x] Calcolare il margine con le tre ipotesi\n- [ ] @[Elena Rossi]: mandare la controproposta scritta entro il [[${day(2)}]]\n- [ ] Fissare la call di chiusura`,
        `- [x] Work out the margin for the three scenarios\n- [ ] @[Elena Rossi]: send the written counter-offer by [[${day(2)}]]\n- [ ] Schedule the closing call`,
      ),
    },
    {
      id: "quote",
      md: pick(
        "> Prima di disegnare una schermata voglio vedere tre persone usare quella che esiste già.",
        "> Before I draw a screen I want to watch three people use the one that already exists.",
      ),
    },
    {
      id: "code-block",
      md: '```json\n{ "discount": 0.08, "months": 24, "crm": true }\n```',
    },
    {
      id: "divider",
      md: pick(
        "Prima della call: margine e proposta pronti.\n\n---\n\nDopo la call: Nord accetta l'8% su due anni.",
        "Before the call: margin and proposal ready.\n\n---\n\nAfter the call: Nord accepts 8% over two years.",
      ),
    },
    {
      id: "table",
      md: pick(
        "| Proposta | Sconto | Durata | Margine |\n| --- | --- | --- | --- |\n| Richiesta di Nord | 10% | 1 anno | 27% |\n| Nostra controproposta | 8% | 2 anni | 31% |\n| Senza sconto | 0% | 1 anno | 36% |",
        "| Proposal | Discount | Term | Margin |\n| --- | --- | --- | --- |\n| Nord's request | 10% | 1 year | 27% |\n| Our counter-offer | 8% | 2 years | 31% |\n| No discount | 0% | 1 year | 36% |",
      ),
    },
    {
      id: "details",
      md: pick(
        "::: details Chi decide cosa\nBudget e contratto: direzione di Nord, tramite Marco.\n\nTempi tecnici: Luca.\n:::",
        "::: details Who decides what\nBudget and contract: Nord's board, through Marco.\n\nTechnical timing: Luca.\n:::",
      ),
    },
    {
      id: "two-columns",
      md: pick(
        ":::: columns\n::: column\n**Nord chiede**\n\nIl 10% di sconto su un anno.\n:::\n\n::: column\n**Noi offriamo**\n\nL'8% su due anni, con l'integrazione CRM.\n:::\n\n::::",
        ":::: columns\n::: column\n**Nord asks**\n\nA 10% discount over one year.\n:::\n\n::: column\n**We offer**\n\n8% over two years, with the CRM integration.\n:::\n\n::::",
      ),
    },
    {
      id: "three-columns",
      md: pick(
        ":::: columns\n::: column\n**Notifiche**\n\nPrototipo pronto.\n:::\n\n::: column\n**Uso offline**\n\nIn progettazione.\n:::\n\n::: column\n**Firma digitale**\n\nDopo l'estate.\n:::\n\n::::",
        ":::: columns\n::: column\n**Notifications**\n\nPrototype ready.\n:::\n\n::: column\n**Offline use**\n\nBeing designed.\n:::\n\n::: column\n**Digital signature**\n\nAfter the summer.\n:::\n\n::::",
      ),
    },
    {
      id: "formula",
      md: pick(
        "Il margine è $m = (p - c) / p$: con l'8% resta sopra il 30%.",
        "The margin is $m = (p - c) / p$: with 8% it stays above 30%.",
      ),
    },
    { id: "block-formula", md: "$$\nm = \\frac{p - c}{p}\n$$" },
    {
      id: "note",
      md: pick(
        "> [!NOTE]\n> Marco preferisce ricevere un riepilogo scritto dopo ogni incontro.",
        "> [!NOTE]\n> Marco prefers a written summary after every meeting.",
      ),
    },
    {
      id: "warning",
      md: pick(
        "> [!WARNING]\n> I campi personalizzati del loro CRM non sono documentati: serve un export da Nord.",
        "> [!WARNING]\n> The custom fields of their CRM are undocumented: we need an export from Nord.",
      ),
    },
    {
      id: "decision-callout",
      md: pick(
        `> [!DECISION]\n> Controproposta: 8% su due anni, integrazione CRM inclusa. Scade il [[${day(10)}]].`,
        `> [!DECISION]\n> Counter-offer: 8% over two years, CRM integration included. Expires on [[${day(10)}]].`,
      ),
    },
    { id: "image", md: `![${pick("Il logo di Granello", "Granello's logo")}](${image})` },
    {
      id: "attachment",
      md: pick(
        "La proposta firmata: [📎 controproposta-nord.pdf (84 KB)](attachments/controproposta-nord.pdf)",
        "The signed proposal: [📎 nord-counter-offer.pdf (84 KB)](attachments/nord-counter-offer.pdf)",
      ),
    },
    {
      id: "link-preview",
      md: pick(
        '[Listino Nord Logistica](https://nord.example.com/listino "preview")',
        '[Nord Logistics price list](https://nord.example.com/pricing "preview")',
      ),
    },
    {
      id: "decision",
      md: pick(
        "**Decisione:** 8% su due anni, integrazione CRM inclusa.",
        "**Decision:** 8% over two years, CRM integration included.",
      ),
    },
    {
      id: "open-question",
      md: pick(
        "**Da chiarire:** chi firma per Nord, Marco o la direzione?",
        "**To clarify:** who signs for Nord, Marco or the board?",
      ),
    },
    {
      id: "current-time",
      md: pick(
        "10:42 Entra Marco, la direzione ha visto la proposta.",
        "10:42 Marco joins: the board has seen the proposal.",
      ),
    },
    {
      id: "poll",
      md: pick(
        "::: poll Giorno della riunione settimanale\n- [1] Lunedì mattina\n- [3] Giovedì pomeriggio\n- [0] Venerdì mattina\n:::",
        "::: poll Day of the weekly meeting\n- [1] Monday morning\n- [3] Thursday afternoon\n- [0] Friday morning\n:::",
      ),
    },
    {
      id: "kanban",
      md: pick(
        "::: kanban\n## Da fare\n- Mappare i campi personalizzati\n- Gestire i contatti duplicati\n## In corso\n- Ambiente di prova per Nord\n## Fatto\n- Autenticazione con il CRM\n- Prima sincronizzazione di prova\n:::",
        "::: kanban\n## To do\n- Map the custom fields\n- Handle duplicate contacts\n## In progress\n- Test environment for Nord\n## Done\n- Authentication with the CRM\n- First test sync\n:::",
      ),
    },
    {
      id: "timeline",
      md: pick(
        `::: timeline\n- ${day(-8)} Demo a Nord\n- ${day(12)} Ambiente di prova pronto\n- ${day(40)} Collaudo con i loro dati\n- ${day(95)} Go-live\n:::`,
        `::: timeline\n- ${day(-8)} Demo to Nord\n- ${day(12)} Test environment ready\n- ${day(40)} Acceptance test with their data\n- ${day(95)} Go-live\n:::`,
      ),
    },
    {
      id: "pros-cons",
      md: pick(
        "::: pros-cons\n+ Margine sopra il 30% con l'8%\n+ Due anni di ricavi certi\n- Il 10% ci porta sotto soglia\n- Altri clienti lo chiederanno\n= Offriamo l'8% su due anni, con l'integrazione CRM inclusa\n:::",
        "::: pros-cons\n+ Margin above 30% with 8%\n+ Two years of sure revenue\n- 10% takes us below threshold\n- Other clients will ask too\n= We offer 8% over two years, CRM integration included\n:::",
      ),
    },
    {
      id: "matrix",
      md: pick(
        "::: matrix\n| Criterio | Peso | Notifiche | Uso offline | Firma digitale |\n| --- | --- | --- | --- | --- |\n| Valore per i clienti | 3 | 4 | 5 | 3 |\n| Costo di sviluppo | 2 | 4 | 2 | 3 |\n| Rischio tecnico | 1 | 5 | 2 | 3 |\n:::",
        "::: matrix\n| Criterion | Weight | Notifications | Offline use | Digital signature |\n| --- | --- | --- | --- | --- |\n| Value to clients | 3 | 4 | 5 | 3 |\n| Development cost | 2 | 4 | 2 | 3 |\n| Technical risk | 1 | 5 | 2 | 3 |\n:::",
      ),
    },
    { id: "rating", md: pick("Qualità della demo: [[rating:4]]", "Quality of the demo: [[rating:4]]") },
    { id: "timer", md: pick("Giro di idee: [[timer:05:00]]", "Brainstorming round: [[timer:05:00]]") },
    {
      id: "progress",
      md: pick(
        "## Prossimi passi\n\n[[progress]]\n\n- [x] Calcolare il margine con le tre ipotesi\n- [x] Preparare la controproposta\n- [ ] @[Marco Bianchi]: portare la proposta in direzione\n- [ ] Fissare la call di chiusura",
        "## Next steps\n\n[[progress]]\n\n- [x] Work out the margin for the three scenarios\n- [x] Prepare the counter-offer\n- [ ] @[Marco Bianchi]: take the proposal to the board\n- [ ] Schedule the closing call",
      ),
    },
    {
      id: "chart",
      md: pick(
        "| Funzione | Richieste |\n| --- | --- |\n| Uso offline | 34 |\n| Notifiche | 21 |\n| Firma digitale | 12 |\n\n[[chart:bar]]",
        "| Feature | Requests |\n| --- | --- |\n| Offline use | 34 |\n| Notifications | 21 |\n| Digital signature | 12 |\n\n[[chart:bar]]",
      ),
    },
    {
      id: "diagram",
      md: pick(
        "```mermaid\nflowchart LR\n  A[Controproposta] --> B{Direzione Nord}\n  B -- Approva --> C[Contratto di due anni]\n  B -- Rifiuta --> D[Nuova call]\n```",
        "```mermaid\nflowchart LR\n  A[Counter-offer] --> B{Nord's board}\n  B -- Approves --> C[Two-year contract]\n  B -- Rejects --> D[New call]\n```",
      ),
    },
    {
      id: "whiteboard",
      md: "```sketch\n680x220\nink 2.5 60,30 260,30 260,190 60,190 60,30\nink 2.5 80,60 240,60\nink 2.5 80,95 240,95\nink 2.5 80,130 240,130\nblue 2.5 300,95 400,95 385,85\nblue 2.5 400,95 385,105\nink 2.5 430,50 620,50 620,140 430,140 430,50\nred 2.5 450,80 600,80\nink 2.5 450,110 560,110\n```",
    },
    {
      id: "embed",
      md: pick(
        '[Demo del prodotto](https://www.youtube.com/watch?v=aqz-KE-bpKQ "embed")',
        '[Product demo](https://www.youtube.com/watch?v=aqz-KE-bpKQ "embed")',
      ),
    },
    {
      id: "moment",
      md: pick(
        "::: moment 12:34\nElena propone l'8% in cambio di un contratto di due anni invece di uno.\n:::",
        "::: moment 12:34\nElena offers 8% in exchange for a two-year contract instead of one.\n:::",
      ),
    },
    {
      id: "transcript-quote",
      md: pick(
        "::: quote 11:48 Marco Bianchi\nSe non arriviamo al 10%, a gennaio dobbiamo guardare altrove.\n:::",
        "::: quote 11:48 Marco Bianchi\nIf we don't get to 10%, in January we have to look elsewhere.\n:::",
      ),
    },
    {
      id: "ask-ai",
      md: pick(
        "::: ai Quali sono le obiezioni di Nord?\n- Il prezzo è più alto di quello del concorrente\n- Vogliono l'integrazione con il CRM prima del go-live\n- Un impegno di due anni va approvato dalla loro direzione\n:::",
        "::: ai What are Nord's objections?\n- The price is higher than the competitor's\n- They want the CRM integration before go-live\n- A two-year commitment needs their board's approval\n:::",
      ),
    },
    {
      id: "person",
      md: pick(
        "@[Elena Rossi] manda la controproposta, @[Marco Bianchi] la porta in direzione.",
        "@[Elena Rossi] sends the counter-offer, @[Marco Bianchi] takes it to the board.",
      ),
    },
    { id: "today", md: pick(`Call di chiusura: [[${day(0)}]]`, `Closing call: [[${day(0)}]]`) },
    {
      id: "tomorrow",
      md: pick(`Controproposta scritta entro: [[${day(1)}]]`, `Written counter-offer by: [[${day(1)}]]`),
    },
  ];
}
