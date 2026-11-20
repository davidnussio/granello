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

## Try it without the backend

The interface also runs in a browser on sample data, with no recording and no AI:

```bash
pnpm preview        # http://localhost:1430/preview.html?lang=en
```

## Updates

Once releases exist, the app checks for a new version when it starts and asks before installing it. It restarts only when it is not recording.

Next: [your first meeting](/start/first-meeting/).
