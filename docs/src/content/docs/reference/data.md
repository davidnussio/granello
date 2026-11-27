---
title: Data and files
description: Where Granello keeps your notes, models, recordings, keys and logs, and how to back them up.
---

Everything Granello stores is on your Mac.

## The data folder

`~/Library/Application Support/ch.dambox.granello/`

| Item | What it is |
| --- | --- |
| `granello.sqlite` | The database: notes, AI notes, transcripts, tags, people, templates, settings and the calendar addresses |
| `models/` | The whisper models you downloaded |
| `attachments/` | Images you pasted and files you attached. Removed when the last note that uses them is deleted |
| `recordings/` | Saved recordings, unless you chose another folder |
| `audio/` | Audio waiting for online transcription, only with that option on, until you refine or delete it. Deleted after the upload |
| `waveforms/` | The waveforms shown in the players, computed from the recordings |

## Elsewhere

- **API keys**: in the macOS Keychain.
- **Logs**: `~/Library/Logs/ch.dambox.granello/Granello.log`. They contain no notes, no transcripts, no API keys and no calendar addresses.

## Backup

Quit Granello and copy the data folder. Time Machine includes it by default. To move to another Mac, copy the folder to the same place and enter your API keys again: the Keychain is not part of the folder.

## Vaults

A vault is a folder with its own database, attachments and recordings: the notes of a vault exist only there. Put one on an encrypted or external disk to keep confidential notes apart from the rest. The data folder above is the **Main** vault and is always there.

**Settings → Vaults** adds a vault: give it a name, choose its folder and a minimum privacy level. An empty folder becomes a new vault; the folder of a vault that already exists, even one made on another Mac, is found again with its notes.

- **One vault is open at a time.** With more than one vault, an icon next to Settings, at the bottom of the sidebar, opens another. The list of notes, the Library, search and chat show only the open vault. You cannot switch while a recording or an AI generation is running.
- **What a vault holds**: `granello.sqlite` (notes, AI notes, transcripts, tags, projects, people, chat), `attachments/`, `recordings/`, `audio/` and `waveforms/`.
- **What stays on this Mac for every vault**: settings, templates, calendar addresses, the list of vaults, the whisper models and the API keys.
- **Calendars**: each calendar is set up once, and each vault chooses which ones it shows on the Home screen and in notifications: in **Settings → Calendar** ("Shown in"), or with the calendar names above the upcoming events, which apply to the open vault. A new calendar appears in every vault until you remove it from one.
- **Minimum privacy**: none, at least local audio, or always hardened. New notes in the vault start at that level and cannot go below it. Raising the minimum raises the vault's notes that were below it right away. See [privacy levels](/privacy/levels/).
- **The minimum privacy follows the vault.** It is written in the vault, not on this Mac: when you add a vault that already exists on another Mac, its own level applies, and there you can only raise it. To change it, the vault must be reachable.
- **A vault on a disk that is not connected** is shown as not available. If it was the open one, Granello starts on the Main vault.
- **One computer at a time.** While a vault is open, its folder holds the file `granello.lock` with the name of the computer using it; it goes away when the vault is closed. Another computer shows it as "Open on…" and does not open it. If that computer is no longer using it (it shut down abruptly, the disk was unplugged), **Open anyway** takes it over. Do not put a vault in a synced folder (iCloud Drive, Dropbox) to use it from two computers at once: there the file arrives late and the check is not enough to protect the database.
- **Remove from the list** only forgets the vault: its folder and its data stay where they are. To delete a vault, delete its folder.

Granello does not encrypt a vault: the protection comes from where you put it, for example an encrypted disk image or an encrypted external disk.

## Recordings folder

**Settings → Audio and recordings** lets you choose where the Main vault's saved recordings go. Recordings made before the change stay where they were and keep working. Other vaults always keep their recordings in their own folder.

## Developer previews

**Settings → Data and privacy → Developer previews** shows features that are not finished yet. It is off by default. A preview can change or disappear from one version to the next: try it only with the sample data.

### Sync between your Macs

For now there is one preview: syncing a vault between your Macs through a folder, for example in iCloud Drive. Turn it on in **Settings → Vaults**, with the vault you want to sync open. The sync folder holds notes, transcripts and attachments in clear text.

- **Only the open vault syncs**, not all of them. The sync folder is not a vault: the vault stays where it is, and in the folder each Mac writes its changes, which the other Macs read and apply.
- **Conflicts**: for each field the latest change wins. If the same note changes on two Macs at once, the version left behind is kept aside.
- **Synced**: notes with their text, AI notes, attendees, groups and tags, transcripts, the images and files attached to notes, projects and people. A large attachment can take a few seconds more than its note to appear on the other Mac.
- **Not synced**: audio and recordings, files imported without a note (for now), settings, templates, calendars, API keys and your Mac's contacts, which Granello never copies.
- **Never synced**: hardened notes and their attachments. A vault whose minimum privacy is hardened does not sync.

To add another Mac, turn on the developer previews there, open the vault that should receive the data (for example Main) and, in **Settings → Vaults**, choose the same sync folder. That vault joins the first one: it receives its notes and sends its own. To keep them apart, use a new, empty vault on the other Mac.

Each sync folder belongs to one vault. To sync another vault, open it and choose another empty folder, for example `Granello-Clients` next to the first one.

## Deleting

- Deleting a note removes its text, its transcript and its saved recordings.
- **Remove sample data** removes only the sample notes.
- To remove everything, quit Granello and delete the data folder and the log folder.

## Database versions

The database is upgraded when a new version of Granello opens it. An older version of the app does not open a database made by a newer one.
