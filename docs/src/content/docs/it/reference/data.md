---
title: Dati e file
description: Dove Granello tiene meeting, modelli, registrazioni, chiavi e log, e come farne una copia.
---

Tutto quello che Granello salva è sul tuo Mac.

## La cartella dei dati

`~/Library/Application Support/ch.dambox.granello/`

| Voce | Cos'è |
| --- | --- |
| `granello.sqlite` | Il database: meeting, note, note AI, trascrizioni, tag, persone, template, impostazioni e indirizzi del calendario |
| `models/` | I modelli whisper che hai scaricato |
| `attachments/` | Le immagini incollate e i file allegati. Vengono tolti quando si elimina l'ultimo meeting che li usa |
| `recordings/` | Le registrazioni salvate, se non hai scelto un'altra cartella |
| `audio/` | L'audio in attesa della trascrizione online, solo con quell'opzione attiva. Cancellato dopo il caricamento |
| `waveforms/` | Le forme d'onda mostrate nei player, calcolate dalle registrazioni |

## Altrove

- **API key**: nel Portachiavi di macOS.
- **Log**: `~/Library/Logs/ch.dambox.granello/Granello.log`. Non contengono note, trascrizioni, API key né indirizzi del calendario.

## Copia di sicurezza

Chiudi Granello e copia la cartella dei dati. Time Machine la include di default. Per passare a un altro Mac, copia la cartella nello stesso posto e inserisci di nuovo le API key: il Portachiavi non fa parte della cartella.

## Vault

Un vault è una cartella con il suo database, i suoi allegati e le sue registrazioni: i meeting di un vault esistono solo lì. Mettine uno su un disco cifrato o esterno per tenere i meeting riservati separati dagli altri. La cartella dei dati qui sopra è il vault **Principale** e c'è sempre.

**Impostazioni → Vault** aggiunge un vault: dagli un nome, scegli la sua cartella e un livello minimo di privacy. Una cartella vuota diventa un vault nuovo; la cartella di un vault che esiste già, anche creato su un altro Mac, viene ritrovata con i suoi meeting.

- **Se ne apre uno alla volta.** Con più di un vault, un menu in cima alla barra laterale ne apre un altro. Elenco dei meeting, Libreria, ricerca e chat mostrano solo il vault aperto. Non si può cambiare vault mentre è in corso una registrazione o una generazione dell'AI.
- **Cosa contiene un vault**: `granello.sqlite` (meeting, note, note AI, trascrizioni, tag, progetti, persone, chat), `attachments/`, `recordings/`, `audio/` e `waveforms/`.
- **Cosa resta su questo Mac per tutti i vault**: impostazioni, template, indirizzi dei calendari, l'elenco dei vault, i modelli whisper e le API key.
- **Privacy minima**: nessuna, almeno audio locale, o sempre blindata. I meeting nuovi del vault partono da quel livello e non possono scendere sotto. Alzare il minimo alza subito i meeting del vault che stavano sotto. Vedi i [livelli di privacy](/it/privacy/levels/).
- **Un vault su un disco non collegato** compare come non disponibile. Se era quello aperto, Granello parte dal vault Principale.
- **Togli dall'elenco** dimentica soltanto il vault: la cartella e i suoi dati restano dove sono. Per eliminare un vault, elimina la sua cartella.

Granello non cifra un vault: la protezione viene da dove lo metti, per esempio un'immagine disco cifrata o un disco esterno cifrato.

## Cartella delle registrazioni

**Impostazioni → Audio e registrazioni** ti fa scegliere dove vanno le registrazioni salvate del vault Principale. Quelle fatte prima del cambio restano dov'erano e continuano a funzionare. Gli altri vault tengono sempre le registrazioni nella propria cartella.

## Eliminare

- Eliminare un meeting toglie le sue note, la sua trascrizione e le sue registrazioni salvate.
- **Togli i dati di esempio** toglie solo i meeting di esempio.
- Per togliere tutto, chiudi Granello ed elimina la cartella dei dati e quella dei log.

## Versioni del database

Il database viene aggiornato quando lo apre una versione nuova di Granello. Una versione più vecchia dell'app non apre un database creato da una più nuova.
