---
title: People
description: "The people in your notes and their groups: teams, departments, clients, the whole company. Fix a name everywhere, merge duplicates, import a vCard file and use your Mac's contacts."
---

**People**, in the sidebar, lists everyone who appears as a participant in your notes, and the groups they belong to. Granello suggests them when you add participants to a note, and adds new ones on its own.

## Groups

A group brings people together: a team, a department, a client, the whole company. Groups sit inside other groups, like projects (`Whole company › Mobile team`), and the column on the left shows them as a tree, with **All people** and **No group** above them. Pick a group to see its members.

**+ New group** asks for a name, the group that contains it, a color and how the group enters a note:

- **Team**: adding it to a note also adds its members as attendees, one by one. Untick anyone who wasn't there. Good for a standup, a project team, a committee.
- **Audience**: the note shows a single chip and nobody is added. Tick only who spoke or should be named. Good for the whole company or a department, where listing everyone would bury the note.

New groups with more than 15 people start as an audience; you can change it in **Edit…**.

To fill a group, open it and type in the search field: below it Granello offers the people who match and, if the name is new, adds it as a new person (Return adds the only suggestion). To add many at once, paste a list in the same field: one person per line, with the email if you have it (`Name <email>`, or name and email in two spreadsheet columns). Granello recognises people already in the list by their email or name, and asks before adding them. Deleting a group asks for confirmation and leaves the notes and the people as they are.

## Groups in a note

Below a note's title, **+ Group** adds a group. Click the group's chip to see its members and tick who was there; × removes the group but keeps the attendees. When all the members of a team are already attendees, Granello suggests the team next to the chips.

Someone was there who isn't in the group? The chip's panel lists the note's attendees who are not members (**+ Name** adds them), and has a field to add anyone else, with suggestions from your people. When an attendee is in no group at all, like a new colleague, Granello suggests adding them to the note's team (**+ Name in “Team”?**); the × next to it stops suggesting that person for that group. The group's notes are listed in the [Library](/guides/library/), under **Groups**.

## The list

Every row is the same height: name, email, groups, number of notes and the date of the last one. Click a column heading to sort by it, and again to reverse the order. Click the number of notes to open them in the [Library](/guides/library/). With a group open, the Groups column shows only the person's *other* groups.

A group chip has a × that appears on hover: it takes the person out of that group without opening it. If someone is in more groups than fit, the row shows the first ones and `+N`, with the rest in the tooltip.

## Select several people

Click a row (or its checkbox) to select it; Shift-click selects everything in between, ⌘A the whole list, Esc clears the selection. The keyboard works too: ↑↓ move, Shift + ↑↓ select as you go, Space selects the row, Return edits it.

With people selected, the search bar becomes their toolbar:

- **Group…**: add them to a group or to a new one; with a group open, move them to another group or take them out.
- **Merge**, with exactly two selected: the one with fewer notes merges into the other (you can still change who stays).
- **Remove** takes them out of the list and their groups, after a confirmation; the notes stay as they are.

## Fix a name

Double-click a name or an email (or press ✎, or Return on the selected row) to edit it in place. Return saves and moves to the same field on the next row, Shift + Return to the row above, Esc cancels: filling in forty emails is forty lines of typing, not forty dialogs. The new name reaches every note: the participants, the @mentions in notes and AI notes, who said what in transcript quotes, and the groups. A name that already belongs to someone else is not taken: merge the two instead.

## Merge two people

The same person often ends up written in two ways ("Marco" and "Marco Bianchi"). Hover the one to remove, press ⇢ and choose who it really is. Its notes move to the other person, without duplicates, and it takes the email if the other had none.

Removing someone (×, then confirm) takes them out of the list and of their groups: the notes stay as they are.

## Import from a vCard file

**Import vCard…** reads a `.vcf` file exported from Contacts, Google Contacts or Outlook. Granello shows who is in it, and you choose who to add: people already in the list are unticked and get the email, if they had none. With a group open, the people you add can join it too. Nothing is added until you press **Add**.

## Your Mac's contacts

In **Settings → People**, turn on **Suggest people from your contacts** and, the first time, macOS asks for permission. From then on, while you type a participant, Granello also suggests names from your contacts and takes their email. **Fill missing emails** looks up, in your contacts, the people in the list who have no email yet.

Granello reads only the names you search for: your contacts are not copied, and they stay on your Mac. The option is off by default. To stop it, turn it off there or remove the permission in *System Settings → Privacy & Security → Contacts*.
