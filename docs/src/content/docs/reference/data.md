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
| `audio/` | Audio waiting for online transcription, only with that option on, until you refine or delete it. Deleted after the upload |
| `waveforms/` | The waveforms shown in the players, computed from the recordings |

## Elsewhere

- **API keys**: in the macOS Keychain.
- **Logs**: `~/Library/Logs/ch.dambox.granello/Granello.log`. They contain no notes, no transcripts, no API keys and no calendar addresses.

## Backup

Quit Granello and copy the data folder. Time Machine includes it by default. To move to another Mac, copy the folder to the same place and enter your API keys again: the Keychain is not part of the folder.

## Vaults

A vault is a folder with its own database, attachments and recordings: the meetings of a vault exist only there. Put one on an encrypted or external disk to keep confidential meetings apart from the rest. The data folder above is the **Main** vault and is always there.

**Settings → Vaults** adds a vault: give it a name, choose its folder and a minimum privacy level. An empty folder becomes a new vault; the folder of a vault that already exists, even one made on another Mac, is found again with its meetings.

- **One vault is open at a time.** With more than one vault, an icon next to Settings, at the bottom of the sidebar, opens another. The meeting list, the Library, search and chat show only the open vault. You cannot switch while a recording or an AI generation is running.
- **What a vault holds**: `granello.sqlite` (meetings, notes, AI notes, transcripts, tags, projects, people, chat), `attachments/`, `recordings/`, `audio/` and `waveforms/`.
- **What stays on this Mac for every vault**: settings, templates, calendar addresses, the list of vaults, the whisper models and the API keys.
- **Minimum privacy**: none, at least local audio, or always hardened. New meetings in the vault start at that level and cannot go below it. Raising the minimum raises the vault's meetings that were below it right away. See [privacy levels](/privacy/levels/).
- **A vault on a disk that is not connected** is shown as not available. If it was the open one, Granello starts on the Main vault.
- **Remove from the list** only forgets the vault: its folder and its data stay where they are. To delete a vault, delete its folder.

Granello does not encrypt a vault: the protection comes from where you put it, for example an encrypted disk image or an encrypted external disk.

## Recordings folder

**Settings → Audio and recordings** lets you choose where the Main vault's saved recordings go. Recordings made before the change stay where they were and keep working. Other vaults always keep their recordings in their own folder.

## Deleting

- Deleting a meeting removes its notes, its transcript and its saved recordings.
- **Remove sample data** removes only the sample meetings.
- To remove everything, quit Granello and delete the data folder and the log folder.

## Database versions

The database is upgraded when a new version of Granello opens it. An older version of the app does not open a database made by a newer one.
