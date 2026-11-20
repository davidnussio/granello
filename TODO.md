# TODO

The general next steps (Developer ID signing, native system-audio capture, calendar
OAuth…) live in the "Next steps" section of the [README](README.md).

## Editor components

Blocks that could be added to the notes editor. The classics and the cool ones are
done; the last group has started with the moment marker. The editor also has headings, lists, checklists, quote,
code block, divider, links and snippets.

**Storage:** notes are stored as Markdown, and every block has a readable Markdown
form (see the table in the README). Blocks made of data rather than text share one
base, `src/editor/dataBlock.ts`: the transcript-linked blocks can build on it.

**Where to start:** transcript quote, decision and action item with an owner. They
build on data Granello already has (timestamped segments, people directory,
attendees), and a generic editor can't copy them.

### Classics

- [x] **Table**: rows and columns with a header, Tab to move between cells.
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
- [x] **Columns**: two or three blocks side by side.

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

- [ ] **Transcript quote**: select a sentence said in the meeting and it becomes a quote with who said it and the minute. One click reopens the transcript at that point.
- [x] **Moment marker**: press a key while recording and the note keeps a marker with the timestamp. When the meeting ends, the AI fills it in with what was being said.
- [ ] **Decision**: a "we decided X" block with who was there and the transcript sentences that back it up. All decisions become searchable across meetings.
- [ ] **Action item with an owner**: a checklist where each item has a person and a due date, and that reappears on its own in the next meeting with the same people until it is closed.
- [ ] **Open question**: a question left unanswered, which Granello brings up again at the next meeting with whoever was supposed to answer.
- [ ] **Live AI block**: a block holding a request ("summarize the client's objections") that recomputes as the transcript grows.
- [ ] **"Since last time"**: at the top of the note, what was decided and what was left open in the last meeting with the same people or the same tag.
- [ ] **Poll filled in from the transcript**: write the question and the AI suggests who said what, with the minute as evidence. You confirm.
- [ ] **Who spoke how much**: a bar showing speaking time. Today it only tells "You" from "Others"; per person it would need speaker recognition.
- [ ] **Numbers mentioned**: a table of figures, dates and amounts said in the meeting, each with the minute it was said.
- [ ] **Meeting glossary**: acronyms and proper names heard, with their definition. The same terms improve the transcription of later meetings.
- [ ] **Follow-up draft**: an email block with recipients taken from the attendees and the text from the note's decisions and action items.
