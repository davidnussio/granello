---
title: Registrare e trascrivere
description: Microfono e audio della call, caricare un file, più persone a un microfono, i momenti segnati.
---

## Due sorgenti

Granello registra due cose separate:

- il tuo **microfono**, che nella trascrizione compare come "Tu";
- l'**audio della call**, che compare come "Altri".

Per l'audio della call scegli **Audio di sistema** come "Audio degli altri partecipanti", nelle Impostazioni o accanto al pulsante Registra. Granello registra allora quello che il computer riproduce, senza installare niente. Serve macOS 14.6 o successivo, e la prima volta macOS chiede il permesso (*Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo e audio di sistema*).

Usa le cuffie. Senza, il microfono prende anche gli altri e nella trascrizione le loro parole compaiono due volte.

Sui sistemi più vecchi, vedi [problemi comuni](/it/reference/troubleshooting/) per il dispositivo di loopback.

## Mentre registri

- La barra sotto la nota mostra i livelli dell'audio e il tempo.
- Il pannello **Trascrizione** a destra è aperto fin dall'inizio, e il testo ci sta accanto anche sullo schermo di un portatile. Il titolo dice quanti pezzi ha la trascrizione; l'icona della barra laterale nell'angolo in alto a destra lo chiude e lo riapre.
- **⚑ Segna** (⇧⌘M), in fondo al pannello, aggiunge alla nota un segno con il minuto, senza spostare il cursore. A fine trascrizione l'AI scrive in ogni segno cosa si stava dicendo in quel minuto. A pannello chiuso il pulsante passa nella barra sotto la nota.
- **❝ Cita**, accanto, mette nella nota l'ultima frase trascritta, con chi l'ha detta e il minuto.
- **Al microfono** dice chi sta parlando quando più persone usano lo stesso microfono. Da quel momento la trascrizione attribuisce il parlato a quella persona.

Puoi fermare e riprendere sulla stessa nota: la trascrizione continua.

## Come funziona la trascrizione

L'audio viene tagliato sulle pause, in pezzi da 6 a 20 secondi, e ogni pezzo viene trascritto sul Mac da whisper.cpp. Il titolo e i partecipanti della nota vengono dati al modello come aiuto per nomi e termini. Le frasi che i modelli vocali inventano sul silenzio vengono filtrate.

## Caricare un file

**Carica audio** trascrive un file esistente invece di registrare dal vivo: MP3, M4A/AAC, WAV, FLAC, OGG Vorbis, AIFF, CAF, oppure la traccia audio di un video MP4 o MOV. Il file viene letto dov'è e non viene mai copiato. Opus non è supportato.

## Chi ha detto cosa

Seleziona una parte qualsiasi della trascrizione e usa **Chi parla…** per attribuirla a un partecipante, a te o a un nome nuovo.

## Registrazioni salvate

Con **Salva le registrazioni** attivo (nelle Impostazioni, spento di default), l'audio che registri resta in una cartella del Mac. Si riascolta accanto alla trascrizione, oppure nella Libreria alla voce **File → Registrazioni**. Vedi [la Libreria](/it/guides/library/).

## Se qualcosa va storto

Se chiudi l'app mentre registra, l'audio già registrato viene trascritto prima della chiusura. Se il dispositivo audio viene scollegato, la sessione si chiude in ordine e tiene quello che è stato registrato.
