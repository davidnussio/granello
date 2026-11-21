---
title: Problemi comuni
description: Il microfono non dà segnale, gli altri non vengono registrati, l'app non si apre, le note AI si fermano.
---

## Il microfono non dà segnale

Se per 8 secondi non si sente niente, Granello mostra un suggerimento. Controlla *Impostazioni di Sistema → Privacy e sicurezza → Microfono*, consenti Granello e fai ripartire la registrazione.

## Gli altri non sono nella trascrizione

- Scegli **Audio di sistema** come "Audio degli altri partecipanti". Serve macOS 14.6 o successivo.
- Consenti Granello in *Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo e audio di sistema*.
- Non scegliere il dispositivo virtuale che un'app di videochiamata installa per condividere l'audio del computer: non porta le voci della call.

### Sui sistemi più vecchi: un dispositivo di loopback

1. `brew install blackhole-2ch`
2. In *Configurazione MIDI Audio* crea un **dispositivo multi-uscita** con le tue cuffie e BlackHole 2ch.
3. Imposta quel dispositivo come uscita di sistema, o come uscita dell'app di videochiamata.
4. In Granello scegli *BlackHole 2ch* come "Audio degli altri partecipanti".

## Nella trascrizione tutto compare due volte

Il microfono sta prendendo gli altoparlanti. Usa le cuffie: la cancellazione dell'eco non c'è ancora.

## Un nome continua a comparire nella trascrizione

I modelli vocali possono ripetere un suggerimento sul silenzio o sul rumore. Granello filtra queste ripetizioni; una trascrizione fatta da una versione precedente le conserva.

## macOS dice che l'app non può essere aperta

Una build fatta su un altro Mac non è firmata con un Developer ID di Apple, quindi Gatekeeper la blocca. Compilala sul Mac dove la usi: vedi [installazione](/it/start/install/).

## Le note AI si fermano con un errore sulla dimensione

Il meeting è più lungo di quello che il modello locale accetta. Usa un modello con un contesto più grande, alza il contesto nel server locale e indica il valore vero nel campo **Contesto (token)** del provider. Vedi [modelli locali](/it/privacy/local-models/).

## Le funzioni AI non sono disponibili su un meeting

Il meeting è **blindato** e non c'è un provider locale configurato, oppure ha parti **da verificare**. Vedi [livelli di privacy](/it/privacy/levels/) e [oscura e verifica](/it/privacy/redaction/).

## Mancano Togli le pause e Unisci

Serve ffmpeg. I pacchetti di rilascio lo includono. In una build dal codice installalo (`brew install ffmpeg` sul Mac) oppure includilo come spiegato in [Installazione](/it/start/install/), poi riapri Granello.

## Ancora bloccato

Apri una segnalazione su [GitHub](https://github.com/davidnussio/granello/issues). Il file di log è in `~/Library/Logs/ch.dambox.granello/Granello.log` e non contiene note né trascrizioni.
