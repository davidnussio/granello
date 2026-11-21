---
title: Install
description: Download Granello for macOS (Linux and Windows are experimental), open it the first time, or build it from source.
---

Granello runs on macOS. Linux and Windows versions exist too, still experimental.

## Download

Get the file for your system from the [latest release](https://github.com/davidnussio/granello/releases/latest):

| System | File |
| --- | --- |
| Mac with Apple Silicon | `Granello-<version>-macOS-arm64.dmg` |
| Mac with Intel | `Granello-<version>-macOS-intel.dmg` |
| Linux (x86_64) | `Granello-<version>-linux-x86_64.AppImage` |
| Windows (x86_64) | `Granello-<version>-windows-x86_64-setup.exe` |

**macOS**: needs macOS 13 or later; recording the other participants from the system audio needs macOS 14.6 or later. Open the DMG and drag Granello to Applications. The app is not signed with an Apple Developer ID yet, so macOS blocks it the first time: open *System Settings → Privacy & Security* and click *Open Anyway*. If macOS says the app is damaged, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Granello.app
```

**Linux**: make the AppImage executable (`chmod +x Granello-*.AppImage`), then run it.

**Windows**: the installer is not signed, so SmartScreen warns on first launch: click *More info*, then *Run anyway*.

## Build from source

Requirements:

- macOS 13 or later.
- Stable Rust, Node 20 or later, pnpm.
- Xcode Command Line Tools and `cmake` (`brew install cmake`).

```bash
git clone https://github.com/davidnussio/granello.git
cd granello
pnpm install
pnpm tauri dev      # run it in development
pnpm tauri build    # .app and .dmg in src-tauri/target/release/bundle
```

Release packages include a small ffmpeg, used to compress recordings and to remove pauses. A build from source uses the ffmpeg installed on the computer, if there is one. To include it as the releases do:

```bash
scripts/build-ffmpeg.sh
pnpm tauri build --config src-tauri/tauri.ffmpeg.conf.json
```

The build is **not signed** with an Apple Developer ID. On the Mac that built it, it opens normally. Copied to another Mac, Gatekeeper blocks it on first launch.

## Linux and Windows (experimental)

The Linux and Windows versions come from the same code. They are **experimental**: they compile and pass the tests, but they have not been tried on everyday machines yet.

What changes compared with the Mac:

- **Transcription** runs on the CPU, with no graphics acceleration: it is slower. A smaller model such as `small` keeps up better.
- **System audio**: on Windows Granello listens to the default audio output. On Linux it records the "monitor" source of the default output, which needs PulseAudio or PipeWire. Otherwise, pick a "Monitor" device as the other participants' source.
- **API keys** go in Windows Credential Manager. On Linux they stay in a file in the data folder that only your user can read.

Requirements to build them from source:

- **Linux** (Debian, Ubuntu and derivatives): `sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libasound2-dev cmake`, plus Rust, Node and pnpm. `pnpm tauri build` produces an AppImage.
- **Windows**: Visual Studio Build Tools with the C++ workload, `cmake`, plus Rust, Node and pnpm. `pnpm tauri build` produces an installer. It is not signed, so Windows SmartScreen warns on first launch.

## Try it without the backend

The interface also runs in a browser on sample data, with no recording and no AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=en
```

## Updates

The app checks for a new version when it starts and asks before installing it. It restarts only when it is not recording.

Next: [your first meeting](/start/first-meeting/).
