---
title: Local models and AI providers
description: Choose which AI model writes the notes. With a local provider, nothing leaves your Mac.
---

Granello does not have its own AI service. In **Settings → AI models** you choose the provider and the model, and you can use a different one for the AI notes and for the chat.

## Two kinds of provider

| Provider type | Used for |
| --- | --- |
| Anthropic | Claude, the default provider |
| OpenAI-compatible | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter and any server that exposes `/chat/completions` |

- The list of models is read from the server. **Test** checks that the provider answers.
- Each provider has its own API key in the Keychain. Local servers usually do not need one.

## Keep everything on your Mac

Add a local provider (a server on `localhost`) and select it for both **AI notes** and **Chat**. From then on, no text leaves your Mac.

To make sure of it for one note whatever the settings say, set that note to [hardened](/privacy/levels/): it only ever uses a provider on `localhost`.

## The context of local models

An hour of recording is tens of thousands of tokens. Local servers silently cut what does not fit, and some start with a small context. Enter it in the provider's **Context (tokens)** field: Granello then estimates the size of each request and stops with a clear error, instead of writing notes from half a transcript.

The reasoning that some local models print before answering is removed from the notes.

## Transcription is always local by default

Speech is transcribed on your Mac by whisper.cpp, whatever AI provider you use. Sending audio to an online transcription service is a separate option, off by default: see [how privacy works](/privacy/overview/).
