---
title: Installazione
description: Granello non ha ancora un rilascio pubblicato. Ecco come compilarlo e avviarlo dal codice su macOS.
---

Granello gira su macOS. **Non c'è ancora un rilascio pubblicato**: per ora si compila dal codice. Quando i rilasci cominceranno, i file DMG per Apple Silicon e Intel saranno nella [pagina dei rilasci su GitHub](https://github.com/davidnussio/granello/releases), e l'app si aggiornerà da lì.

## Requisiti

- macOS 13 o successivo. Per registrare gli altri partecipanti dall'audio di sistema serve macOS 14.6 o successivo.
- Rust stabile, Node 20 o successivo, pnpm.
- Xcode Command Line Tools e `cmake` (`brew install cmake`).

## Compilare dal codice

```bash
git clone https://github.com/davidnussio/granello.git
cd granello
pnpm install
pnpm tauri dev      # avvio in sviluppo
pnpm tauri build    # .app e .dmg in src-tauri/target/release/bundle
```

La build **non è firmata** con un Developer ID di Apple. Sul Mac che l'ha compilata si apre normalmente. Copiata su un altro Mac, Gatekeeper la blocca al primo avvio.

## Linux e Windows (sperimentale)

Granello si compila anche su Linux e Windows, dallo stesso codice. Queste build sono **sperimentali**: compilano e passano i test, ma non sono ancora state provate su computer di tutti i giorni.

Cosa cambia rispetto al Mac:

- La **trascrizione** gira sulla CPU, senza accelerazione grafica: è più lenta. Un modello più piccolo, come `small`, tiene meglio il passo.
- **Audio di sistema**: su Windows Granello ascolta l'uscita audio predefinita. Su Linux registra la sorgente "monitor" dell'uscita predefinita, e serve PulseAudio o PipeWire. In alternativa, scegli un dispositivo "Monitor" come sorgente degli altri partecipanti.
- Le **API key** vanno in Gestione credenziali di Windows. Su Linux restano in un file della cartella dati leggibile solo dal tuo utente.

Requisiti per compilare:

- **Linux** (Debian, Ubuntu e derivate): `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libasound2-dev cmake`, più Rust, Node e pnpm. `pnpm tauri build` produce un AppImage.
- **Windows**: Visual Studio Build Tools con il carico di lavoro C++, `cmake`, più Rust, Node e pnpm. `pnpm tauri build` produce un installer. Non è firmato, quindi al primo avvio Windows SmartScreen mostra un avviso.

## Provarla senza il backend

L'interfaccia gira anche nel browser con dati di esempio, senza registrazione e senza AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=it
```

## Aggiornamenti

Quando ci saranno i rilasci, l'app controllerà all'avvio se c'è una versione nuova e chiederà prima di installarla. Si riavvia solo se non sta registrando.

Poi: [il primo meeting](/it/start/first-meeting/).
