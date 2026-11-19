# Granello

Clone di [Granola](https://granola.ai): scrivi poche note durante il meeting, Granello registra e trascrive **in locale** con whisper.cpp, poi Claude unisce le tue note e la trascrizione in note complete. Nessun bot entra nella call.

## Funzioni

- **Note + registrazione**: editor Markdown (TipTap) con salvataggio automatico, registrazione con livelli audio e cronometro, ripresa sullo stesso meeting.
- **Trascrizione locale**: whisper.cpp con Metal su Apple Silicon. L'audio viene tagliato sulle pause (6-20 s), ricampionato a 16 kHz e trascritto in un thread dedicato. Filtra le allucinazioni tipiche ("Sottotitoli a cura di QTSS", "[Musica]"...). Il titolo e i partecipanti vengono passati come prompt iniziale per migliorare nomi e termini.
- **Due sorgenti**: microfono ("Tu") e un dispositivo di loopback per l'audio della call ("Altri").
- **Note AI**: Claude (streaming) arricchisce le tue note seguendo il template scelto. Le note AI restano modificabili.
- **Template**: Generale, 1:1, Standup, Colloquio, Meeting cliente + template personalizzati.
- **Calendario**: URL iCal (Google, Outlook), eventi ricorrenti con RRULE, EXDATE e override, notifica prima dell'inizio, un click per aprire le note del meeting.
- **Chat**: domande su un meeting o su tutti (ricerca full-text SQLite FTS5 per trovare i meeting pertinenti, con citazione di titolo e data).
- **Ricerca** nella sidebar su titoli, note, note AI e trascrizioni.

## Architettura

```
src-tauri/src
├── lib.rs         setup, stato, watcher calendario + notifiche
├── commands.rs    comandi Tauri (meeting, registrazione, AI, template, impostazioni, modelli, calendario)
├── audio.rs       cattura cpal (thread audio) + Chunker sulle pause + thread di trascrizione
├── transcribe.rs  whisper-rs, catalogo modelli, resampling, filtro allucinazioni
├── llm.rs         client Claude Messages API con streaming SSE
├── prompts.rs     prompt di enhance/chat e template di sistema
├── calendar.rs    parser iCal + espansione ricorrenze
├── db.rs          SQLite (rusqlite bundled) + FTS5
└── secrets.rs     API key nel Portachiavi macOS
src/               React + TypeScript (Vite)
```

Dati in `~/Library/Application Support/ch.dambox.granello/` (database `granello.sqlite`, modelli in `models/`).

## Avvio

Requisiti: macOS 13+, Rust stable, Node 20+, Xcode Command Line Tools, `cmake` (`brew install cmake`).

```bash
npm install
npm run tauri dev      # sviluppo
npm run tauri build    # .app e .dmg in src-tauri/target/release/bundle
```

Primo avvio:

1. **Impostazioni → Claude**: incolla la API key (finisce nel Portachiavi). In alternativa esporta `ANTHROPIC_API_KEY`.
2. **Impostazioni → Trascrizione**: scarica `large-v3-turbo-q5_0` (547 MB, consigliato su Apple Silicon) oppure `base` per una prova veloce.
3. **Impostazioni → Calendario**: incolla l'indirizzo segreto iCal.
4. Al primo Registra macOS chiede il permesso per il microfono.

## Audio degli altri partecipanti

Per ora l'audio di sistema passa da un dispositivo di loopback:

1. `brew install blackhole-2ch`
2. In *Configurazione MIDI Audio* crea un **dispositivo multi-uscita** con le cuffie + BlackHole 2ch.
3. Imposta quel dispositivo come uscita di sistema (o di Teams/Zoom).
4. In Granello scegli *BlackHole 2ch* come "Audio degli altri partecipanti".

Usa le cuffie: senza cancellazione dell'eco il microfono riprende anche gli altri e la trascrizione si duplica.

## Prossimi passi

- Cattura nativa dell'audio di sistema con ScreenCaptureKit / Core Audio process tap (macOS 14.2+), senza BlackHole.
- Cancellazione dell'eco tra microfono e audio di sistema.
- OAuth Google Calendar al posto dell'URL iCal.
- Esportazione verso Notion / Google Docs, condivisione delle note.

## Test

```bash
cd src-tauri && cargo test
```

Coprono chunking audio, resampling, filtro allucinazioni, parser iCal con ricorrenze, SSE di Claude, database e ricerca.
