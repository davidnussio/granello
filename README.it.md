# Granello

[English](README.md) · **Italiano**

Clone di [Granola](https://granola.ai): scrivi poche note durante il meeting, Granello registra e trascrive **in locale** con whisper.cpp, poi un modello AI (Claude o un modello locale) unisce le tue note e la trascrizione in note complete. Nessun bot entra nella call.

## Funzioni

- **Note + registrazione**: editor Markdown (TipTap) con menu `/` dei comandi, barra di formattazione sulla selezione, link e checklist, salvataggio automatico, registrazione con livelli audio e cronometro, ripresa sullo stesso meeting.
- **Trascrizione locale**: whisper.cpp con Metal su Apple Silicon. L'audio viene tagliato sulle pause (6-20 s), ricampionato a 16 kHz e trascritto in un thread dedicato. Filtra le allucinazioni tipiche ("Sottotitoli a cura di QTSS", "[Musica]"...). Il titolo e i partecipanti vengono passati come prompt iniziale per migliorare nomi e termini.
- **Due sorgenti**: microfono ("Tu") e un dispositivo di loopback per l'audio della call ("Altri").
- **Note AI**: Claude (streaming) arricchisce le tue note seguendo il template scelto. Le note AI restano modificabili.
- **Template**: Generale, 1:1, Standup, Colloquio, Meeting cliente + template personalizzati.
- **Calendario**: URL iCal (Google, Outlook), eventi ricorrenti con RRULE, EXDATE e override, notifica prima dell'inizio, un click per aprire le note del meeting.
- **Chat**: domande su un meeting o su tutti (ricerca full-text SQLite FTS5 per trovare i meeting pertinenti, con citazione di titolo e data).
- **Ricerca** nella sidebar su titoli, note, note AI e trascrizioni.
- **Scorciatoie**: ⌘N nuove note, ⌘K cerca, ⌘, impostazioni.
- **Italiano e inglese**: l'interfaccia segue la lingua del Mac e si cambia da Impostazioni → Profilo.

## Modelli AI

Le note AI e la chat possono usare modelli diversi, anche di provider diversi (Impostazioni → Modelli AI). Due protocolli coprono tutto:

| Tipo di provider | Per cosa |
|---|---|
| Anthropic | Claude (provider predefinito, sempre presente) |
| Compatibile OpenAI | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter e qualsiasi server che esponga `/chat/completions` |

- L'elenco dei modelli viene letto dal server (`/models`); "Verifica" controlla che il provider risponda.
- Ogni provider ha la sua API key nel Portachiavi; i server locali di solito non ne vogliono una.
- **Contesto dei modelli locali**: un'ora di meeting sono decine di migliaia di token e i server locali troncano in silenzio quello che non ci sta (Ollama parte con un contesto ridotto). Indicando il contesto del provider, Granello stima la dimensione della richiesta e si ferma con un errore chiaro invece di produrre note su mezza trascrizione.
- Il ragionamento dei modelli "thinking" locali (`<think>…</think>`) viene tolto dalla risposta.
- Con un provider locale per note e chat non esce nulla dal Mac.

## Lingue

L'interfaccia è in italiano e in inglese. All'avvio segue la lingua del sistema (italiano se il Mac è in italiano, altrimenti inglese); da Impostazioni → Profilo si sceglie una lingua fissa e il cambio è immediato. Seguono la stessa lingua anche gli errori, le notifiche, i template di sistema e il formato di date e orari. La *lingua del meeting* (quella parlata, usata per la trascrizione e per le note AI) è un'impostazione separata.

Nel frontend l'italiano è la lingua sorgente: `t("Testo italiano")` cerca la traduzione in `src/i18n/en.ts`. `pnpm check` fallisce se un testo non ha la traduzione inglese. Nel backend ogni messaggio porta le due versioni: `tr("italiano", "english")`, `trf!` per i messaggi con parametri.

## Affidabilità

- **Niente meeting persi**: se chiudi l'app mentre registri, la cattura si ferma e l'audio già registrato viene trascritto prima dell'uscita (fino a 2 minuti). Dopo un crash, i meeting rimasti "in registrazione" vengono chiusi e reindicizzati al riavvio.
- **Dispositivo audio scollegato** (es. AirPods): la sessione si chiude in modo pulito con un avviso, tenendo quello che è stato registrato. Se il microfono non dà alcun segnale per 8 secondi compare un avviso sui permessi.
- **Modelli AI**: riprova automatica su errori transitori (429, 5xx, sovraccarico, rete), generazione annullabile, risposte troncate o interrotte segnalate invece che salvate in silenzio. Una rigenerazione fallita non tocca le note AI esistenti. Nella chat sul singolo meeting il contesto è in prompt cache.
- **Database**: migrazioni versionate (`PRAGMA user_version`), scritture in transazione, WAL. Un database creato da una versione più recente non viene aperto.
- **Download dei modelli**: file parziali rimossi in caso di errore, controllo di dimensione e formato, modelli eliminabili dalle Impostazioni.
- **Istanza singola**: aprire l'app una seconda volta porta in primo piano la finestra esistente.
- **Log** in `~/Library/Logs/ch.dambox.granello/Granello.log` (con rotazione). Non contengono note, trascrizioni, API key né l'URL del calendario.

## Privacy

L'audio non viene mai salvato: viene trascritto in locale e scartato. Note e trascrizioni restano nel database locale. Al provider AI scelto viene inviato solo testo (note e trascrizione) quando generi le note AI o usi la chat; con un provider locale non esce nulla dal Mac. Le API key stanno nel Portachiavi; l'URL iCal sta nel database locale.

## Architettura

```
src-tauri/src
├── lib.rs         setup, stato, log, istanza singola, uscita pulita, watcher calendario + notifiche
├── commands.rs    comandi Tauri (meeting, registrazione, AI, template, impostazioni, modelli, calendario)
├── audio.rs       cattura cpal (thread audio) + Chunker sulle pause + thread di trascrizione
├── transcribe.rs  whisper-rs, catalogo modelli, resampling, filtro allucinazioni
├── llm.rs         streaming dai modelli AI (Anthropic e compatibili OpenAI): retry, annullamento, prompt caching
├── prompts.rs     prompt di enhance/chat e template di sistema
├── calendar.rs    parser iCal + espansione ricorrenze
├── db.rs          SQLite (rusqlite bundled) + FTS5, migrazioni versionate, recupero dopo crash
├── secrets.rs     API key dei provider nel Portachiavi macOS
└── i18n.rs        lingua dei testi del backend (italiano / inglese)
src/               React + TypeScript (Vite)
├── editor/        editor delle note, composto da plugin
└── i18n/          traduzioni dell'interfaccia
```

### Editor a plugin

L'editor (`src/editor`) è un guscio TipTap che non conosce le singole funzioni: le ricava da una lista di plugin. Un plugin può contribuire estensioni TipTap, comandi per il menu `/` e pulsanti per la barra che compare sul testo selezionato.

```ts
// src/editor/plugins/esempio.ts
import type { EditorPlugin } from "../types";

export const esempio: EditorPlugin = {
  name: "esempio",
  extensions: () => [/* nodi, mark o scorciatoie TipTap */],
  commands: [
    {
      id: "rischio",
      title: "Rischio",
      icon: "!",
      group: "Meeting",
      keywords: ["rischio", "risk"],
      run: (e) => e.chain().focus().insertContent("**Rischio:** ").run(),
    },
  ],
  toolbar: [/* pulsanti, anche con un pannello proprio (vedi plugins/links.tsx) */],
};
```

Per attivarlo si aggiunge a `defaultPlugins` in `src/editor/index.ts`, oppure si passa una lista propria a `<NoteEditor plugins={...} />`. Un plugin con lo stesso `name` di uno esistente lo sostituisce. I plugin inclusi: `base`, `formatting`, `headings`, `lists`, `tasks`, `blocks`, `links`, `snippets`.

Dati in `~/Library/Application Support/ch.dambox.granello/` (database `granello.sqlite`, modelli in `models/`).

## Avvio

Requisiti: macOS 13+, Rust stable, Node 20+, pnpm, Xcode Command Line Tools, `cmake` (`brew install cmake`).

```bash
pnpm install
pnpm tauri dev          # sviluppo
pnpm tauri build      # .app e .dmg in src-tauri/target/release/bundle
```

Controlli prima di un rilascio:

```bash
pnpm check              # tsc + traduzioni + clippy (warning = errore) + cargo test
```

### Distribuzione

`pnpm tauri build` produce un'app **non firmata**: su un altro Mac Gatekeeper la blocca. Per distribuirla servono un certificato *Developer ID Application* e la notarizzazione Apple: imposta `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (password specifica per l'app) e `APPLE_TEAM_ID` prima del build, Tauri firma e notarizza da solo. Le entitlement per microfono e rete sono già in `src-tauri/entitlements.plist`.

Primo avvio (la Home mostra cosa manca):

1. **Impostazioni → Modelli AI**: incolla la API key di Claude (finisce nel Portachiavi; in alternativa esporta `ANTHROPIC_API_KEY`), oppure aggiungi un provider locale come LM Studio o Ollama.
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
- Aggiornamenti automatici (tauri-plugin-updater) una volta attiva la firma.
- Salvataggio opzionale dell'audio per ritrascrivere con un modello migliore.

## Test

```bash
cd src-tauri && cargo test
```

Coprono chunking audio, resampling, filtro allucinazioni, parser iCal con ricorrenze, streaming/retry/annullamento dei modelli AI (anche contro un server compatibile OpenAI simulato), validazione delle impostazioni, database, migrazioni, recupero dopo crash e ricerca.
