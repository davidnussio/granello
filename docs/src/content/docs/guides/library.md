---
title: The Library
description: Browse meetings by project, person, tag and period, pin the ones you keep coming back to, tag several at once, and list decisions and actions across meetings.
---

The Library browses your meetings in columns: pick a dimension, then a value, then a meeting, with a preview next to it.

![The Library in columns](../../../assets/shots/en/library.webp)

## Dimensions

- **Pinned**: the meetings you pinned to the sidebar, see below.
- **Projects**: the projects you created, each with the meetings that belong to it.
- **People**: who took part.
- **Tags**: the tags on your meetings.
- **Period**: this week, then one group per month.
- **Recordings**: the saved audio, see below.

Arrow keys move through the columns and Enter opens the meeting.

## Projects

A project collects the meetings that belong together: a client, a product, a piece of work. **+ New project** at the top of the Projects column creates one, with a name, a color and a description.

A meeting belongs to one project at most. To put a meeting in a project, open it and choose the project at the top right of the header, above the copy, print and delete buttons; from there you can also create a new project. To move several meetings at once, select them in the Library and choose the project in the preview.

Hover a project to edit it (✎), archive it when it is done (⤓) or delete it (×). Archiving and deleting keep the meetings: an archived project moves under **Archived**, and the meetings of a deleted project are left without a project.

Projects made with earlier versions, when a project was a promoted tag, are converted on the first launch: each one keeps its name and its meetings, and the tag stays on the meetings as a plain tag.

## Pinned meetings

The pin in a meeting's header, next to copy, print and delete, keeps it in the sidebar right under **Library**, in the order you pinned them. Press it again to unpin. You can also pin or unpin from the Library preview, or pin several selected meetings at once. During a search the sidebar shows only the results; the pinned meetings come back when the search field is empty.

## Cross two dimensions

**+ Cross with…** at the top narrows everything to the meetings that also have one more thing: a person inside a project, a tag in a month.

## Several meetings at once

⌘-click or Shift-click selects several meetings. The preview then lets you choose the project for all of them, add a tag to all of them, or remove one from all of them.

## Items across meetings

The **Items** switch lists, instead of the meetings, what is written in their notes:

- **decisions**, from decision callouts;
- **actions**, from checklists, open or done;
- **quotes**, from transcript quotes.

Filter by type with the chips at the top, and search in their text. Double-click an item to open its meeting.

![The Items view: decisions and actions from several meetings in one list](../../../assets/shots/en/items.webp)

## Recordings

With **Save recordings** on, the Library shows one card per meeting with its recordings. Each has a player with the audio waveform: click or drag it to move.

- **Remove pauses** cuts the silent parts. Afterwards the audio's minutes no longer match the transcript.
- **Merge** joins the recordings of a meeting recorded in several takes into one file.

Both use ffmpeg, which release packages include. With it, recordings are also compressed, to about 20 MB per hour. A build from source without ffmpeg keeps recordings as WAV and does not offer these two actions.

![Saved recordings, one card per meeting, with the waveform](../../../assets/shots/en/recordings.webp)

## Search

The search field in the sidebar (⌘K) looks in titles, tags, participants, notes, AI notes and transcripts. Redacted text is not found, because it no longer exists.
