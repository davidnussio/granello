---
title: Come funziona la privacy
description: Cosa resta sul tuo Mac, cosa può uscirne e quando. La versione breve, con una tabella.
---

Granello è fatto perché quello che si dice in riunione resti tuo. Questa pagina dice con precisione cosa resta sul Mac e cosa può uscirne.

## In breve

- L'**audio** viene trascritto sul Mac e poi scartato. Non viene salvato né caricato, a meno che tu non attivi una delle due opzioni qui sotto.
- **Note e trascrizioni** stanno in un database sul tuo Mac.
- Il **testo** (note e trascrizione) viene inviato al provider AI che hai configurato, solo quando generi le note AI, usi la chat o una funzione AI dell'editor. Con un provider locale non esce niente dal Mac.
- **Nessun bot** entra nella call, e Granello non ha un account né un server suo.

## Cosa può uscire dal Mac

| Cosa | Quando | Come evitarlo |
| --- | --- | --- |
| Note e trascrizione, come testo | Generi le note AI, fai una domanda in chat o usi ✦ nell'editor, con un provider AI online | Usa un [provider locale](/it/privacy/local-models/), oppure metti il meeting su [blindata](/it/privacy/levels/) |
| Un template che descrivi all'AI, con i suoi campi attuali | Usi **Configura con l'AI** in un template, con un provider AI online | Usa un [provider locale](/it/privacy/local-models/) per le note AI |
| L'audio del meeting | Solo con la **trascrizione online** attiva, e solo quando premi *Affina online* su quel meeting | Lascia l'opzione spenta (è così di default), oppure metti il meeting su audio locale o blindata |
| L'indirizzo di un link | Crei l'anteprima di un link: alla pagina viene chiesto il titolo, una volta | Non creare anteprime dei link |
| Una richiesta di contenuto incorporato | Premi **Carica** su un contenuto incorporato (video, progetto grafico, mappa) | Non premere Carica |
| Una richiesta al tuo calendario | Granello scarica gli indirizzi iCal che hai aggiunto | Non aggiungere un calendario |
| Il controllo degli aggiornamenti | All'avvio dell'app | — |
| Lo scaricamento di un modello | Scarichi un modello di trascrizione dalle Impostazioni | Serve una volta, per trascrivere sul Mac |

Le immagini da Internet non vengono mai caricate in una nota.

La rubrica del Mac si legge solo se attivi **Proponi i contatti della rubrica** in *Impostazioni → Persone* (spento di default), solo per proporre i nomi che scrivi e le loro email, e non lascia mai il Mac. Vedi [Persone](/it/guides/people/).

## Le due opzioni che conservano l'audio

Tutte e due sono **spente di default**.

- **Salva le registrazioni** tiene l'audio di ogni meeting in una cartella del tuo Mac, per riascoltarlo. Non viene mai caricato.
- **Trascrizione online** tiene l'audio di un meeting quando finisce, e il meeting propone *Affina online*: solo se lo premi l'audio viene caricato su un servizio di trascrizione online, per avere una trascrizione che distingue i parlanti. L'audio resta nella cartella dei dati finché non lo carichi o lo elimini, e dopo il caricamento viene cancellato. Non parte mai per un meeting con privacy audio locale o blindata, né con parti ancora da verificare.

## Dove stanno le cose

- Il database, i modelli di trascrizione e gli allegati sono in `~/Library/Application Support/ch.dambox.granello/`.
- Le API key sono nel Portachiavi di macOS.
- I log non contengono note, trascrizioni, API key né indirizzi del calendario.

Di più in [dati e file](/it/reference/data/).

## Cosa decidi per ogni meeting

- Il [livello di privacy](/it/privacy/levels/) decide se qualcosa di quel meeting può uscire dal Mac.
- [Oscura e verifica](/it/privacy/redaction/) tolgono una frase per sempre, oppure trattengono un meeting finché non l'hai guardato.
