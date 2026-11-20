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

## Provarla senza il backend

L'interfaccia gira anche nel browser con dati di esempio, senza registrazione e senza AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=it
```

## Aggiornamenti

Quando ci saranno i rilasci, l'app controllerà all'avvio se c'è una versione nuova e chiederà prima di installarla. Si riavvia solo se non sta registrando.

Poi: [il primo meeting](/it/start/first-meeting/).
