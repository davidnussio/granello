---
title: Modelli locali e provider AI
description: Scegli quale modello AI scrive le note. Con un provider locale non esce niente dal tuo Mac.
---

Sei tu a decidere dove va il testo. In **Impostazioni → Modelli AI** scegli il provider e il modello, e puoi usarne uno diverso per le note AI e per la chat.

## Due tipi di provider

| Tipo di provider | Per cosa |
| --- | --- |
| Anthropic | Claude, il provider predefinito |
| Compatibile OpenAI | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter, Granello Cloud e qualsiasi server che espone `/chat/completions` |

**Granello Cloud** è il servizio di dambox per Granello, per ora su invito: si aggiunge con **+ Granello Cloud** e una chiave creata per Granello nella dashboard del servizio. È un provider online come gli altri: note e trascrizioni vengono inviate a `ai.dambox.ch`.

- L'elenco dei modelli viene letto dal server. **Verifica** controlla che il provider risponda.
- Ogni provider ha la sua API key nel Portachiavi. Ai server locali di solito non serve.

## Tenere tutto sul Mac

Aggiungi un provider locale (un server su `localhost`) e sceglilo sia per **Note AI** sia per **Chat**. Da lì in poi nessun testo esce dal Mac.

Per esserne certo su una singola nota, qualunque cosa dicano le impostazioni, mettila su [blindata](/it/privacy/levels/): usa sempre e solo un provider su `localhost`.

## Il contesto dei modelli locali

Un'ora di registrazione sono decine di migliaia di token. I server locali tagliano in silenzio quello che non ci sta, e alcuni partono con un contesto ridotto. Indicalo nel campo **Contesto (token)** del provider: Granello stima la dimensione di ogni richiesta e si ferma con un errore chiaro, invece di scrivere le note da mezza trascrizione.

Il ragionamento che alcuni modelli locali stampano prima di rispondere viene tolto dalle note.

## La trascrizione è locale di default

Il parlato viene trascritto sul Mac da whisper.cpp, qualunque provider AI usi. Mandare l'audio a un servizio di trascrizione online è un'opzione a parte, spenta di default: vedi [come funziona la privacy](/it/privacy/overview/).
