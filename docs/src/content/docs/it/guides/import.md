---
title: Importare da Obsidian
description: Copia le note di un vault Obsidian in Granello, con immagini, file, link, tag e cartelle. Il vault Obsidian viene solo letto.
---

**Impostazioni → Importa da** copia le note di un vault Obsidian nel vault di Granello aperto. Il vault Obsidian viene solo letto: non cambia niente, e puoi continuare a usarlo.

## Come funziona

1. Premi **Scegli il vault Obsidian…** e scegli la cartella del vault (quella che contiene `.obsidian`).
2. Granello legge la cartella e mostra cosa importerebbe: quante note, quanti file, quali progetti, e cosa resta fuori e perché. Non copia ancora niente.
3. Premi **Importa N note**.

Ogni nota importata riceve il tag `#obsidian` e la privacy minima del vault aperto. Niente viene inviato a un modello AI: le note non vengono arricchite, e puoi farlo dopo, nota per nota.

## Cosa diventa cosa

| In Obsidian | In Granello |
| --- | --- |
| Una nota | Una nota, con il nome del file come titolo (o la proprietà `title`) |
| `[[Nota]]`, `[[Nota\|testo]]` | Un [link a quella nota](/it/guides/notes/#blocchi) |
| `[[Nota#Titolo]]`, `![[Nota]]` | Un link alla nota (Granello non ha link a un'intestazione e non incorpora una nota in un'altra) |
| `![[immagine.png]]`, `![](immagine.png)` | Un'immagine, copiata tra gli allegati del vault |
| `![[file.pdf]]`, `[testo](file.pdf)` | Un allegato, copiato |
| Una cartella di primo livello | Il progetto delle note che contiene, creato se non c'è ancora |
| Le cartelle più interne | Un tag: `Lavoro/Clienti/Acme.md` va nel progetto "Lavoro" con il tag `clienti` |
| Le cartelle PARA (`Projects`, `Areas`, `Resources`, `Archive`, o `Progetti`, `Aree`, `Risorse`, `Archivio`, anche numerate come `1 - Projects`) | La cartella sotto è il progetto e la categoria un tag: `Projects/Acme/Call.md` va in "Acme" con il tag `projects`. I progetti che arrivano solo da `Archive` nascono archiviati |
| Le cartelle che cominciano con `_` (`_daily`) | Solo un tag (`daily`), mai un progetto |
| La proprietà `progetto` o `project` | Il progetto della nota, al posto della cartella |
| La proprietà `partecipanti`, `attendees` o `participants` | I partecipanti della nota, aggiunti a [Persone](/it/guides/people/) |
| `tags` e i `#tag` nel testo | Tag |
| `created` o `date`, o una data nel nome del file | La data della nota; altrimenti la data del file |
| Le altre proprietà (`status`, `aliases`, …) | Una sezione richiudibile **Proprietà** in cima alla nota (quelle vuote si tolgono) |
| I callout (`> [!tip]`, `> [!danger]`…) | Il riquadro più vicino: nota, attenzione o decisione |
| I callout piegabili (`> [!faq]-`) | Una sezione richiudibile |
| I task `- [/]`, `- [-]`, `- [>]`… | Task aperti |
| `%%commenti%%` e `^id-blocco` | Tolti |
| I file che nessuna nota usa | **Libreria → File**, senza nota |

I blocchi di codice restano come sono, comprese le query `dataview`. Un link a una nota che non c'è resta un link, segnato come mancante, e funziona appena crei una nota con quel titolo.

## Cosa resta fuori

- La cartella dei template di Obsidian (quella impostata in Obsidian, o una cartella di primo livello che si chiama `Templates` o `_templates`), le cartelle nascoste (`.obsidian`, `.trash`), i canvas (`.canvas`) e le basi (`.base`).
- I disegni di Excalidraw.
- I file più grandi di 25 MB e le note più grandi di 5 MB.

Il riepilogo prima dell'import li elenca uno per uno, con il motivo.

## Importare di nuovo

Importando di nuovo la stessa cartella arriva solo quello che è nuovo: le note già importate si saltano. Una nota cambiata in Obsidian dopo l'import non viene aggiornata; il riepilogo la elenca. Una nota che hai eliminato in Granello viene importata di nuovo.

## Annullare un import

Ogni import resta in elenco sotto **Import fatti**. **Annulla import** elimina le note e i file che ha portato, anche se li hai modificati dopo, e i progetti e le persone che ha creato se restano vuoti. I progetti e le persone che avevi già restano.
