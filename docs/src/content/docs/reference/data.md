---
title: Data and files
description: Where Granello keeps your meetings, models, recordings, keys and logs, and how to back them up.
---

Everything Granello stores is on your Mac.

## The data folder

`~/Library/Application Support/ch.dambox.granello/`

| Item | What it is |
| --- | --- |
| `granello.sqlite` | The database: meetings, notes, AI notes, transcripts, tags, people, templates, settings and the calendar addresses |
| `models/` | The whisper models you downloaded |
| `attachments/` | Images you pasted and files you attached. Removed when the last meeting that uses them is deleted |
| `recordings/` | Saved recordings, unless you chose another folder |
| `audio/` | Audio waiting for online transcription, only with that option on. Deleted after the upload |
| `waveforms/` | The waveforms shown in the players, computed from the recordings |

## Elsewhere

- **API keys**: in the macOS Keychain.
- **Logs**: `~/Library/Logs/ch.dambox.granello/Granello.log`. They contain no notes, no transcripts, no API keys and no calendar addresses.

## Backup

Quit Granello and copy the data folder. Time Machine includes it by default. To move to another Mac, copy the folder to the same place and enter your API keys again: the Keychain is not part of the folder.

## Recordings folder

**Settings → Recordings** lets you choose where saved recordings go. Recordings made before the change stay where they were and keep working.

## Deleting

- Deleting a meeting removes its notes, its transcript and its saved recordings.
- **Remove sample data** removes only the sample meetings.
- To remove everything, quit Granello and delete the data folder and the log folder.

## Database versions

The database is upgraded when a new version of Granello opens it. An older version of the app does not open a database made by a newer one.
