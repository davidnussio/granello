---
title: Import from Obsidian
description: Copy the notes of an Obsidian vault into Granello, with their images, files, links, tags and folders. The Obsidian vault is only read.
---

**Settings → Import from** copies the notes of an Obsidian vault into the Granello vault that is open. The Obsidian vault is only read: nothing in it changes, and you can keep using it.

## How it works

1. Press **Choose the Obsidian vault…** and pick the vault's folder (the one that holds `.obsidian`).
2. Granello reads the folder and shows what it would import: how many notes, how many files, which projects, and what is left out and why. Nothing is copied yet.
3. Press **Import N notes**.

Each imported note gets the `#obsidian` tag and the minimum privacy of the open vault. Nothing is sent to an AI model: the notes are not enhanced, and you can do that later, note by note.

## What becomes what

| In Obsidian | In Granello |
| --- | --- |
| A note | A note, with the file name as its title (or the `title` property) |
| `[[Note]]`, `[[Note\|text]]` | A [link to that note](/guides/notes/#blocks) |
| `[[Note#Heading]]`, `![[Note]]` | A link to the note (Granello has no links to a heading, and does not embed a note in another) |
| `![[image.png]]`, `![](image.png)` | An image, copied into the vault's attachments |
| `![[file.pdf]]`, `[text](file.pdf)` | An attachment, copied |
| A folder | A project, created if it is not there yet. Each subfolder is a project inside the one above: `Work/Clients/Acme.md` goes into "Clients", inside "Work" |
| PARA folders (`Projects`, `Areas`, `Resources`, `Archive`, also numbered like `1 - Projects`) | Left out of the tree: `Projects/dambox/bizcard/Call.md` goes into "bizcard", inside "dambox". Projects that come only from `Archive` are created archived |
| Folders starting with `_` (`_daily`) | Never a project: from there down the folders become a tag (`_fit/_daily` → `fit/daily`) |
| The `progetto` or `project` property | The note's project, in place of the folder |
| The `partecipanti`, `attendees` or `participants` property | The note's participants, added to [People](/guides/people/) |
| `tags` and `#tags` in the text | Tags |
| `created` or `date`, or a date in the file name | The note's date; otherwise the date of the file |
| Other properties (`status`, `aliases`, …) | A collapsible **Properties** section at the top of the note (empty ones are dropped) |
| Callouts (`> [!tip]`, `> [!danger]`…) | The nearest callout: note, warning or decision |
| Foldable callouts (`> [!faq]-`) | A collapsible section |
| Tasks `- [/]`, `- [-]`, `- [>]`… | Open tasks |
| `%%comments%%` and `^block-ids` | Removed |
| Files no note uses | **Library → Files**, without a note |

Code blocks stay as they are, `dataview` queries included. A link to a note that does not exist stays a link, shown as missing, and works as soon as you create a note with that title.

## What is left out

- Obsidian's templates folder (the one set in Obsidian, or a top-level folder called `Templates` or `_templates`), the hidden folders (`.obsidian`, `.trash`), canvases (`.canvas`) and bases (`.base`).
- Excalidraw drawings.
- Files larger than 25 MB, and notes larger than 5 MB.

The summary before the import lists each of them with the reason.

## Importing again

Importing the same folder again brings in only what is new: notes already imported are skipped. A note you changed in Obsidian after importing it is not updated; the summary lists it. A note you deleted in Granello is imported again.

## Undo an import

Every import stays listed under **Past imports**. **Undo import** deletes the notes and files it brought in, even if you changed them afterwards, and the projects and people it created if they are left empty (a project that still holds another one stays). Projects and people you already had stay.
