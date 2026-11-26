---
title: Record and transcribe
description: Microphone and call audio, uploading a file, several people at one microphone, moment markers.
---

## Two sources

Granello records two things separately:

- your **microphone**, shown as "You" in the transcript;
- the **call audio**, shown as "Others".

For the call audio, choose **System audio** as "Other participants' audio", in Settings or next to the Record button. Granello then records what the computer plays, with nothing to install. It needs macOS 14.6 or later, and the first time macOS asks for permission (*System Settings → Privacy & Security → Screen & System Audio Recording*).

Use headphones. Without them the microphone also picks up the others, and the transcript has their words twice.

On older systems, see [troubleshooting](/reference/troubleshooting/) for the loopback device.

## While recording

- The bar under the note shows the audio levels and the timer.
- The **Transcript** panel on the right is open from the start, and the text fits next to it on a laptop screen too. Its title shows how many pieces the transcript has; the sidebar icon in the top right corner closes it and opens it again.
- **⚑ Mark** (⇧⌘M), at the bottom of the panel, adds a marker with the minute to your note, without moving the cursor. When the transcription ends, the AI writes in each marker what was being said around that minute.
- **❝ Quote**, next to it, puts the last transcribed sentence in your note, with who said it and the minute it started.
- With the panel closed, **⚑ Mark** and **❝ Quote** move to the bar under the note.
- **At the mic** says who is speaking when several people share one microphone. From that moment the transcript credits that person.

You can stop and resume on the same note: the transcript continues.

## How transcription works

The audio is cut on pauses, into pieces of 6 to 20 seconds, and each piece is transcribed on your Mac by whisper.cpp. The note's title and attendees are given to the model as a hint for names and terms. Phrases that speech models invent on silence are filtered out.

## Upload a file

**Upload audio** transcribes an existing file instead of recording live: MP3, M4A/AAC, WAV, FLAC, OGG Vorbis, AIFF, CAF, or the audio track of an MP4 or MOV video. The file is read where it is and never copied. Opus is not supported.

## Who said what

Select any part of the transcript and use **Who's speaking…** to assign it to an attendee, to yourself or to a new name.

## Saved recordings

With **Save recordings** on (Settings, off by default), the audio you record stays in a folder on your Mac. Listen to it next to the transcript, or in the Library under **Files → Recordings**. See [the Library](/guides/library/).

## If something goes wrong

If you quit while recording, the audio already recorded is transcribed before the app closes. If the audio device is unplugged, the session ends cleanly and keeps what was recorded.
