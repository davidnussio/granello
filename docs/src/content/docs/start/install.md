---
title: Install
description: Granello has no published release yet. This is how to build and run it from source on macOS.
---

Granello runs on macOS. There is **no published release yet**: for now you build it from source. When releases start, the DMG files for Apple Silicon and Intel will be on the [GitHub releases page](https://github.com/davidnussio/granello/releases), and the app will update itself from there.

## Requirements

- macOS 13 or later. Recording the other participants from the system audio needs macOS 14.6 or later.
- Stable Rust, Node 20 or later, pnpm.
- Xcode Command Line Tools and `cmake` (`brew install cmake`).

## Build from source

```bash
git clone https://github.com/davidnussio/granello.git
cd granello
pnpm install
pnpm tauri dev      # run it in development
pnpm tauri build    # .app and .dmg in src-tauri/target/release/bundle
```

The build is **not signed** with an Apple Developer ID. On the Mac that built it, it opens normally. Copied to another Mac, Gatekeeper blocks it on first launch.

## Linux and Windows (experimental)

Granello also builds on Linux and Windows, from the same code. These builds are **experimental**: they compile and pass the tests, but they have not been tried on everyday machines yet.

What changes compared with the Mac:

- **Transcription** runs on the CPU, with no graphics acceleration: it is slower. A smaller model such as `small` keeps up better.
- **System audio**: on Windows Granello listens to the default audio output. On Linux it records the "monitor" source of the default output, which needs PulseAudio or PipeWire. Otherwise, pick a "Monitor" device as the other participants' source.
- **API keys** go in Windows Credential Manager. On Linux they stay in a file in the data folder that only your user can read.

Build requirements:

- **Linux** (Debian, Ubuntu and derivatives): `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libasound2-dev cmake`, plus Rust, Node and pnpm. `pnpm tauri build` produces an AppImage.
- **Windows**: Visual Studio Build Tools with the C++ workload, `cmake`, plus Rust, Node and pnpm. `pnpm tauri build` produces an installer. It is not signed, so Windows SmartScreen warns on first launch.

## Try it without the backend

The interface also runs in a browser on sample data, with no recording and no AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=en
```

## Updates

Once releases exist, the app checks for a new version when it starts and asks before installing it. It restarts only when it is not recording.

Next: [your first meeting](/start/first-meeting/).
