---
title: Troubleshooting
description: The microphone gives no signal, the others are not recorded, the app does not open, the AI notes stop.
---

## The microphone gives no signal

If nothing is heard for 8 seconds, Granello shows a hint. Check *System Settings → Privacy & Security → Microphone* and allow Granello, then start the recording again.

## The others are not in the transcript

- Choose **System audio** as "Other participants' audio". It needs macOS 14.6 or later.
- Allow Granello in *System Settings → Privacy & Security → Screen & System Audio Recording*.
- Do not pick the virtual device that a meeting app installs to share computer sound: it does not carry the voices of the call.

### On older systems: a loopback device

1. `brew install blackhole-2ch`
2. In *Audio MIDI Setup* create a **multi-output device** with your headphones and BlackHole 2ch.
3. Set that device as the system output, or as the output of your meeting app.
4. In Granello choose *BlackHole 2ch* as "Other participants' audio".

## The transcript has everything twice

The microphone is picking up the loudspeakers. Use headphones: there is no echo cancellation yet.

## A name keeps appearing in the transcript

Speech models can repeat a hint on silence or noise. Granello filters these repetitions; a transcript made by an earlier version keeps them.

## macOS says the app cannot be opened

A build made on another Mac is not signed with an Apple Developer ID, so Gatekeeper blocks it. Build it on the Mac where you use it: see [install](/start/install/).

## The AI notes stop with an error about size

The meeting is longer than what the local model accepts. Use a model with a larger context, raise the context in your local server, and enter the real value in the provider's **Context (tokens)** field. See [local models](/privacy/local-models/).

## AI features are not available on one meeting

The meeting is **hardened** and no local provider is configured, or it has parts **to review**. See [privacy levels](/privacy/levels/) and [redact and review](/privacy/redaction/).

## Remove pauses and Merge are missing

They need ffmpeg. Release packages include it. In a build from source, install it (`brew install ffmpeg` on the Mac) or include it as described in [Install](/start/install/), then reopen Granello.

## Still stuck

Open an issue on [GitHub](https://github.com/davidnussio/granello/issues). The log file is at `~/Library/Logs/ch.dambox.granello/Granello.log` and contains no notes or transcripts.
