# Granello

[English](README.md) · **Italiano**

Clone di [Granola](https://granola.ai): scrivi poche note durante il meeting, Granello registra e trascrive **in locale** con whisper.cpp, poi un modello AI (Claude o un modello locale) unisce le tue note e la trascrizione in note complete. Nessun bot entra nella call.

## Funzioni

- **Note + registrazione**: editor Markdown (TipTap) con menu `/` dei comandi, barra di formattazione sulla selezione, link e checklist, salvataggio automatico, registrazione con livelli audio e cronometro, ripresa sullo stesso meeting.
- **Momenti segnati**: mentre registri premi ⇧⌘M (o "⚑ Segna") e nella nota resta un marcatore con il minuto, senza spostare il cursore. Finita la trascrizione, l'AI scrive in ogni marcatore cosa si stava dicendo attorno a quel minuto; ↗ sul marcatore apre la trascrizione in quel punto. I marcatori dicono anche alle note AI quali parti contavano per te.
- **AI dentro l'editor**: un **blocco AI dal vivo** tiene una richiesta ("riassumi le obiezioni del cliente") e la sua risposta, ricalcolata mentre registri (al massimo ogni due minuti) e un'ultima volta a trascrizione finita. Il pulsante ✦ su sondaggi, lavagne a colonne, timeline, pro e contro, matrici di decisione e diagrammi Mermaid crea o modifica il blocco a partire da una richiesta, usando note e trascrizione del meeting. "✦ In diagramma" sulla lavagna fa leggere lo schizzo all'AI, che lo ridisegna come diagramma Mermaid (serve un modello che accetta immagini). ✦ sul testo selezionato lo riscrive (accorcia, traduci, espandi…). ✦ accanto al titolo del meeting genera il titolo da note e trascrizione. Ogni campo di richiesta all'AI ha un microfono: detti la richiesta e viene trascritta in locale da whisper, come il meeting. Ognuna di queste funzioni invia note e trascrizione al provider AI configurato.
- **Citazioni dalla trascrizione**: seleziona una frase nel pannello della trascrizione e "❝ Cita nelle note" la trasforma in una citazione con chi l'ha detta e il minuto. Chi parla parte da te o da "Altri" e si può correggere; ↗ riapre la trascrizione in quel punto.
- **Blocchi dell'editor**: tabelle, riquadri in evidenza, sezioni richiudibili, colonne, immagini (incolla uno screenshot), allegati, anteprime dei link, formule LaTeX, indice sempre aggiornato, evidenziatore, menzioni `@persona` e date; più gli strumenti da riunione: sondaggi, lavagne a colonne, timeline, pro e contro, matrici di decisione, valutazioni a stelle, timer, barre di avanzamento, grafici, diagrammi Mermaid, una lavagna a mano libera e contenuti incorporati. Tutto resta salvato come Markdown leggibile:

  | Blocco | Scorciatoia | In Markdown |
  | --- | --- | --- |
  | Tabella | `\| ` + spazio | una tabella Markdown |
  | Riquadro | `! ` + spazio | `> [!NOTE]`, `> [!WARNING]`, `> [!DECISION]` |
  | Sezione richiudibile | menu `/` | `::: details Titolo` … `:::` |
  | Colonne | menu `/` | `:::: columns` con un `::: column` ciascuna |
  | Immagine, allegato | incolla, trascina o menu `/` | `![alt](attachments/…)`, `[📎 nome](attachments/…)` |
  | Anteprima link | menu `/` | `[Titolo](https://… "preview")` |
  | Formula | `$x^2$`, `$$` + spazio | `$…$`, `$$` … `$$` |
  | Indice | menu `/` | `[[toc]]` |
  | Evidenziatore | ⌘⇧H | `==testo==`, `==testo=={.green}` |
  | Persona | `@` | `@[Nome]` |
  | Data | menu `/` | `[[2026-11-26]]` |
  | Sondaggio | menu `/` | `::: poll Domanda` con righe `- [3] Opzione` |
  | Lavagna a colonne | menu `/` | `::: kanban` con righe `## Colonna` e `- scheda` |
  | Timeline | menu `/` | `::: timeline` con righe `- 2026-11-26 Tappa` |
  | Pro e contro | menu `/` | `::: pros-cons` con `+ pro`, `- contro`, `= verdetto` |
  | Matrice di decisione | menu `/` | `::: matrix` attorno a una tabella (criterio, peso, un punteggio per opzione) |
  | Valutazione | menu `/` | `[[rating:4]]` |
  | Timer | menu `/` | `[[timer:05:00]]` |
  | Avanzamento | menu `/` | `[[progress]]` (calcolato dalle checklist della sezione) |
  | Grafico | menu `/` | `[[chart:bar]]`, `[[chart:line]]` (disegna la tabella che lo precede) |
  | Diagramma | menu `/` | un blocco di codice `mermaid` |
  | Lavagna | menu `/` | un blocco di codice `sketch`, una riga per tratto |
  | Incorpora | menu `/` | `[Titolo](https://… "embed")` |
  | Blocco AI dal vivo | menu `/` ("Chiedi all'AI") | `::: ai Richiesta` … risposta … `:::` |
  | Citazione dalla trascrizione | selezione del testo nella trascrizione, menu `/` | `::: quote 12:34 Nome` … `:::` |
  | Momento segnato | ⇧⌘M o "⚑ Segna" mentre registri, menu `/` | `::: moment 12:34` … `:::` |
- **Trascrizione locale**: whisper.cpp con Metal su Apple Silicon. L'audio viene tagliato sulle pause (6-20 s), ricampionato a 16 kHz e trascritto in un thread dedicato. Filtra le allucinazioni tipiche ("Sottotitoli a cura di QTSS", "[Musica]"...). Il titolo e i partecipanti vengono passati come prompt iniziale per migliorare nomi e termini.
- **Due sorgenti**: microfono ("Tu") e audio della call ("Altri"), catturato in modo nativo dall'uscita di sistema o da un dispositivo di loopback.
- **Carica una registrazione**: invece di registrare dal vivo, *Carica audio* trascrive un file esistente (MP3, M4A/AAC, WAV, FLAC, OGG Vorbis, AIFF, CAF, o la traccia audio di un video MP4/MOV) con la stessa pipeline, in coda alla trascrizione del meeting. Il file viene letto dov'è, mai copiato. Opus non è supportato.
- **Note AI**: Claude (streaming) arricchisce le tue note seguendo il template scelto. Le note AI restano modificabili.
- **Template**: Generale, 1:1, Standup, Colloquio, Meeting cliente + template personalizzati.
- **Calendario**: uno o più URL iCal (Google, Outlook), ognuno attivabile o disattivabile dalla home, eventi ricorrenti con RRULE, EXDATE e override, notifica prima dell'inizio, un click per aprire le note del meeting.
- **Chat**: domande su un meeting o su tutti (ricerca full-text SQLite FTS5 per trovare i meeting pertinenti, con citazione di titolo e data).
- **Tag e partecipanti**: tag sui meeting (la sidebar ne mostra al massimo due per meeting) e partecipanti modificabili. Granello tiene una rubrica delle persone e completa i nomi da lì e dal calendario; se il meeting coincide con un evento del calendario propone di importarne i partecipanti.
- **Ricerca** nella sidebar su titoli, tag, partecipanti, note, note AI e trascrizioni.
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

L'audio non viene mai salvato: viene trascritto in locale e scartato. Note e trascrizioni restano nel database locale. Al provider AI scelto viene inviato solo testo (note e trascrizione) quando generi le note AI o usi la chat; con un provider locale non esce nulla dal Mac. Le API key stanno nel Portachiavi; gli URL iCal stanno nel database locale. Le immagini incollate e i file allegati vengono copiati nella cartella dati dell'app (`attachments/`) ed eliminati quando viene cancellato l'ultimo meeting che li usa. Un'anteprima di link chiede il titolo alla pagina collegata una sola volta, quando la crei; le immagini da Internet non vengono mai caricate. I contenuti incorporati (YouTube, Vimeo, Loom, Figma, mappe) si caricano solo quando premi *Carica*, e solo da quei servizi.

## Architettura

```
src-tauri/src
├── lib.rs         setup, stato, log, istanza singola, uscita pulita, watcher calendario + notifiche
├── commands.rs    comandi Tauri (meeting, registrazione, AI, template, impostazioni, modelli, calendario)
├── audio.rs       cattura cpal (thread audio) + Chunker sulle pause + thread di trascrizione
├── decode.rs      decodifica dei file audio caricati (symphonia) in blocchi mono
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
pnpm dev:secrets        # sviluppo, con la chiave di Claude iniettata da envsec (nessuna richiesta del Portachiavi)
pnpm tauri build      # .app e .dmg in src-tauri/target/release/bundle
```

Controlli prima di un rilascio:

```bash
pnpm check              # tsc + traduzioni + clippy (warning = errore) + cargo test
```

### Distribuzione

`pnpm tauri build` produce un'app **non firmata**: su un altro Mac Gatekeeper la blocca. Per distribuirla servono un certificato *Developer ID Application* e la notarizzazione Apple: imposta `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (password specifica per l'app) e `APPLE_TEAM_ID` prima del build, Tauri firma e notarizza da solo. Le entitlement per microfono e rete sono già in `src-tauri/entitlements.plist`.

Primo avvio (la Home mostra cosa manca):

1. **Impostazioni → Modelli AI**: incolla la API key di Claude (finisce nel Portachiavi; in alternativa esporta `ANTHROPIC_API_KEY` o `CLAUDE_API_KEY`; con la chiave nell'ambiente il Portachiavi non viene letto), oppure aggiungi un provider locale come LM Studio o Ollama.
2. **Impostazioni → Trascrizione**: scarica `large-v3-turbo-q5_0` (547 MB, consigliato su Apple Silicon) oppure `base` per una prova veloce.
3. **Impostazioni → Calendario**: aggiungi un calendario e incolla il suo indirizzo segreto iCal. Puoi aggiungerne più di uno.
4. Al primo Registra macOS chiede il permesso per il microfono.

## Audio degli altri partecipanti

Scegli **Audio di sistema** come "Audio degli altri partecipanti" (nelle Impostazioni o accanto al pulsante Registra): Granello registra quello che esce dal computer (Teams, Zoom, Meet…) con un process tap di Core Audio, senza installare nulla. Serve macOS 14.6 o successivo; la prima volta macOS chiede il permesso di registrare l'audio di sistema (*Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo e audio di sistema*). Se l'uscita audio cambia durante la call (cuffie collegate), la cattura la segue.

Non scegliere *Microsoft Teams Audio*: è il dispositivo virtuale con cui Teams condivide l'audio del computer e non contiene le voci della call.

Sui sistemi più vecchi, o quando il dispositivo di uscita è anche un ingresso, usa un dispositivo di loopback:

1. `brew install blackhole-2ch`
2. In *Configurazione MIDI Audio* crea un **dispositivo multi-uscita** con le cuffie + BlackHole 2ch.
3. Imposta quel dispositivo come uscita di sistema (o di Teams/Zoom).
4. In Granello scegli *BlackHole 2ch* come "Audio degli altri partecipanti".

Usa le cuffie: senza cancellazione dell'eco il microfono riprende anche gli altri e la trascrizione si duplica.

## Prossimi passi

- Cancellazione dell'eco tra microfono e audio di sistema.
- OAuth Google Calendar al posto dell'URL iCal.
- Esportazione verso Notion / Google Docs, condivisione delle note.
- Firma con certificato Developer ID. Finché manca, il permesso "Consenti sempre" del Portachiavi si perde a ogni build: per questo le API key vengono lette una sola volta per avvio e tenute in memoria (`secrets.rs`). Con la firma attiva, rivalutare se quella cache serve ancora.
- Aggiornamenti automatici (tauri-plugin-updater) una volta attiva la firma.
- Salvataggio opzionale dell'audio per ritrascrivere con un modello migliore.

## Test

```bash
cd src-tauri && cargo test
```

Coprono chunking audio, resampling, filtro allucinazioni, parser iCal con ricorrenze, streaming/retry/annullamento dei modelli AI (anche contro un server compatibile OpenAI simulato), validazione delle impostazioni, database, migrazioni, recupero dopo crash e ricerca.
