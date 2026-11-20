---
title: How privacy works
description: What stays on your Mac, what can leave it, and when. The short version, with a table.
---

Granello is built so that what is said in a meeting stays yours. This page says exactly what stays on your Mac and what can leave it.

## The short version

- **Audio** is transcribed on your Mac and then discarded. It is not saved and not uploaded, unless you turn on one of the two options below.
- **Notes and transcripts** live in a database on your Mac.
- **Text** (notes and transcript) is sent to the AI provider you configured, only when you generate AI notes, use the chat or use an AI feature in the editor. With a local provider, nothing leaves your Mac.
- **No bot** joins the call, and Granello has no account and no server of its own.

## What can leave your Mac

| What | When | How to prevent it |
| --- | --- | --- |
| Notes and transcript, as text | You generate AI notes, ask the chat or use ✦ in the editor, with an online AI provider | Use a [local provider](/privacy/local-models/), or set the meeting to [hardened](/privacy/levels/) |
| The meeting's audio | Only with **online transcription** turned on, when the meeting ends | Leave the option off (the default), or set the meeting to local audio or hardened |
| The address of a link | You create a link preview: the linked page is asked for its title, once | Do not create link previews |
| A request for embedded content | You press **Load** on an embed (video, design, map) | Do not press Load |
| A request for your calendar | Granello downloads the iCal addresses you added | Do not add a calendar |
| A check for updates | When the app starts | — |
| A model download | You download a transcription model in Settings | Needed once, to transcribe on your Mac |

Images from the Internet are never loaded in a note.

## The two options that keep audio

Both are **off by default**.

- **Save recordings** keeps each meeting's audio in a folder on your Mac, to listen to it again. It is never uploaded.
- **Online transcription** uploads a meeting's audio to an online transcription service when the meeting ends, to get a transcript that tells speakers apart. The audio is kept in the data folder until the upload, then deleted. It never runs for a meeting with local audio or hardened privacy, or with parts still to review.

## Where things are stored

- The database, the transcription models and the attachments are in `~/Library/Application Support/ch.dambox.granello/`.
- API keys are in the macOS Keychain.
- The logs contain no notes, no transcripts, no API keys and no calendar addresses.

More in [data and files](/reference/data/).

## What you control per meeting

- The [privacy level](/privacy/levels/) decides whether anything of that meeting may leave the Mac.
- [Redact and review](/privacy/redaction/) remove a sentence for good, or hold a meeting back until you have looked at it.
