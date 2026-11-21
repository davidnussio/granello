---
title: La Libreria
description: Sfoglia i meeting per progetto, persona, tag e periodo, dai un tag a più meeting insieme ed elenca decisioni e azioni attraverso i meeting.
---

La Libreria sfoglia i meeting a colonne: scegli una dimensione, poi un valore, poi un meeting, con l'anteprima accanto.

![La Libreria a colonne](../../../../assets/shots/it/library.webp)

## Dimensioni

- **Progetti**: i tag che hai promosso. Un progetto ha una sua sezione e si può archiviare quando è chiuso.
- **Persone**: chi ha partecipato.
- **Tag**: gli altri tag.
- **Periodo**: questa settimana, poi un gruppo per mese.
- **Registrazioni**: l'audio salvato, vedi sotto.

Le frecce muovono tra le colonne e Invio apre il meeting.

## I progetti sono tag

Un meeting entra in un progetto semplicemente avendo quel tag. Per creare un progetto vai in **Tag**, passa su un tag e scegli **Progetto**. Per chiuderlo scegli **Archivia**: i suoi meeting restano.

## Incrociare due dimensioni

**+ Incrocia con…** in cima restringe tutto ai meeting che hanno anche un'altra cosa: una persona dentro un progetto, un tag in un mese.

## Dare un tag a più meeting insieme

Con ⌘ clic o Maiusc clic selezioni più meeting. L'anteprima ti fa allora aggiungere un tag a tutti, o toglierne uno da tutti.

## Elementi attraverso i meeting

L'interruttore **Elementi** elenca, al posto dei meeting, quello che è scritto nelle loro note:

- le **decisioni**, dai riquadri decisione;
- le **azioni**, dalle checklist, aperte o fatte;
- le **citazioni**, dalle citazioni della trascrizione.

Filtra per tipo con le etichette in cima, e cerca nel loro testo. Con un doppio clic su un elemento si apre il suo meeting.

![La vista Elementi: decisioni e azioni di più meeting in un solo elenco](../../../../assets/shots/it/items.webp)

## Registrazioni

Con **Salva le registrazioni** attivo, la Libreria mostra una scheda per meeting con le sue registrazioni. Ognuna ha un player con la forma d'onda dell'audio: si clicca o si trascina per spostarsi.

- **Togli le pause** taglia le parti senza audio. Dopo, i minuti dell'audio non corrispondono più a quelli della trascrizione.
- **Unisci** mette in un solo file le registrazioni di un meeting registrato in più riprese.

Tutte e due usano ffmpeg, che i pacchetti di rilascio includono. Con ffmpeg le registrazioni vengono anche compresse, a circa 20 MB all'ora. Una build dal codice senza ffmpeg tiene le registrazioni in WAV e non offre queste due azioni.

![Le registrazioni salvate, una scheda per meeting, con la forma d'onda](../../../../assets/shots/it/recordings.webp)

## Ricerca

Il campo di ricerca nella barra laterale (⌘K) cerca in titoli, tag, partecipanti, note, note AI e trascrizioni. Il testo oscurato non si trova, perché non esiste più.
