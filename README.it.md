# Granello

[English](README.md) · **Italiano** · [Documentazione](https://granello.dambox.ch/it/)

Blocco note per macOS: scrivi poche note durante una call o una conversazione, Granello registra e trascrive **in locale** con whisper.cpp, poi un modello AI (Claude o un modello locale) unisce le tue note e la trascrizione in note complete. Nessun bot entra nella call.

## Funzioni

- **Note + registrazione**: editor Markdown (TipTap) con menu `/` dei comandi (il nome di un gruppo, come `/note`, mostra tutto il gruppo), barra di formattazione sulla selezione, link e checklist, salvataggio automatico, registrazione con livelli audio e cronometro, ripresa sulla stessa nota.
- **Momenti segnati**: mentre registri premi ⇧⌘M (o "⚑ Segna" in fondo al pannello della trascrizione, aperto fin dall'inizio) e nella nota resta un marcatore con il minuto, senza spostare il cursore. Finita la trascrizione, l'AI scrive in ogni marcatore cosa si stava dicendo attorno a quel minuto; ↗ sul marcatore apre la trascrizione in quel punto. I marcatori dicono anche alle note AI quali parti contavano per te.
- **Privacy per nota**: ogni nota ha un livello di Privacy. **Blindata** significa che non esce niente dal Mac: note AI, chat, AI dell'editor e titolo usano solo un modello servito su questo Mac (un provider su `localhost`), oppure non sono disponibili. Nella trascrizione puoi selezionare del testo e **oscurarlo** (il testo viene cancellato per sempre, anche dalla ricerca) o segnarlo **da verificare**: finché una nota ha parti da verificare non viene inviata a modelli online, e la chat generale la esclude.
- **Più persone allo stesso microfono**: mentre registri, il selettore "Al microfono" dice chi sta parlando tra i partecipanti (o tu); da quel momento la trascrizione lo attribuisce a quella persona. Dopo, selezionando una parte della trascrizione, "Chi parla…" la assegna a un partecipante, a te o a un nome nuovo.
- **Privacy a colpo d'occhio**: il pulsante Registra e la cima della trascrizione mostrano il livello di privacy della nota come un occhio: aperto (standard), socchiuso (audio locale), barrato (blindata).
- **Registrazioni salvate (facoltative, spente di default)**: attiva "Salva le registrazioni" nelle Impostazioni e l'audio che registri resta in una cartella del Mac (quella predefinita o una scelta da te). Vale anche per i file audio e video caricati: la loro traccia audio viene salvata come registrazione (il video in sé non viene copiato). Si riascolta dalla nota, accanto alla trascrizione, oppure dalla Libreria alla voce "File → Registrazioni": una card per nota con le sue registrazioni, ognuna con un player che mostra la forma d'onda dell'audio (si clicca o si trascina per spostarsi), dove si può anche eliminare una registrazione o aprire la sua nota. Una nota registrata in più riprese può unirle in un solo file (serve ffmpeg). Con ffmpeg (incluso nei pacchetti di rilascio) le registrazioni vengono compresse in M4A (circa 20 MB all'ora invece di 115) e si possono togliere le pause senza audio, in automatico o registrazione per registrazione; senza pause, i minuti dell'audio non corrispondono più alla trascrizione. Oscurare una parte della trascrizione cancella le registrazioni di quella nota.
- **Trascrizione online con i parlanti (facoltativa, spenta di default)**: con una chiave API di Gladia, a fine riunione l'audio viene caricato su Gladia e la trascrizione locale viene sostituita da una che distingue i parlanti ("Parlante 1", "Parlante 2": un clic sul nome per rinominarlo ovunque). È l'unico caso in cui l'audio esce dal Mac. Per farlo l'audio della riunione resta nella cartella dati fino al caricamento e poi viene cancellato; si può anche eliminare senza caricarlo. Non parte mai per le note con privacy "audio locale" o "blindata" o con parti da verificare, e oscurare una parte cancella l'audio conservato.
- **Dati di esempio**: "Carica i dati di esempio" (in Home e nelle Impostazioni) riempie l'app con 22 note inventate ma realistiche: tutti i blocchi dell'editor, trascrizioni, note AI, persone e progetti per la Libreria. Ognuna ha anche il tag `#faker`, così si riconoscono e si filtrano subito. Seguono la lingua dell'interfaccia e si tolgono con un clic; le tue note non vengono mai toccate. I testi stanno in `src-tauri/demo/it.txt` e `en.txt`.
- **Libreria**: una vista per sfogliare le note a colonne a cascata: scegli una dimensione (progetti, persone, tag, periodo), poi un valore, poi una nota, con l'anteprima accanto (sintesi, azioni aperte, citazioni, momenti segnati). Le frecce muovono tra le colonne e Invio apre la nota. Un filtro in cima incrocia due dimensioni (una persona dentro un progetto, un tag in un mese). Con ⌘ clic o Maiusc clic si selezionano più note per aggiungere o togliere un tag a tutti insieme. L'interruttore "Elementi" elenca, al posto delle note, le decisioni, le azioni e le citazioni scritte al loro interno (riquadri decisione, checklist, citazioni dalla trascrizione), attraverso tutte le note. Un **progetto** ha nome, colore e descrizione («+ Nuovo progetto» nella Libreria); una nota sta in un progetto al massimo, scelto in alto a destra nell'intestazione, e un progetto si può archiviare quando è chiuso. Un progetto può stare dentro un altro (`Clienti › Nord`): la colonna Progetti li mostra in albero, e scegliendo un progetto si vedono anche le note di quelli che contiene. I tag scritti con `/` (`team/standup`) si vedono in albero allo stesso modo.
- **File**: Libreria → File elenca i file del vault aperto in tre schede: registrazioni, immagini e altri file (allegati delle note e file importati senza una nota), ognuno con il link alla sua nota.
- **Link tra note**: `[[` in una nota collega un'altra nota per titolo; un clic la apre, il link a una nota che non c'è ancora è tratteggiato, e se una nota cambia titolo i link che la portano seguono il nuovo.
- **Import da Obsidian**: Impostazioni → Importa da copia le note di un vault Obsidian nel vault aperto. Il vault Obsidian viene solo letto. I link diventano link tra note, le immagini e i file incorporati diventano allegati, ogni cartella diventa un progetto dentro quello sopra (in un vault PARA le cartelle Projects, Areas, Resources e Archive restano fuori dall'albero), tag, date, progetto e partecipanti arrivano dalle proprietà, le altre proprietà finiscono in una sezione richiudibile, e i file che nessuna nota usa vanno in Libreria → File. Ogni nota riceve il tag `#obsidian` e la privacy minima del vault, niente viene inviato a un modello, importando di nuovo si salta quello che c'è già, e ogni import si può annullare.
- **AI dentro l'editor**: un **blocco AI dal vivo** tiene una richiesta ("riassumi le obiezioni del cliente") e la sua risposta, ricalcolata mentre registri (al massimo ogni due minuti) e un'ultima volta a trascrizione finita. Il pulsante ✦ su sondaggi, lavagne a colonne, timeline, pro e contro, matrici di decisione e diagrammi Mermaid crea o modifica il blocco a partire da una richiesta, usando quello che hai scritto e la trascrizione. "✦ In diagramma" sulla lavagna fa leggere lo schizzo all'AI, che lo ridisegna come diagramma Mermaid (serve un modello che accetta immagini). ✦ sul testo selezionato lo riscrive (accorcia, traduci, espandi…). ✦ accanto al titolo della nota genera il titolo da quello che hai scritto e dalla trascrizione. Ogni campo di richiesta all'AI ha un microfono: detti la richiesta e viene trascritta in locale da whisper, come la registrazione. Ognuna di queste funzioni invia note e trascrizione al provider AI configurato.
- **Citazioni dalla trascrizione**: seleziona una frase nel pannello della trascrizione e "❝ Cita nelle note" la trasforma in una citazione con chi l'ha detta e il minuto; mentre registri, "❝ Cita" in fondo al pannello cita l'ultima frase trascritta, e il comando `/` inserisce una citazione vuota al minuto attuale. Chi parla parte da te o da "Altri" e si può correggere; ↗ riapre la trascrizione in quel punto.
- **Blocchi dell'editor**: tabelle, riquadri in evidenza, sezioni richiudibili, colonne, immagini (incolla uno screenshot), allegati, anteprime dei link, formule LaTeX, indice sempre aggiornato, evidenziatore, menzioni `@persona` e date; più gli strumenti per lavorare insieme: sondaggi, lavagne a colonne, timeline, pro e contro, matrici di decisione, valutazioni a stelle, timer, barre di avanzamento, grafici, diagrammi Mermaid, una lavagna a mano libera e contenuti incorporati. Tutto resta salvato come Markdown leggibile:

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
  | Link a una nota | `[[` o menu `/` | `[[Titolo]]`, `[[Titolo\|testo]]` |
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
- **Carica una registrazione**: invece di registrare dal vivo, *Carica audio* trascrive un file esistente (MP3, M4A/AAC, WAV, FLAC, OGG Vorbis, AIFF, CAF, o la traccia audio di un video MP4/MOV) con la stessa pipeline, in coda alla trascrizione della nota. Il file viene letto dov'è, mai copiato. Opus non è supportato.
- **Note AI**: Claude (streaming) arricchisce le tue note seguendo il template scelto. Le note AI restano modificabili.
- **Template**: Generale, 1:1, Standup, Colloquio, Cliente + template personalizzati. Un template contiene le istruzioni per le note AI e, se vuoi, delle note di partenza (un'agenda, i titoli delle sezioni, una checklist) scritte con lo stesso editor: riempiono la nota quando scegli il template su una nota ancora vuota. **Configura con l'AI** scrive un template da una descrizione a parole tue; tu controlli e salvi.
- **Calendario**: uno o più URL iCal (Google, Outlook), configurati una volta nelle impostazioni; ogni vault sceglie quali mostrare (in Impostazioni → Calendario o dalla home), eventi ricorrenti con RRULE, EXDATE e override, notifica prima dell'inizio, un click per aprire una nota per l'evento.
- **Chat**: domande su una nota o su tutte (ricerca full-text SQLite FTS5 per trovare le note pertinenti, con citazione di titolo e data).
- **Tag e partecipanti**: tag sulle note (la sidebar ne mostra al massimo due per nota) e partecipanti modificabili. Granello tiene una rubrica delle persone e completa i nomi da lì e dal calendario; se la nota coincide con un evento del calendario propone di importarne i partecipanti.
- **Ricerca** nella sidebar su titoli, tag, partecipanti, note, note AI e trascrizioni.
- **Scorciatoie**: ⌘N nuove note, ⌘K cerca, ⌘, impostazioni. Dentro una nota, ⌘F apre trova e sostituisci: le corrispondenze sono evidenziate, Invio e Maiusc Invio passano dall'una all'altra, e "Tutti" le sostituisce tutte con un solo Annulla. Cerca nel testo della nota; i blocchi fatti di dati (sondaggi, kanban, citazioni…) restano fuori.
- **Italiano e inglese**: l'interfaccia segue la lingua del Mac e si cambia da Impostazioni → Profilo.

## Modelli AI

Le note AI e la chat possono usare modelli diversi, anche di provider diversi (Impostazioni → Modelli AI). Due protocolli coprono tutto:

| Tipo di provider | Per cosa |
|---|---|
| Anthropic | Claude (provider predefinito, sempre presente) |
| Compatibile OpenAI | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter e qualsiasi server che esponga `/chat/completions` |

- L'elenco dei modelli viene letto dal server (`/models`); "Verifica" controlla che il provider risponda.
- Ogni provider ha la sua API key nel Portachiavi; i server locali di solito non ne vogliono una.
- **Contesto dei modelli locali**: un'ora di registrazione sono decine di migliaia di token e i server locali troncano in silenzio quello che non ci sta (Ollama parte con un contesto ridotto). Indicando il contesto del provider, Granello stima la dimensione della richiesta e si ferma con un errore chiaro invece di produrre note su mezza trascrizione.
- Il ragionamento dei modelli "thinking" locali (`<think>…</think>`) viene tolto dalla risposta.
- Con un provider locale per note e chat non esce nulla dal Mac.

## Lingue

L'interfaccia è in italiano e in inglese. All'avvio segue la lingua del sistema (italiano se il Mac è in italiano, altrimenti inglese); da Impostazioni → Profilo si sceglie una lingua fissa e il cambio è immediato. Seguono la stessa lingua anche gli errori, le notifiche, i template di sistema e il formato di date e orari. La *lingua parlata* (usata per la trascrizione e per le note AI) è un'impostazione separata.

Nel frontend l'italiano è la lingua sorgente: `t("Testo italiano")` cerca la traduzione in `src/i18n/en.ts`. `pnpm check` fallisce se un testo non ha la traduzione inglese. Nel backend ogni messaggio porta le due versioni: `tr("italiano", "english")`, `trf!` per i messaggi con parametri.

## Affidabilità

- **Niente registrazioni perse**: se chiudi l'app mentre registri, la cattura si ferma e l'audio già registrato viene trascritto prima dell'uscita (fino a 2 minuti). Dopo un crash, le note rimaste "in registrazione" vengono chiuse e reindicizzate al riavvio.
- **Dispositivo audio scollegato** (es. AirPods): la sessione si chiude in modo pulito con un avviso, tenendo quello che è stato registrato. Se il microfono non dà alcun segnale per 8 secondi compare un avviso sui permessi.
- **Modelli AI**: riprova automatica su errori transitori (429, 5xx, sovraccarico, rete), generazione annullabile, risposte troncate o interrotte segnalate invece che salvate in silenzio. Una rigenerazione fallita non tocca le note AI esistenti. Nella chat sulla singola nota il contesto è in prompt cache.
- **Database**: migrazioni versionate (`PRAGMA user_version`), scritture in transazione, WAL. Un database creato da una versione più recente non viene aperto.
- **Download dei modelli**: file parziali rimossi in caso di errore, controllo di dimensione e formato, modelli eliminabili dalle Impostazioni.
- **Istanza singola**: aprire l'app una seconda volta porta in primo piano la finestra esistente.
- **Log** in `~/Library/Logs/ch.dambox.granello/Granello.log` (con rotazione). Non contengono note, trascrizioni, API key né l'URL del calendario.

## Privacy

L'audio non viene mai salvato: viene trascritto in locale e scartato. Le eccezioni sono due, entrambe spente di default: il salvataggio delle registrazioni, che tiene l'audio di ogni registrazione in una cartella del Mac (senza mai caricarlo), e la trascrizione online, che tiene l'audio nella cartella dati (`audio/`) fino al caricamento su Gladia e poi lo cancella. Note e trascrizioni restano nel database locale. Al provider AI scelto viene inviato solo testo (note e trascrizione) quando generi le note AI o usi la chat; con un provider locale non esce nulla dal Mac. Le API key stanno nel Portachiavi (le build di sviluppo avviate con `pnpm tauri dev` le tengono invece in file privati nella cartella dati, perché una build non firmata chiederebbe la password del Portachiavi a ogni avvio); gli URL iCal stanno nel database locale. Le immagini incollate e i file allegati vengono copiati nella cartella dati dell'app (`attachments/`) ed eliminati quando viene cancellato l'ultima nota che li usa. Un'anteprima di link chiede il titolo alla pagina collegata una sola volta, quando la crei; le immagini da Internet non vengono mai caricate. I contenuti incorporati (YouTube, Vimeo, Loom, Figma, mappe) si caricano solo quando premi *Carica*, e solo da quei servizi.

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
      get group() {
        return t("Note");
      },
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

Le registrazioni vengono compresse e ripulite da ffmpeg. Le build di rilascio includono una build ridotta con licenza LGPL (solo audio, circa 3 MB) come sidecar di Tauri: `scripts/build-ffmpeg.sh` la compila in `src-tauri/binaries/` e `src-tauri/tauri.ffmpeg.conf.json` la aggiunge al pacchetto con la sua licenza. Le build di sviluppo usano l'ffmpeg nel `PATH` o quello di Homebrew.

```bash
scripts/build-ffmpeg.sh
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

Controlli prima di un rilascio:

```bash
pnpm check              # tsc + oxlint + oxfmt + traduzioni + clippy (warning = errore) + cargo test
pnpm fmt                # formatta il frontend con oxfmt
```

L'interfaccia gira anche nel browser, senza il backend Tauri, sui dati di esempio (generati dal database vero con `cargo test --lib preview_fixtures -- --ignored`):

```bash
pnpm preview            # http://localhost:1430/preview.html?lang=it (o lang=en)
pnpm screenshots        # schermate per la vetrina in shots/<lingua>/*.webp, 1440×900, tema scuro
pnpm screenshots commands  # solo le immagini dei comandi / per la documentazione (docs/src/assets/shots/<lingua>/commands)
```

### Distribuzione

`pnpm tauri build` produce un'app **non firmata**: su un altro Mac Gatekeeper la blocca. I rilasci sono firmati con il certificato *Developer ID Application: dambox Sagl (CLFTJ6F63K)*, con l'hardened runtime, e notarizzati da Apple: `release.yml` passa a Tauri il certificato e una chiave API di App Store Connect (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`), Tauri firma ffmpeg e l'app, notarizza l'app e la graffa; poi il workflow notarizza e graffa il DMG e lo controlla con `stapler validate` e `spctl` prima della release. I secret sono elencati in cima a `release.yml`; `scripts/ci/sync-signing-secrets.sh` li carica da envsec (contesto `apple`), con un `.p12` che contiene solo l'identità Developer ID. Per firmare una build locale imposta `APPLE_SIGNING_IDENTITY` (e `APPLE_API_KEY`, `APPLE_API_ISSUER` per notarizzarla). Le entitlement (microfono, rete in uscita, rubrica) sono in `src-tauri/entitlements.plist`.

### Rilasci e aggiornamenti

Stessa `version` in `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`, commit, poi un tag `vX.Y.Z`. `.github/workflows/release.yml` esegue i controlli, costruisce il DMG per Apple Silicon, firma i pacchetti di aggiornamento e crea una release **in bozza** con `latest.json`. Le app installate controllano all'avvio `releases/latest/download/latest.json`, che vede solo le release pubblicate: nessuna si aggiorna finché la bozza non viene pubblicata. Prima di installare l'app chiede; si riavvia solo se non sta registrando.

Pubblicare una release avvia anche `.github/workflows/homebrew.yml`, che scrive il cask (`scripts/homebrew-cask.sh`, il DMG con il suo SHA-256) in `davidnussio/homebrew-tap`: così `brew install --cask davidnussio/tap/granello` lo installa. Serve il secret `HOMEBREW_TAP_TOKEN`; per un tag già pubblicato si lancia a mano da Actions.

I pacchetti di aggiornamento sono firmati con una chiave minisign: la pubblica è in `tauri.conf.json`, la privata e la sua password sono i secret di GitHub `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Se la chiave privata va persa, le app installate non si aggiornano più.

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
- Dalla 0.2.7 i rilasci sono firmati con un certificato Developer ID, quindi il "Consenti sempre" del Portachiavi resta dopo un aggiornamento. Rivalutare se serve ancora la cache in memoria delle API key (`secrets.rs`, lette una volta per avvio).
- Salvataggio opzionale dell'audio per ritrascrivere con un modello migliore.

## Test

```bash
cd src-tauri && cargo test
```

Coprono chunking audio, resampling, filtro allucinazioni, parser iCal con ricorrenze, streaming/retry/annullamento dei modelli AI (anche contro un server compatibile OpenAI simulato), validazione delle impostazioni, database, migrazioni, recupero dopo crash e ricerca.

## Licenza

[MIT](LICENSE). I pacchetti di rilascio includono [FFmpeg](https://ffmpeg.org), con licenza LGPL 2.1 o successiva; licenza, versione e opzioni di compilazione sono in `ffmpeg-LICENSE.txt` dentro l'app.
