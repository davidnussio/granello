---
title: Installazione
description: Scarica Granello per macOS (Linux e Windows sono sperimentali), aprilo la prima volta o compilalo dal codice.
---

Granello gira su macOS. Esistono anche le versioni per Linux e Windows, ancora sperimentali.

## Homebrew

Su Mac, il modo più rapido:

```bash
brew install --cask davidnussio/tap/granello
```

Homebrew sceglie la versione per Apple Silicon o Intel, e Granello si apre subito, senza il passaggio di Gatekeeper descritto sotto.

## Download

Oppure scarica il file per il tuo sistema dall'[ultimo rilascio](https://github.com/davidnussio/granello/releases/latest):

| Sistema | File |
| --- | --- |
| Mac con Apple Silicon | `Granello-<versione>-macOS-arm64.dmg` |
| Mac con Intel | `Granello-<versione>-macOS-intel.dmg` |
| Linux (x86_64) | `Granello-<versione>-linux-x86_64.AppImage` |
| Windows (x86_64) | `Granello-<versione>-windows-x86_64-setup.exe` |

**macOS**: serve macOS 13 o successivo; per registrare gli altri partecipanti dall'audio di sistema serve macOS 14.6 o successivo. Apri il DMG e trascina Granello in Applicazioni. L'app non è ancora firmata con un Developer ID di Apple, quindi macOS la blocca la prima volta: apri *Impostazioni di Sistema → Privacy e sicurezza* e fai clic su *Apri comunque*. Se macOS dice che l'app è danneggiata, esegui nel Terminale:

```bash
xattr -dr com.apple.quarantine /Applications/Granello.app
```

**Linux**: rendi eseguibile l'AppImage (`chmod +x Granello-*.AppImage`), poi avvialo.

**Windows**: l'installer non è firmato, quindi al primo avvio SmartScreen mostra un avviso: fai clic su *Ulteriori informazioni*, poi su *Esegui comunque*.

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

## Linux e Windows (sperimentale)

Le versioni per Linux e Windows vengono dallo stesso codice. Sono **sperimentali**: compilano e passano i test, ma non sono ancora state provate su computer di tutti i giorni.

Cosa cambia rispetto al Mac:

- La **trascrizione** gira sulla CPU, senza accelerazione grafica: è più lenta. Un modello più piccolo, come `small`, tiene meglio il passo.
- **Audio di sistema**: su Windows Granello ascolta l'uscita audio predefinita. Su Linux registra la sorgente "monitor" dell'uscita predefinita, e serve PulseAudio o PipeWire. In alternativa, scegli un dispositivo "Monitor" come sorgente degli altri partecipanti.
- Le **API key** vanno in Gestione credenziali di Windows. Su Linux restano in un file della cartella dati leggibile solo dal tuo utente.

Requisiti per compilarle dal codice:

- **Linux** (Debian, Ubuntu e derivate): `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libasound2-dev cmake`, più Rust, Node e pnpm. `pnpm tauri build` produce un AppImage.
- **Windows**: Visual Studio Build Tools con il carico di lavoro C++, `cmake`, più Rust, Node e pnpm. `pnpm tauri build` produce un installer. Non è firmato, quindi al primo avvio Windows SmartScreen mostra un avviso.

## Provarla senza il backend

L'interfaccia gira anche nel browser con dati di esempio, senza registrazione e senza AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=it
```

## Aggiornamenti

L'app controlla all'avvio se c'è una versione nuova e chiede prima di installarla. Si riavvia solo se non sta registrando.

Poi: [il primo meeting](/it/start/first-meeting/).
