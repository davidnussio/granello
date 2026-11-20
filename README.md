# Granello

**English** · [Italiano](README.it.md)

A [Granola](https://granola.ai) clone: jot down a few notes during the meeting, Granello records and transcribes **locally** with whisper.cpp, then an AI model (Claude or a local model) merges your notes and the transcript into complete notes. No bot joins the call.

## Features

- **Notes + recording**: Markdown editor (TipTap) with a `/` command menu, a formatting toolbar on selection, links and checklists, autosave, recording with audio levels and a timer, resuming on the same meeting.
- **Moment markers**: while recording, press ⇧⌘M (or "⚑ Mark") and the note keeps a marker with the minute, without moving your cursor. When the transcription ends, the AI writes in each marker what was being said around that minute; ↗ on a marker opens the transcript at that point. Markers also tell the AI notes which parts mattered to you.
- **Transcript quotes**: select a sentence in the transcript panel and "❝ Quote in notes" turns it into a quote with who said it and the minute. The speaker starts as you or "Others" and can be corrected; ↗ reopens the transcript at that point.
- **Editor blocks**: tables, callouts, collapsible sections, columns, images (paste a screenshot), file attachments, link previews, LaTeX formulas, a live table of contents, highlighting, `@person` mentions and date pills; plus meeting tools: polls, kanban boards, timelines, pros and cons, decision matrices, star ratings, timers, progress bars, charts, Mermaid diagrams, a freehand whiteboard and embeds. Everything is still saved as readable Markdown:

  | Block | Shortcut | In Markdown |
  | --- | --- | --- |
  | Table | `\| ` + space | a Markdown table |
  | Callout | `! ` + space | `> [!NOTE]`, `> [!WARNING]`, `> [!DECISION]` |
  | Collapsible section | `/` menu | `::: details Title` … `:::` |
  | Columns | `/` menu | `:::: columns` with a `::: column` each |
  | Image, attachment | paste, drop or `/` menu | `![alt](attachments/…)`, `[📎 name](attachments/…)` |
  | Link preview | `/` menu | `[Title](https://… "preview")` |
  | Formula | `$x^2$`, `$$` + space | `$…$`, `$$` … `$$` |
  | Table of contents | `/` menu | `[[toc]]` |
  | Highlight | ⌘⇧H | `==text==`, `==text=={.green}` |
  | Person | `@` | `@[Name]` |
  | Date | `/` menu | `[[2026-11-26]]` |
  | Poll | `/` menu | `::: poll Question` with `- [3] Option` lines |
  | Kanban board | `/` menu | `::: kanban` with `## Column` and `- card` lines |
  | Timeline | `/` menu | `::: timeline` with `- 2026-11-26 Milestone` lines |
  | Pros and cons | `/` menu | `::: pros-cons` with `+ pro`, `- con`, `= verdict` |
  | Decision matrix | `/` menu | `::: matrix` around a table (criterion, weight, a score per option) |
  | Star rating | `/` menu | `[[rating:4]]` |
  | Timer | `/` menu | `[[timer:05:00]]` |
  | Progress bar | `/` menu | `[[progress]]` (computed from the section's checklists) |
  | Chart | `/` menu | `[[chart:bar]]`, `[[chart:line]]` (draws the table above it) |
  | Diagram | `/` menu | a `mermaid` code block |
  | Whiteboard | `/` menu | a `sketch` code block, one line per stroke |
  | Embed | `/` menu | `[Title](https://… "embed")` |
  | Transcript quote | select text in the transcript, `/` menu | `::: quote 12:34 Name` … `:::` |
  | Moment marker | ⇧⌘M or "⚑ Mark" while recording, `/` menu | `::: moment 12:34` … `:::` |
- **Local transcription**: whisper.cpp with Metal on Apple Silicon. Audio is cut on pauses (6-20 s), resampled to 16 kHz and transcribed on a dedicated thread. Typical hallucinations ("Thanks for watching", "[Music]"...) are filtered out. The meeting title and attendees are passed as the initial prompt to improve names and terms.
- **Two sources**: the microphone ("You") and a loopback device for the call audio ("Others").
- **Upload a recording**: instead of recording live, *Upload audio* transcribes an existing file (MP3, M4A/AAC, WAV, FLAC, OGG Vorbis, AIFF, CAF, or the audio track of an MP4/MOV video) with the same pipeline, appending to the meeting's transcript. The file is read in place, never copied. Opus is not supported.
- **AI notes**: the model (streaming) enriches your notes following the template you chose. AI notes stay editable.
- **Templates**: General, 1:1, Standup, Interview, Client meeting, plus your own.
- **Calendar**: one or more iCal URLs (Google, Outlook), each of which can be turned on or off from the home screen, recurring events with RRULE, EXDATE and overrides, a notification before the start, one click to open the meeting's notes.
- **Chat**: ask about one meeting or all of them (SQLite FTS5 full-text search finds the relevant meetings, answers cite title and date).
- **Tags and participants**: tag meetings (the sidebar shows up to two per meeting) and edit who took part. Granello keeps a people directory and autocompletes from it and from the names in your calendar; a meeting that overlaps a calendar event offers to import its attendees.
- **Search** in the sidebar across titles, tags, participants, notes, AI notes and transcripts.
- **Shortcuts**: ⌘N new notes, ⌘K search, ⌘, settings.
- **English and Italian**: the interface follows your Mac's language and can be changed in Settings → Profile.

## AI models

AI notes and chat can use different models, even from different providers (Settings → AI models). Two protocols cover everything:

| Provider type | Used for |
|---|---|
| Anthropic | Claude (the default provider, always present) |
| OpenAI-compatible | LM Studio (`http://localhost:1234/v1`), Ollama (`http://localhost:11434/v1`), OpenAI, OpenRouter and any server exposing `/chat/completions` |

- The model list is read from the server (`/models`); "Test" checks that the provider responds.
- Each provider has its own API key in the Keychain; local servers usually don't need one.
- **Context of local models**: an hour of meeting is tens of thousands of tokens, and local servers silently truncate what doesn't fit (Ollama starts with a small context). If you enter the provider's context size, Granello estimates the request size and stops with a clear error instead of producing notes from half a transcript.
- The reasoning of local "thinking" models (`<think>…</think>`) is stripped from the answer.
- With a local provider for both notes and chat, nothing leaves your Mac.

## Languages

The interface is available in English and Italian. On first launch it follows the system language (Italian if the Mac is set to Italian, English otherwise); Settings → Profile lets you pin a language, and the change applies immediately. Errors, notifications, built-in templates and date/time formats follow the same language. The *meeting language* (the one being spoken, used for transcription and for the AI notes) is a separate setting.

In the frontend Italian is the source language: `t("Testo italiano")` looks up the translation in `src/i18n/en.ts`. `pnpm check` fails if a string has no English translation. In the backend every message carries both versions: `tr("italiano", "english")`, and `trf!` for messages with parameters.

## Reliability

- **No lost meetings**: if you quit while recording, capture stops and the audio already recorded is transcribed before the app exits (up to 2 minutes). After a crash, meetings left "recording" are closed and reindexed on the next launch.
- **Audio device unplugged** (e.g. AirPods): the session ends cleanly with a warning and keeps what was recorded. If the microphone gives no signal at all for 8 seconds, a permissions hint appears.
- **AI models**: automatic retry on transient errors (429, 5xx, overload, network), cancellable generation, truncated or interrupted answers reported instead of silently saved. A failed regeneration leaves the existing AI notes untouched. In single-meeting chat with Claude, the context is prompt-cached.
- **Database**: versioned migrations (`PRAGMA user_version`), transactional writes, WAL. A database created by a newer version is not opened.
- **Model downloads**: partial files removed on error, size and format checks, models deletable from Settings.
- **Single instance**: opening the app a second time brings the existing window to the front.
- **Logs** in `~/Library/Logs/ch.dambox.granello/Granello.log` (rotated). They contain no notes, transcripts, API keys or the calendar URL.

## Privacy

Audio is never saved: it is transcribed locally and discarded. Notes and transcripts stay in the local database. Only text (notes and transcript) is sent to the AI provider you chose, when you generate AI notes or use the chat; with a local provider nothing leaves your Mac. API keys live in the Keychain; the iCal URLs live in the local database. Pasted images and attached files are copied into the app's data folder (`attachments/`) and removed when the last meeting that uses them is deleted. A link preview asks the linked page for its title once, when you create it; images from the Internet are never loaded. Embedded content (YouTube, Vimeo, Loom, Figma, maps) is loaded only when you press *Load* on it, and only from those services.

## Architecture

```
src-tauri/src
├── lib.rs         setup, state, logging, single instance, clean exit, calendar watcher + notifications
├── commands.rs    Tauri commands (meetings, recording, AI, templates, settings, models, calendar)
├── audio.rs       cpal capture (audio thread) + pause-based Chunker + transcription thread
├── decode.rs      decoding of uploaded audio files (symphonia) into mono blocks
├── transcribe.rs  whisper-rs, model catalog, resampling, hallucination filter
├── llm.rs         streaming from AI models (Anthropic and OpenAI-compatible): retry, cancellation, prompt caching
├── prompts.rs     enhance/chat prompts and built-in templates
├── calendar.rs    iCal parser + recurrence expansion
├── db.rs          SQLite (bundled rusqlite) + FTS5, versioned migrations, crash recovery
├── secrets.rs     provider API keys in the macOS Keychain
└── i18n.rs        language of backend texts (Italian / English)
src/               React + TypeScript (Vite)
├── editor/        the note editor, assembled from plugins
└── i18n/          interface translations
```

### Plugin-based editor

The editor (`src/editor`) is a TipTap shell that knows nothing about individual features: it gets them from a list of plugins. A plugin can contribute TipTap extensions, commands for the `/` menu and buttons for the toolbar shown on selected text.

```ts
// src/editor/plugins/example.ts
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

export const example: EditorPlugin = {
  name: "example",
  extensions: () => [/* TipTap nodes, marks or shortcuts */],
  commands: [
    {
      id: "risk",
      get title() {
        return t("Rischio"); // Italian source text; add the English one to src/i18n/en.ts
      },
      icon: "!",
      group: "Meeting",
      keywords: ["rischio", "risk"],
      run: (e) => e.chain().focus().insertContent(t("**Rischio:** ")).run(),
    },
  ],
  toolbar: [/* buttons, optionally with their own panel (see plugins/links.tsx) */],
};
```

To enable it, add it to `defaultPlugins` in `src/editor/index.ts`, or pass your own list to `<NoteEditor plugins={...} />`. A plugin with the same `name` as an existing one replaces it. Built-in plugins: `base`, `formatting`, `headings`, `lists`, `tasks`, `blocks`, `links`, `snippets`.

Data lives in `~/Library/Application Support/ch.dambox.granello/` (the `granello.sqlite` database, models in `models/`).

## Getting started

Requirements: macOS 13+, stable Rust, Node 20+, pnpm, Xcode Command Line Tools, `cmake` (`brew install cmake`).

```bash
pnpm install
pnpm tauri dev          # development
pnpm dev:secrets        # development, with the Claude key injected by envsec (no Keychain prompt)
pnpm tauri build        # .app and .dmg in src-tauri/target/release/bundle
```

Checks before a release:

```bash
pnpm check              # tsc + translations + clippy (warnings are errors) + cargo test
```

### Distribution

`pnpm tauri build` produces an **unsigned** app: Gatekeeper blocks it on another Mac. Distributing it requires a *Developer ID Application* certificate and Apple notarization: set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID` before building, and Tauri signs and notarizes on its own. The microphone and network entitlements are already in `src-tauri/entitlements.plist`.

First launch (the Home screen shows what's missing):

1. **Settings → AI models**: paste your Claude API key (it goes to the Keychain; alternatively export `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`; with the key in the environment the Keychain is never read), or add a local provider such as LM Studio or Ollama.
2. **Settings → Local transcription**: download `large-v3-turbo-q5_0` (547 MB, recommended on Apple Silicon) or `base` for a quick try.
3. **Settings → Calendar**: add a calendar and paste its secret iCal address. You can add more than one.
4. The first time you press Record, macOS asks for microphone permission.

## Other participants' audio

For now, system audio goes through a loopback device:

1. `brew install blackhole-2ch`
2. In *Audio MIDI Setup* create a **multi-output device** with your headphones + BlackHole 2ch.
3. Set that device as the system output (or the Teams/Zoom output).
4. In Granello choose *BlackHole 2ch* as "Other participants' audio".

Use headphones: without echo cancellation the microphone also picks up the others and the transcript is duplicated.

## Next steps

- Native system-audio capture with ScreenCaptureKit / Core Audio process taps (macOS 14.2+), without BlackHole.
- Echo cancellation between the microphone and system audio.
- Google Calendar OAuth instead of the iCal URL.
- Export to Notion / Google Docs, sharing notes.
- Sign with a Developer ID certificate. Until then the Keychain's "Always Allow" is lost on every build, which is why API keys are read once per launch and kept in memory (`secrets.rs`). Once signing is in place, reconsider whether that cache is still needed.
- Automatic updates (tauri-plugin-updater) once signing is in place.
- Optionally saving audio to re-transcribe with a better model.

## Tests

```bash
cd src-tauri && cargo test
```

They cover audio chunking, resampling, the hallucination filter, the iCal parser with recurrences, streaming/retry/cancellation for AI models (including against a simulated OpenAI-compatible server), settings validation, the database, migrations, crash recovery and search.
