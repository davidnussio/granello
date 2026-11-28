# TODO

The general next steps (native system-audio capture, calendar OAuth…) live in the "Next steps" section of the [README](README.md).

## Library

Browse meetings by project, person, tag and period (cascading columns). A meeting belongs to one project at most.

- [x] Columns with preview, keyboard navigation, projects (create with name, color and description, archive, delete).
- [x] **Vaults**: in Settings, a vault is a folder you choose (an encrypted or external disk too) with its own database, attachments and recordings; its meetings exist only there. One vault is open at a time, and a vault can set a minimum privacy level for everything it holds.
- [x] Cross two dimensions (a person inside a project) with a filter on top.
- [x] Tag several selected meetings at once.
- [x] A view of items across meetings (decisions, action items, quotes). It reads what the notes already have: decision callouts, checklists and transcript quotes. The dedicated decision and action-item blocks (see "Editor components") will feed the same view.
- [ ] A board to arrange a selection of those items, if the first two views are not enough.

- [ ] **Files**: a Library entry in place of "Recordings" that lists every file of the vault:
  recordings, images and other attachments of the notes, and files imported without a note.

## People and groups

Groups of people (team, department, client, whole company), nested like projects. A team
brings its members into a note; an audience stays a single chip.

- [x] Groups with team/audience, People page in the sidebar, multi-select into groups, group
  chips in a note, Groups dimension in the Library, demo groups.
- [x] CSV import (`name,email,role,group`) that creates people and groups in one go.
- [x] Role and other names on a person: from merges and renames too; recognised among attendees, in the calendar and in suggestions.
- [x] Calendar: an attendee that is a mailing list (`CUTYPE=GROUP`) becomes the group with
  that address; an event with many invitees offers to add them as a group.
- [x] "From the audience" in the "At the mic" selector when a note has an audience group.
- [x] Prompts: the group name and size instead of every member's name.
- [x] Possible duplicates (same email, similar names) and people with no notes.
- [ ] Suggest a group when the same set of people keeps meeting (recurring events).
- [ ] Action items assigned to a group; "Since last time" per group.

## Import from other apps

Settings → Import from. One source per page; the first is Obsidian. An import is a **copy,
made once**: the source folder is only read, never changed. Every import is recorded, its
notes carry a tag (`#obsidian`) and the vault's minimum privacy, nothing is sent to a model,
and "Undo import" deletes everything it created.

- [ ] **Obsidian**, decided on 2026-11-25:
  - `[[Note]]`, `[[Note|alias]]` become a **link between notes** (a new editor block, see
    below); `[[Note#heading]]` loses the heading; `![[note]]` (transclusion) becomes a link.
  - `![[image.png]]`, `![](image.png)`, `![[doc.pdf]]` are copied into `attachments/` (image or
    📎 attachment); files over 25 MB are left out and listed in the report.
  - **Folders**: the top-level folder becomes the note's project (created if missing), the
    rest of the path a tag (`Lavoro/Clienti/Acme.md` → project "Lavoro", tag "clienti").
    Changed on 2026-11-25 after a real vault: in a PARA vault (Projects, Areas, Resources,
    Archive, also translated or numbered) the folder below is the project and the category a
    tag; folders starting with `_` give only a tag; a `progetto`/`project` property wins over
    the folder, and `partecipanti`/`attendees` become the participants.
    Changed again on 2026-11-25: projects can sit inside other projects (`parent_id`, schema
    v13) and every folder is a project inside the one above (`dambox/bizcard`); the PARA
    category is no longer a tag; tags with `/` show as a tree in the Library.
  - **Loose files** (no note uses them) go into Library → Files, without a note.
  - **Frontmatter**: `tags` and inline `#tags` become tags, `created`/`date` (or a date in the
    file name, or the file's date) the note's date, `title` the title; every other property
    is kept in a collapsible "Properties" section at the top of the note.
  - Callouts are mapped onto NOTE / WARNING / DECISION; a foldable callout (`[!x]-`) becomes a
    collapsible section. `%%comments%%` and `^block-ids` are dropped; task states other than
    done (`[/]`, `[-]`, `[>]`…) become open tasks. `.canvas` files are skipped.
  - Importing the same folder again skips the notes already imported (by path), and the
    report lists the ones changed in Obsidian since then.
- [ ] More sources later (Notion export, Apple Notes, plain Markdown folders).
- [ ] **Link between notes** `[[Title]]`: a pill that opens the note with that title, also
  inserted by hand with `[[`; renaming a note updates the links to it; a link to a missing
  note is shown as such. Not `[[toc]]`, `[[2026-11-26]]`, `[[rating:4]]` and the other
  reserved forms.

## Privacy and online models

Today transcription is always local (whisper) and only text goes to the AI provider.
These tasks add an online option without giving up privacy first.

- [x] **Online transcription and diarization**: optionally use an online model to transcribe and to tell speakers apart (who said what), instead of the local whisper model. Off by default. Done as a pass after the meeting, started by the user (*Refine online*, never automatic): the audio is kept on disk, uploaded once to Gladia, the transcript is replaced by one with speakers, and the audio is deleted. Never tried against the real service yet.
  - [ ] Try it on a real Italian recording and compare with another EU-hosted service before settling on Gladia.
  - [ ] Refine an imported audio file too (today only live recordings are kept).
  - [ ] Recordings longer than 135 minutes (Gladia's limit for one request).
- [x] **PRIVACY button in the note**: a per-meeting switch that forces local models, whatever the global settings say. Two levels:
  - **Local audio**: the audio is processed only on this Mac (local transcription, no online diarization); the text can still go to the configured AI provider for notes, chat and the editor's AI.
  - **Hardened**: nothing leaves the Mac. Transcription, AI notes, chat, live AI block, title and every other AI feature use local models only, or are unavailable if no local model is configured.
- [x] **Redact parts of the discussion**: an entry to black out pieces of the transcript, in two modes:
  - **Redact now**: the selected part is blacked out immediately and is never sent to any model nor shown again.
  - **Mark to review**: the part is flagged as "to verify" and stays readable until someone decides whether to redact it.
- [x] **Pending reviews block non-local processing**: while a meeting has parts marked "to verify", no processing with non-local models runs on it (online transcription, AI notes, chat, editor AI). It resumes once every flagged part has been looked at and either redacted or cleared.

## Sync between devices

Today each vault is one SQLite file plus its attachments and recordings, on one Mac. A
SQLite file cannot be synced as a file (iCloud or Dropbox copy it while the app writes,
and the WAL travels apart from the database), so the plan is a small sync protocol with
pluggable backends, one vault at a time.

**Shape**

- The **vault folder stays where it is** (an encrypted or external disk too) and keeps
  `granello.db`, the local copy of attachments and recordings, and `sync.json` (which
  backend, and how far this device has read each other device's log). None of it is synced.
- The **sync folder** is somewhere else (iCloud Drive, Dropbox, S3…) and holds only
  encrypted data: `log/<device>/…`, `blobs/<sha256>`, `snapshot/…`.
- The database stops being the source of truth: it is the state built from the logs, kept
  so the app opens and searches at once. A broken or lost `granello.db` is rebuilt from the
  latest snapshot plus the logs that follow it.

**Phase 0 (in progress): try it with iCloud Drive**

A developer preview, with demo data: development builds, or published builds with Settings →
Data and privacy → Developer previews on. Without encryption the sync folder holds notes and
transcripts in clear text.

- [ ] Settings → Vaults, on the open vault: choose a sync folder (e.g. in iCloud Drive), sync
  now, stop syncing, with the status (last sync, devices, pending changes, conflicts).
- [ ] SQLite triggers note every change to meetings, transcript segments, projects and people
  in an outbox; every few seconds the outbox becomes a file in `log/<device>/`, and the files
  of the other devices are merged by clock and applied.
- [ ] Last writer wins per field. For the notes and the AI notes, a concurrent edit keeps the
  losing version in the database (`sync_conflicts`): no screen to resolve it yet.
- [ ] Hardened meetings, and a vault whose minimum privacy is hardened, do not sync.
- [x] Attachments of the notes travel as `files/<name>` in the sync folder (a name is never
  reused, so a file is copied once), copied without holding the database; those of hardened
  notes stay on the Mac. A file deleted from a note stays in the folder for now.
- [ ] Not in phase 0: audio, files imported without a note, chat, encryption, snapshots,
  cleaning unused files out of the folder, watching the folder (it is polled).
- Known limits: a meeting that becomes hardened after it synced stays on the other devices;
  an open meeting changed on another device is reloaded, and an edit typed in the last
  second before the reload can be lost.

**Steps**

- [ ] **Operation log**: every change (meeting title, note, tag, project, privacy…) is an
  operation stamped with a hybrid logical clock. Each device writes only in its own folder
  of the log, a new immutable file per batch (never appended to: a sync service may upload
  a file while it is being written), written to a temporary name and then renamed. A device
  reads the others' files and applies them to its database in a deterministic order.
- [ ] **Blobs by content**: recordings and attachments are stored as `blobs/<sha256>` and a
  meeting only references them (hash, size, duration). Transcripts and notes always sync;
  audio downloads **on demand** ("Download (34 MB)" in the player), and a rule frees space
  (keep the last N days locally).
- [ ] **End-to-end encryption**: logs, blobs and snapshots are encrypted on the device with
  a per-vault key before they leave. A backend stores and relays opaque data and cannot read
  notes or transcripts. To decide: how the key reaches a second device (passphrase, QR code
  from a device already set up).
- [ ] **Snapshots and compaction**: from time to time a device writes an encrypted snapshot
  of the state with the position it reached in every log. A new device starts from the
  latest snapshot; logs older than a snapshot every device has read can be deleted.
- [ ] **Minimal protocol**: `putBlob / getBlob / hasBlob` and `appendLog(device, batch) /
  listLogs(since)`, plus listing and reading snapshots. Backends implement only this.
- [ ] **First backend: a folder**. Covers iCloud Drive, Dropbox, Google Drive, Syncthing, a
  NAS or a USB disk with no server. iCloud, Dropbox and Google Drive already keep files on
  demand on macOS ("dataless" placeholders): reading one blocks until it is downloaded, so
  blobs are checked first and downloaded in the background. For iCloud this is a folder
  in iCloud Drive chosen by the user, not the app's own iCloud container or CloudKit: those
  need an Apple Developer account, entitlements and a signed app.
- [ ] **More backends**: S3-compatible (R2, B2, MinIO), WebDAV, and a Granello sync server
  in the style of the Divano app (Node, Vercel, Neon), which is then one backend among
  others, not the only way.
- [ ] **Conflicts**: metadata (title, tags, project, privacy) is last-writer-wins per field.
  For the note body, when two devices changed it since the last sync both versions are kept
  and the meeting shows "conflicting version" to resolve by hand. Later, a CRDT for the body
  (Yjs with `y-prosemirror`) if conflicts turn out to be common, as long as the stored note
  stays readable Markdown.
- [ ] **Settings → Vaults**: per vault, sync off (as today) or one backend, with its status
  (last sync, devices, pending blobs) and a "Sync now" button. One backend per vault to start.

**To decide before writing code**

- [ ] **Hardened privacy and sync**: "nothing leaves the Mac" may rule out even an encrypted
  iCloud folder. Proposal: hardened meetings never sync, or only to local backends (NAS,
  disk). It is a public promise, so it needs David's call.
- [ ] **Own devices only, or sharing with other people?** Sharing brings users, permissions
  and keys per person. Proposal: own devices only.
- [ ] **iPhone later?** If yes, the folder backend works there only through iCloud Drive,
  and S3 or the server matter more.

## Editor components

Blocks that could be added to the notes editor. The classics and the cool ones are
done; the last group has started with the transcript quote, the moment marker and the live AI block. The editor also has headings, lists, checklists, quote,
code block, divider, links and snippets.

**Storage:** notes are stored as Markdown, and every block has a readable Markdown
form (see the table in the README). Blocks made of data rather than text share one
base, `src/editor/dataBlock.ts`: the transcript-linked blocks can build on it.

**Markdown that changes on every save** (found while making bare URLs and images in list
items stable; both were already there):

- [ ] An empty checklist item followed by a plain list (`- [ ] ` then `- Chi riceve…`, in the
  demo note "Flusso di una consegna") gains a `- \[ \]` line at every save.
- [ ] An image as the first thing in a list item (`- ![](attachments/x.png)`) is moved out of
  the list when the note is read: the item stays empty and the list is split in two.

**Where to go next:** decision and action item with an owner. They
build on data Granello already has (timestamped segments, people directory,
attendees), and a generic editor can't copy them.

### Classics

- [x] **Table**: rows and columns with a header, Tab and Enter to move between cells, handles to add and delete rows and columns.
- [x] **Callout**: a highlighted box with an icon (note, warning, decision).
- [x] **Toggle**: a collapsible section with a title, for details you don't always want in view.
- [x] **Image**: paste or drag a screenshot into the note.
- [x] **Attachment**: a file linked to the note, with its name and size.
- [x] **Highlighter**: highlighted text in several colours.
- [x] **@person mention**: from the people directory, with autocomplete.
- [x] **Date**: a "Thursday 26" pill that stays a real date, not text.
- [x] **Link preview**: a pasted URL becomes a card with title and site.
- [x] **Formula**: LaTeX maths, inline or as a block.
- [x] **Table of contents**: an outline generated from the note's headings.
- [x] **Columns**: two or three blocks side by side, with a handle per column to add, delete or unwrap.

### Cool ones

- [x] **Poll**: a question with options and a vote count, to record a vote taken in the meeting.
- [x] **Diagram**: Mermaid written as text and drawn live (flows, sequences, Gantt).
- [x] **Whiteboard**: a freehand sketch inside the note.
- [x] **Kanban**: "to do / doing / done" columns with draggable cards.
- [x] **Timeline**: milestones with dates along a line.
- [x] **Chart**: bars or lines generated from a table in the note.
- [x] **Timer**: a countdown for an agenda item.
- [x] **Progress bar**: a percentage computed from the section's checklists.
- [x] **Pros and cons**: two columns side by side with a verdict at the bottom.
- [x] **Decision matrix**: options by criteria, with weights and a total score.
- [x] **Rating**: stars or a 1-to-5 score, handy in interviews.
- [x] **Embed**: Figma, Loom, YouTube or a map visible inside the note.

### The ones nobody has, but we do

They build on what only Granello has in one place: a timestamped transcript, people,
calendar and AI.

- [x] **Transcript quote**: select a sentence said in the meeting and it becomes a quote with who said it and the minute. One click reopens the transcript at that point.
- [x] **Moment marker**: press a key while recording and the note keeps a marker with the timestamp. When the meeting ends, the AI fills it in with what was being said.
- [ ] **Decision**: a "we decided X" block with who was there and the transcript sentences that back it up. All decisions become searchable across meetings.
- [ ] **Action item with an owner**: a checklist where each item has a person and a due date, and that reappears on its own in the next meeting with the same people until it is closed.
- [ ] **Open question**: a question left unanswered, which Granello brings up again at the next meeting with whoever was supposed to answer.
- [x] **Live AI block**: a block holding a request ("summarize the client's objections") that recomputes as the transcript grows.
- [ ] **"Since last time"**: at the top of the note, what was decided and what was left open in the last meeting with the same people or the same tag.
- [ ] **Poll filled in from the transcript**: write the question and the AI suggests who said what, with the minute as evidence. You confirm.
- [ ] **Who spoke how much**: a bar showing speaking time. Today it only tells "You" from "Others"; per person it would need speaker recognition.
- [ ] **Numbers mentioned**: a table of figures, dates and amounts said in the meeting, each with the minute it was said.
- [ ] **Meeting glossary**: acronyms and proper names heard, with their definition. The same terms improve the transcription of later meetings.
- [ ] **Follow-up draft**: an email block with recipients taken from the attendees and the text from the note's decisions and action items.
