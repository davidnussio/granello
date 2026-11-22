---
title: Slash commands
description: Every command of the / menu in a note, what it inserts, its shortcut and how it is written in Markdown.
---

Type `/` in a note to open the command menu. Keep typing to filter it (it understands English and Italian words, so `/table` and `/tabella` both work), move with the arrows, insert with Enter, close with Esc. The menu does not open inside code. The name of a group shows the whole group: `/meeting` lists every block of the Meeting group, `/tools` every tool.

![The / menu open in an empty note: Structure and Lists at the top](../../../assets/shots/en/commands/menu.webp)

Everything a command inserts is saved as readable Markdown: each command below shows how. Several blocks have a shortcut you can type instead of opening the menu.

With the cursor inside a table, the menu starts with the table's own commands: **Add row above**, **Add row below**, **Add column to the left**, **Add column to the right**, **Delete row**, **Delete column**, **Delete table**. Inside a columns block it starts with the columns' commands: **Add column to the left**, **Add column to the right**, **Delete column**, **Remove the columns, keep the text**, **Delete the whole block**.

## Structure

### Text

A plain paragraph. Use it to turn a heading or a list item back into normal text.

![A paragraph of text in a note](../../../assets/shots/en/commands/text.webp)

### Title

The largest heading, usually one per note.

Shortcut: `#` + space. Markdown: `# Title`.

![A title at the top of a note](../../../assets/shots/en/commands/title.webp)

### Section

A heading for a part of the note. Sections are what the [table of contents](#table-of-contents) lists and what [progress](#progress) counts in.

Shortcut: `##` + space. Markdown: `## Section`.

![A section heading with a paragraph under it](../../../assets/shots/en/commands/section.webp)

### Subsection

A heading inside a section.

Shortcut: `###` + space. Markdown: `### Subsection`.

![A subsection heading with a paragraph under it](../../../assets/shots/en/commands/subsection.webp)

### Table of contents

An outline of the note's headings that updates as you write. Click a heading in it to jump there.

Markdown: `[[toc]]`.

![A table of contents listing four headings of the note](../../../assets/shots/en/commands/toc.webp)

## Lists

### Bullet list

Shortcut: `-` + space. Markdown: `- item`.

![A bullet list with three items](../../../assets/shots/en/commands/bullet-list.webp)

### Numbered list

Shortcut: `1.` + space. Markdown: `1. item`.

![A numbered list with three steps](../../../assets/shots/en/commands/numbered-list.webp)

### Action item

A checkbox to tick when the thing is done. Action items from every meeting are listed together in the [Library](/guides/library/#items-across-meetings), and [progress](#progress) counts them.

Shortcut: `[ ]` + space. Markdown: `- [ ] to do`, `- [x] done`.

![Three action items, one ticked, one assigned to a person with a due date](../../../assets/shots/en/commands/action-item.webp)

## Blocks

### Quote

A quote that is not from the transcript, for example from an email. For something said in the meeting use a [transcript quote](#transcript-quote).

Shortcut: `>` + space. Markdown: `> text`.

![A quoted sentence](../../../assets/shots/en/commands/quote.webp)

### Code block

Text shown as it is, in a monospaced font.

Shortcut: ```` ``` ```` + space. Markdown: a fenced code block.

![A short JSON snippet in a code block](../../../assets/shots/en/commands/code-block.webp)

### Divider

A horizontal line between two parts of the note.

Shortcut: `---` + Enter. Markdown: `---`.

![Two paragraphs separated by a horizontal line](../../../assets/shots/en/commands/divider.webp)

### Table

A table with a header row. Tab moves to the next cell, Enter to the one below; in the last row Enter adds a new one.

With the pointer or the cursor on a cell, two handles appear, one to the left of the row and one above the column: each opens a menu to add a row or a column next to it, delete it, or delete the table. The **+** bars below and to the right of the table add a row or a column at the end. The same actions are in the `/` menu.

Backspace in an empty row removes it, and in a table that is completely empty removes the table. At the start of the paragraph after the table, Backspace selects the table: press it again to delete it.

Shortcut: `|` + space. Markdown: a Markdown table.

![A table comparing three proposals by discount, term and margin](../../../assets/shots/en/commands/table.webp)

### Collapsible section

A title with content that opens on click, for details that are not needed every time. Sections are closed when you reopen the note.

Markdown: `::: details Title` … `:::`.

![An open collapsible section titled Who decides what](../../../assets/shots/en/commands/details.webp)

### Two columns

Two blocks side by side.

Each column has a handle at its top left: it opens a menu to add a column next to it (up to three), delete the column, remove the columns while keeping the text, or delete the whole block. The same actions are in the `/` menu.

Backspace in an empty column removes it; with two columns the text of the other one stays. At the start of the paragraph after the columns, Backspace selects the block: press it again to delete it.

Markdown: `:::: columns`, with a `::: column` … `:::` for each column.

![Two columns: what the client asks and what we offer](../../../assets/shots/en/commands/two-columns.webp)

### Three columns

Three blocks side by side, written like two columns with one more `::: column`.

![Three columns, one per feature, with its status](../../../assets/shots/en/commands/three-columns.webp)

### Formula

A formula inside a sentence, written in LaTeX.

Markdown: `$…$`.

![A sentence with an inline formula for the margin](../../../assets/shots/en/commands/formula.webp)

### Block formula

A formula on its own line, centred.

Shortcut: `$$` + space. Markdown: `$$` … `$$`.

![A centred block formula with a fraction](../../../assets/shots/en/commands/block-formula.webp)

## Callouts

### Highlighted note

A box that stands out from the text, for something not to miss.

Shortcut: `!` + space. Markdown: `> [!NOTE]`.

![A highlighted note](../../../assets/shots/en/commands/note.webp)

### Warning

A box for a risk or a critical point.

Markdown: `> [!WARNING]`.

![A warning callout about undocumented fields](../../../assets/shots/en/commands/warning.webp)

### Decision callout

A box for a decision. Decision callouts from every meeting are listed together in the [Library](/guides/library/#items-across-meetings).

Markdown: `> [!DECISION]`.

![A decision callout with an expiry date](../../../assets/shots/en/commands/decision-callout.webp)

## Attachments and links

### Image

Choose an image file; it is copied into the meeting's attachments. You can also paste a screenshot or drop an image into the note.

Markdown: `![description](attachments/…)`.

![An image in a note](../../../assets/shots/en/commands/image.webp)

### Attachment

Choose any file, up to 25 MB; it is copied into the meeting's attachments and shown with its name and size.

Markdown: `[📎 name (size)](attachments/…)`.

![A sentence ending with a PDF attachment](../../../assets/shots/en/commands/attachment.webp)

### Link preview

Paste a link and press Enter: the link becomes a card with the page title and the site. The title is asked of the page once, when the card is created.

Markdown: `[Title](https://… "preview")`.

![A link preview card with the page title and the site](../../../assets/shots/en/commands/link-preview.webp)

### Embed

A YouTube, Loom, Vimeo or Figma link, or a map, shown inside the note. Nothing is loaded until you click it: opening the note does not contact any site.

Markdown: `[Title](https://… "embed")`.

![An embedded YouTube video, waiting for a click before it loads](../../../assets/shots/en/commands/embed.webp)

## Meeting

### Decision

Starts a line with **Decision:** in bold, to write a decision while you take notes. To have it listed in the Library, use a [decision callout](#decision-callout).

Markdown: `**Decision:** …`.

![A line that starts with Decision in bold](../../../assets/shots/en/commands/decision.webp)

### Open question

Starts a line with **To clarify:** in bold, for something to sort out later.

Markdown: `**To clarify:** …`.

![A line that starts with To clarify in bold](../../../assets/shots/en/commands/open-question.webp)

### Current time

Writes the time of day, such as `10:42`, as plain text.

![A line that starts with the time of day](../../../assets/shots/en/commands/current-time.webp)

### Mark the moment

Marks the recording time, like ⇧⌘M while recording. When the meeting ends, the AI writes what was being said at that minute; you can also write it yourself. ↗ opens the transcript at that point.

Markdown: `::: moment 12:34` … `:::`.

![A marked moment at 12:34 with what was being said](../../../assets/shots/en/commands/moment.webp)

### Transcript quote

A sentence said in the meeting, with who said it and the minute. The quickest way to make one is to select text in the Transcript panel and press **❝ Quote** (while recording, the same button at the bottom of the panel quotes the last sentence); the command inserts an empty one to fill in, at the current minute of the recording. Quotes are listed in the [Library](/guides/library/#items-across-meetings).

Markdown: `::: quote 12:34 Name` … `:::`.

![A transcript quote with the speaker's name and the minute](../../../assets/shots/en/commands/transcript-quote.webp)

### Ask the AI

A request about the meeting, such as "What are the client's objections?", with its answer under it. The answer is recomputed while you record and once more when the transcription ends; ↻ asks again. It sends the notes and the transcript to the AI provider you configured: see [privacy levels](/privacy/levels/) for meetings where that must not happen.

Markdown: `::: ai Request` … `:::`.

![An AI block: a question about the client's objections and three answers](../../../assets/shots/en/commands/ask-ai.webp)

## Tools

Polls, kanban boards, timelines, pros and cons, decision matrices and diagrams have a **✦** button that creates or edits the block from a request written in your words. Like every AI feature, it sends the notes and the transcript to your provider.

### Poll

A question with options and votes, for a quick count in the meeting. − and + change the votes; the leading option is highlighted.

Markdown: `::: poll Question`, then `- [votes] option` for each option, then `:::`.

![A poll on the day of the weekly meeting with votes and percentages](../../../assets/shots/en/commands/poll.webp)

### Kanban board

Columns of cards, To do, In progress and Done to start with. Drag a card to another column, or move it with the arrows; the column names can be changed.

Markdown: `::: kanban`, a `## Column` heading per column and a `- card` per card, then `:::`.

![A kanban board with three columns of cards](../../../assets/shots/en/commands/kanban.webp)

### Timeline

Milestones with their dates, in order along a line. Past milestones are dimmed and the next one is highlighted. Add one at the bottom with its date.

Markdown: `::: timeline`, then `- 2026-12-10 Milestone` per milestone, then `:::`.

![A timeline of four milestones, the next one highlighted](../../../assets/shots/en/commands/timeline.webp)

### Pros and cons

Two columns, pros and cons, and a verdict under them.

Markdown: `::: pros-cons`, then `+ pro`, `- con` and `= verdict` lines, then `:::`.

![Pros and cons of a discount, with the verdict](../../../assets/shots/en/commands/pros-cons.webp)

### Decision matrix

Options compared on weighted criteria. The total of each option is the sum of weight × score, and the highest total is highlighted. **+ Criterion** and **+ Option** add rows and columns.

Markdown: a table inside `::: matrix` … `:::`, with criteria in the first column and weights in the second.

![A decision matrix comparing three features on three weighted criteria](../../../assets/shots/en/commands/matrix.webp)

### Rating

One to five stars inside a sentence. Click a star to change it.

Markdown: `[[rating:4]]`.

![A sentence ending with a four-star rating](../../../assets/shots/en/commands/rating.webp)

### Timer

A countdown for a point on the agenda, five minutes to start with: write another duration in minutes, or minutes:seconds. Start, pause and reset it; a notification says when the time is up. Only the duration is saved: when you reopen the note the timer is stopped and ready.

Markdown: `[[timer:05:00]]`.

![A five-minute timer next to an agenda point](../../../assets/shots/en/commands/timer.webp)

### Progress

A bar with how many action items are done in its section: from the heading above it to the next heading of the same level. Without a heading above, it counts the whole note. It stores no numbers, it counts the checkboxes each time.

Markdown: `[[progress]]`.

![A progress bar at two of four, above the section's action items](../../../assets/shots/en/commands/progress.webp)

### Chart

Draws the nearest table above it: the first column gives the labels, the other columns the numbers. The chart follows the table as you edit it, and switches between bars and lines.

Markdown: `[[chart:bar]]` or `[[chart:line]]`; the data stays in the table.

![A table of feature requests and the bar chart drawn from it](../../../assets/shots/en/commands/chart.webp)

### Diagram

Flows and sequences written as text in [Mermaid](https://mermaid.js.org/), drawn in the note. **Edit the diagram** shows the text.

Markdown: a `mermaid` code block.

![A flowchart: counter-offer, the client's board, then contract or new call](../../../assets/shots/en/commands/diagram.webp)

### Whiteboard

A freehand sketch, in four colours. **✦ To diagram** has the AI read the sketch and put a Mermaid diagram under it.

Markdown: a `sketch` code block: the size, then one line per stroke.

![A whiteboard sketch of two screens joined by an arrow](../../../assets/shots/en/commands/whiteboard.webp)

## People and dates

### Person

Mentions a person: type a name and choose from your contacts and the people in your calendar, or use a new name as it is. The `@` key opens the same list.

Markdown: `@[Name Surname]`.

![A sentence that mentions two people](../../../assets/shots/en/commands/person.webp)

### Today's date

Inserts today's date as a date, shown as "Today" or as the weekday and day. Click it to choose another day.

Markdown: `[[2026-11-26]]`.

![A sentence ending with today's date](../../../assets/shots/en/commands/today.webp)

### Tomorrow's date

The same, with tomorrow's date.

![A sentence ending with tomorrow's date](../../../assets/shots/en/commands/tomorrow.webp)
