---
title: Install
description: Download Granello for Macs with Apple Silicon, or build it from source.
---

Granello runs on Macs with Apple Silicon (M1 or later) and macOS 13 or later.

## Homebrew

On a Mac, the quickest way:

```bash
brew install --cask davidnussio/tap/granello
```

## Download

Or get `Granello-<version>-macOS-arm64.dmg` from the [latest release](https://github.com/davidnussio/granello/releases/latest). Recording the other participants from the system audio needs macOS 14.6 or later. Open the DMG and drag Granello to Applications.

Granello is signed with an Apple Developer ID (dambox Sagl) and notarized by Apple, so macOS opens it straight away, whether it comes from Homebrew or from the DMG.

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

A build from source is **not signed** with an Apple Developer ID. On the Mac that built it, it opens normally. Copied to another Mac, Gatekeeper blocks it on first launch.

## Try it without the backend

The interface also runs in a browser on sample data, with no recording and no AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=en
```

## Updates

The app checks for a new version when it starts and asks before installing it. It restarts only when it is not recording.

Next: [your first note](/start/first-meeting/).
