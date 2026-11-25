---
title: La Libreria
description: Sfoglia le note per progetto, persona, tag e periodo, fissa quelle a cui torni spesso, dai un tag a più note insieme ed elenca decisioni e azioni attraverso le note.
---

La Libreria sfoglia le note a colonne: scegli una dimensione, poi un valore, poi una nota, con l'anteprima accanto.

![La Libreria a colonne](../../../../assets/shots/it/library.webp)

## Dimensioni

- **Fissati**: le note che hai fissato nella barra laterale, vedi sotto.
- **Progetti**: i progetti che hai creato, ognuno con le note che gli appartengono.
- **Persone**: chi ha partecipato.
- **Tag**: i tag delle tue note.
- **Periodo**: questa settimana, poi un gruppo per mese.
- **File**: registrazioni, immagini e altri file, vedi sotto.

Le frecce muovono tra le colonne e Invio apre la nota; Maiusc + freccia aggiunge anche la voce o la dimensione successiva. ⌘ + ↑↓ si sposta senza cambiare cosa è scelto, e Spazio sceglie o toglie la voce dove sei (nell'elenco delle note, la aggiunge o la toglie dalla selezione).

## Progetti

Un progetto raccoglie le note che vanno insieme: un cliente, un prodotto, un lavoro. **+ Nuovo progetto** in cima alla colonna Progetti ne crea uno, con nome, colore e descrizione.

Una nota sta in un progetto al massimo. Per mettere una nota in un progetto aprila e scegli il progetto in alto a destra nell'intestazione, sopra i pulsanti copia, stampa ed elimina; da lì puoi anche creare un progetto nuovo. Per spostare più note insieme selezionale nella Libreria e scegli il progetto nell'anteprima.

Un progetto può stare dentro un altro: un cliente con i suoi progetti, un'area con i suoi argomenti. Scegli **Nuovo progetto dentro…** dal menu di un progetto per crearne uno dentro, oppure scegli **Dentro** quando crei o modifichi un progetto. Nella colonna Progetti il triangolo apre e chiude il ramo di un progetto (→ e ← fanno lo stesso da tastiera), e scegliendo un progetto vedi le sue note insieme a quelle dei progetti che contiene. Nell'intestazione della nota il progetto mostra il percorso intero, come `Clienti › Nord`.

Ogni progetto ha un menu: premi **⋯** su un progetto (compare passandoci sopra o scegliendolo) oppure fai clic destro. Da lì puoi crearne uno dentro, modificarlo, archiviarlo quando è chiuso o eliminarlo; per eliminare serve un secondo clic. Archiviare ed eliminare tengono le note: un progetto archiviato va sotto **Archiviati** insieme ai progetti che contiene, e le note di un progetto eliminato restano senza progetto, mentre i progetti dentro salgono di un livello.

## Tag con `/`

Un tag scritto con `/`, come `team/standup`, sta sotto `team` nella colonna Tag, come in Obsidian. Scegliendo `team` vedi le note di tutti i tag che cominciano con `team/`, e di `team` stesso.

I progetti creati con le versioni precedenti, quando un progetto era un tag promosso, vengono convertiti al primo avvio: ognuno tiene il nome e le sue note, e il tag resta sulle note come tag normale.

## Note fissate

La puntina nell'intestazione di una nota, accanto a copia, stampa ed elimina, la tiene nella barra laterale sotto **Fissati**, nell'ordine in cui le hai fissate. Premila di nuovo per toglierla. Puoi fissare o togliere anche dall'anteprima della Libreria, o fissare insieme più note selezionate.

## La barra laterale

Sotto **Libreria** la barra laterale mostra, in ordine:

- **In arrivo**: gli eventi del calendario delle prossime ore.
- **Fissati**: le note che hai fissato.
- **Oggi** e **Ieri**: ogni nota con l'ora dell'ultima modifica, ✦ se l'AI l'ha rielaborata, quante persone c'erano e al massimo due tag. Un titolo in corsivo è una nota non ancora rielaborata dall'AI.
- **Questa settimana** e **Settimana scorsa**: una riga per nota con il giorno della settimana e l'ora dell'ultima modifica, e quante note ha la settimana. Si vedono le prime quattro; **Altre N** mostra le altre.
- **Tutte le note**, in fondo, apre la Libreria.

Queste sezioni seguono l'ultima modifica, dalla più recente: se cambi il titolo, le note, le note AI, i partecipanti o i tag di una nota vecchia, torna sotto **Oggi**. I tag dati a più note insieme dalla Libreria non le spostano. Nella nota, la data in alto dice quando è stata modificata l'ultima volta, se è più di un'ora dopo la fine della registrazione.

Durante una ricerca la barra laterale mostra solo i risultati, dal più pertinente, con il testo che corrisponde; le sezioni tornano quando il campo di ricerca è vuoto.

## Più voci, più dimensioni

Le colonne funzionano come nel Finder: un clic sceglie una voce, ⌘ clic ne aggiunge o ne toglie una, Maiusc clic aggiunge tutte le voci fino a lì, o le toglie se quella cliccata era già scelta, ⌘A sceglie tutta la colonna. In fondo alla prima colonna c'è il promemoria dei tasti. Le voci scelte restano verdi in ogni colonna, e persone e tag sono in ordine alfabetico: filtrando cambiano i numeri, non il posto delle voci. Il numero accanto a ogni dimensione dice quante voci ha la sua colonna tra le note che stai guardando.

- **Più voci in una colonna.** Due persone mostrano le note in cui c'erano entrambe, e lo stesso vale per due tag. Due progetti o due mesi mostrano le note dell'uno o dell'altro, perché una nota ne ha uno solo.
- **Più dimensioni insieme.** ⌘ clic su una seconda dimensione e la sua colonna si apre accanto alla prima: scegli due persone, ⌘ clic su **Tag**, e la nuova colonna elenca solo i tag delle loro note. L'ultima dimensione aggiunta ha sempre la colonna di destra; quelle aggiunte prima stanno una sopra l'altra in quella di sinistra, che si divide in altezza: ⌘ clic anche su **Periodo** e Persone e Tag si dividono la colonna di sinistra, mentre Periodo prende quella di destra. Ogni colonna conta le sue voci sulle note scelte nelle altre, e l'elenco delle note mostra quelle che le passano tutte. ⌘ clic su **Fissati** per vedere solo le note fissate.

Una colonna senza voci scelte non filtra. Un clic semplice su una dimensione chiude le altre; Esc toglie le voci scelte nella colonna in cui sei. In una finestra stretta la Libreria scorre di lato, e la colonna in cui sei resta in vista.

## Più note insieme

Con ⌘ clic o Maiusc clic selezioni più note. L'anteprima ti fa allora scegliere il progetto per tutte, aggiungere un tag a tutte, o toglierne uno da tutte.

## Elementi attraverso le note

L'interruttore **Elementi** elenca, al posto delle note, quello che c'è scritto dentro:

- le **decisioni**, dai riquadri decisione;
- le **azioni**, dalle checklist, aperte o fatte;
- le **citazioni**, dalle citazioni della trascrizione.

Filtra per tipo con le etichette in cima, e cerca nel loro testo. Con un doppio clic su un elemento si apre la sua nota.

![La vista Elementi: decisioni e azioni di più note in un solo elenco](../../../../assets/shots/it/items.webp)

## File

**File** elenca i file del vault aperto in tre schede:

- **Registrazioni**: l'audio salvato, vedi sotto.
- **Immagini**: le immagini incollate o trascinate nelle note.
- **Altri file**: gli allegati delle note, e i file arrivati senza una nota con un [import](/it/guides/import/).

Un clic sul nome apre il file con l'app predefinita, uno sul titolo apre la nota. Un file arrivato senza nota mostra la cartella da cui veniva, ed **Elimina** lo toglie; l'allegato di una nota si toglie dalla nota.

### Registrazioni

Con **Salva le registrazioni** attivo, la scheda Registrazioni mostra un riquadro per nota con le sue registrazioni. Ognuna ha un player con la forma d'onda dell'audio: si clicca o si trascina per spostarsi.

- **Togli le pause** taglia le parti senza audio. Dopo, i minuti dell'audio non corrispondono più a quelli della trascrizione.
- **Unisci** mette in un solo file le registrazioni di una nota registrata in più riprese.

Tutte e due usano ffmpeg, che i pacchetti di rilascio includono. Con ffmpeg le registrazioni vengono anche compresse, a circa 20 MB all'ora. Una build dal codice senza ffmpeg tiene le registrazioni in WAV e non offre queste due azioni.

![Le registrazioni salvate, una scheda per nota, con la forma d'onda](../../../../assets/shots/it/recordings.webp)

## Ricerca

Il campo di ricerca nella barra laterale (⌘K) cerca in titoli, tag, partecipanti, note, note AI e trascrizioni. Il testo oscurato non si trova, perché non esiste più.
