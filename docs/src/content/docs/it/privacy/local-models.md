---
title: Modelli locali e provider AI
description: Scegli quale modello AI scrive le note. Con un provider locale non esce niente dal tuo Mac.
---

Granello non ha un servizio AI suo. In **Impostazioni → Modelli AI** scegli il provider e il modello, e puoi usarne uno diverso per le note AI e per la chat.

## Due tipi di provider

| Tipo di provider | Per cosa |
| --- | --- |
| Anthropic | Claude, il provider predefinito |
| Compatibile OpenAI | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter e qualsiasi server che espone `/chat/completions` |

- L'elenco dei modelli viene letto dal server. **Verifica** controlla che il provider risponda.
- Ogni provider ha la sua API key nel Portachiavi. Ai server locali di solito non serve.

## Tenere tutto sul Mac

Aggiungi un provider locale (un server su `localhost`) e sceglilo sia per **Note AI** sia per **Chat**. Da lì in poi nessun testo esce dal Mac.

Per esserne certo su un singolo meeting, qualunque cosa dicano le impostazioni, mettilo su [blindata](/it/privacy/levels/): usa sempre e solo un provider su `localhost`.

## Il contesto dei modelli locali

Un'ora di riunione sono decine di migliaia di token. I server locali tagliano in silenzio quello che non ci sta, e alcuni partono con un contesto ridotto. Indicalo nel campo **Contesto (token)** del provider: Granello stima la dimensione di ogni richiesta e si ferma con un errore chiaro, invece di scrivere le note da mezza trascrizione.

Il ragionamento che alcuni modelli locali stampano prima di rispondere viene tolto dalle note.

## La trascrizione è locale di default

Il parlato viene trascritto sul Mac da whisper.cpp, qualunque provider AI usi. Mandare l'audio a un servizio di trascrizione online è un'opzione a parte, spenta di default: vedi [come funziona la privacy](/it/privacy/overview/).
