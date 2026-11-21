---
title: Installazione
description: Scarica Granello per i Mac con Apple Silicon, aprilo la prima volta o compilalo dal codice.
---

Granello gira sui Mac con Apple Silicon (M1 o successivi) e macOS 13 o successivo.

## Homebrew

Su Mac, il modo più rapido:

```bash
brew install --cask davidnussio/tap/granello
```

Granello si apre subito, senza il passaggio di Gatekeeper descritto sotto.

## Download

Oppure scarica `Granello-<versione>-macOS-arm64.dmg` dall'[ultimo rilascio](https://github.com/davidnussio/granello/releases/latest). Per registrare gli altri partecipanti dall'audio di sistema serve macOS 14.6 o successivo. Apri il DMG e trascina Granello in Applicazioni. L'app non è ancora firmata con un Developer ID di Apple, quindi macOS la blocca la prima volta: apri *Impostazioni di Sistema → Privacy e sicurezza* e fai clic su *Apri comunque*. Se macOS dice che l'app è danneggiata, esegui nel Terminale:

```bash
xattr -dr com.apple.quarantine /Applications/Granello.app
```

## Compilare dal codice

Requisiti:

- macOS 13 o successivo.
- Rust stabile, Node 20 o successivo, pnpm.
- Xcode Command Line Tools e `cmake` (`brew install cmake`).

```bash
git clone https://github.com/davidnussio/granello.git
cd granello
pnpm install
pnpm tauri dev      # avvio in sviluppo
pnpm tauri build    # .app e .dmg in src-tauri/target/release/bundle
```

I pacchetti di rilascio includono un piccolo ffmpeg, che serve a comprimere le registrazioni e a togliere le pause. Una build dal codice usa l'ffmpeg installato sul computer, se c'è. Per includerlo come nei rilasci:

```bash
scripts/build-ffmpeg.sh
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

La build **non è firmata** con un Developer ID di Apple. Sul Mac che l'ha compilata si apre normalmente. Copiata su un altro Mac, Gatekeeper la blocca al primo avvio.

## Provarla senza il backend

L'interfaccia gira anche nel browser con dati di esempio, senza registrazione e senza AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=it
```

## Aggiornamenti

L'app controlla all'avvio se c'è una versione nuova e chiede prima di installarla. Si riavvia solo se non sta registrando.

Poi: [il primo meeting](/it/start/first-meeting/).
