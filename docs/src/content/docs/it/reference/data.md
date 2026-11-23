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
| `audio/` | L'audio in attesa della trascrizione online, solo con quell'opzione attiva, finché non lo affini o lo elimini. Cancellato dopo il caricamento |
| `waveforms/` | Le forme d'onda mostrate nei player, calcolate dalle registrazioni |

## Altrove

- **API key**: nel Portachiavi di macOS.
- **Log**: `~/Library/Logs/ch.dambox.granello/Granello.log`. Non contengono note, trascrizioni, API key né indirizzi del calendario.

## Copia di sicurezza

Chiudi Granello e copia la cartella dei dati. Time Machine la include di default. Per passare a un altro Mac, copia la cartella nello stesso posto e inserisci di nuovo le API key: il Portachiavi non fa parte della cartella.

## Vault

Un vault è una cartella con il suo database, i suoi allegati e le sue registrazioni: i meeting di un vault esistono solo lì. Mettine uno su un disco cifrato o esterno per tenere i meeting riservati separati dagli altri. La cartella dei dati qui sopra è il vault **Principale** e c'è sempre.

**Impostazioni → Vault** aggiunge un vault: dagli un nome, scegli la sua cartella e un livello minimo di privacy. Una cartella vuota diventa un vault nuovo; la cartella di un vault che esiste già, anche creato su un altro Mac, viene ritrovata con i suoi meeting.

- **Se ne apre uno alla volta.** Con più di un vault, un'icona accanto a Impostazioni, in fondo alla barra laterale, ne apre un altro. Elenco dei meeting, Libreria, ricerca e chat mostrano solo il vault aperto. Non si può cambiare vault mentre è in corso una registrazione o una generazione dell'AI.
- **Cosa contiene un vault**: `granello.sqlite` (meeting, note, note AI, trascrizioni, tag, progetti, persone, chat), `attachments/`, `recordings/`, `audio/` e `waveforms/`.
- **Cosa resta su questo Mac per tutti i vault**: impostazioni, template, indirizzi dei calendari, l'elenco dei vault, i modelli whisper e le API key.
- **Calendari**: ogni calendario si configura una volta sola, e ogni vault sceglie quali mostrare nella Home e nelle notifiche: in **Impostazioni → Calendario** ("Mostrato in"), oppure con i nomi dei calendari sopra i prossimi meeting, che valgono per il vault aperto. Un calendario nuovo compare in tutti i vault finché non lo togli da uno.
- **Privacy minima**: nessuna, almeno audio locale, o sempre blindata. I meeting nuovi del vault partono da quel livello e non possono scendere sotto. Alzare il minimo alza subito i meeting del vault che stavano sotto. Vedi i [livelli di privacy](/it/privacy/levels/).
- **Un vault su un disco non collegato** compare come non disponibile. Se era quello aperto, Granello parte dal vault Principale.
- **Togli dall'elenco** dimentica soltanto il vault: la cartella e i suoi dati restano dove sono. Per eliminare un vault, elimina la sua cartella.

Granello non cifra un vault: la protezione viene da dove lo metti, per esempio un'immagine disco cifrata o un disco esterno cifrato.

## Cartella delle registrazioni

**Impostazioni → Audio e registrazioni** ti fa scegliere dove vanno le registrazioni salvate del vault Principale. Quelle fatte prima del cambio restano dov'erano e continuano a funzionare. Gli altri vault tengono sempre le registrazioni nella propria cartella.

## Anteprime per sviluppatori

**Impostazioni → Dati e privacy → Anteprime per sviluppatori** mostra le funzioni non ancora finite. È spenta di default. Un'anteprima può cambiare o sparire da una versione all'altra: provala solo con i dati di esempio.

### Sync tra i tuoi Mac

Per ora c'è un'anteprima: il sync di un vault tra i tuoi Mac attraverso una cartella, per esempio in iCloud Drive. Si attiva in **Impostazioni → Vault**, con aperto il vault da sincronizzare. La cartella di sync contiene note e trascrizioni in chiaro.

- **Si sincronizza solo il vault aperto**, non tutti. La cartella di sync non è un vault: il vault resta dov'è, e nella cartella ogni Mac scrive le sue modifiche, che gli altri Mac leggono e applicano.
- **Conflitti**: per ogni campo vince la modifica più recente. Se la stessa nota cambia su due Mac insieme, la versione rimasta indietro viene tenuta da parte.
- **Viaggiano**: meeting con note, note AI, partecipanti e tag, trascrizioni, progetti e persone.
- **Non viaggiano**: audio, registrazioni e allegati (per ora), impostazioni, template, calendari e API key.
- **Non viaggiano mai**: i meeting blindati. Un vault con privacy minima blindata non si sincronizza.

Per aggiungere un altro Mac, accendi lì le anteprime per sviluppatori, apri il vault che deve ricevere i dati (per esempio il Principale) e, in **Impostazioni → Vault**, scegli la stessa cartella di sync. Quel vault si unisce al primo: riceve i suoi meeting e manda i propri. Per tenerli separati, sull'altro Mac usa un vault nuovo e vuoto.

Ogni cartella di sync appartiene a un solo vault. Per sincronizzare un altro vault, aprilo e scegli un'altra cartella vuota, per esempio `Granello-Clienti` accanto alla prima.

## Eliminare

- Eliminare un meeting toglie le sue note, la sua trascrizione e le sue registrazioni salvate.
- **Togli i dati di esempio** toglie solo i meeting di esempio.
- Per togliere tutto, chiudi Granello ed elimina la cartella dei dati e quella dei log.

## Versioni del database

Il database viene aggiornato quando lo apre una versione nuova di Granello. Una versione più vecchia dell'app non apre un database creato da una più nuova.
