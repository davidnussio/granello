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

## Cartella delle registrazioni

**Impostazioni → Registrazioni** ti fa scegliere dove vanno le registrazioni salvate. Quelle fatte prima del cambio restano dov'erano e continuano a funzionare.

## Eliminare

- Eliminare un meeting toglie le sue note, la sua trascrizione e le sue registrazioni salvate.
- **Togli i dati di esempio** toglie solo i meeting di esempio.
- Per togliere tutto, chiudi Granello ed elimina la cartella dei dati e quella dei log.

## Versioni del database

Il database viene aggiornato quando lo apre una versione nuova di Granello. Una versione più vecchia dell'app non apre un database creato da una più nuova.
