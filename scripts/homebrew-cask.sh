#!/usr/bin/env bash
# Scrive il cask Homebrew di Granello per una versione pubblicata, con lo SHA-256 dei due DMG.
# Lo usa .github/workflows/homebrew.yml per aggiornare davidnussio/homebrew-tap.
#
#   scripts/homebrew-cask.sh <versione> <sha256 arm64> <sha256 intel> > Casks/granello.rb
set -euo pipefail

VERSION="$1"
SHA_ARM="$2"
SHA_INTEL="$3"

cat <<EOF
cask "granello" do
  arch arm: "arm64", intel: "intel"

  version "$VERSION"
  sha256 arm:   "$SHA_ARM",
         intel: "$SHA_INTEL"

  url "https://github.com/davidnussio/granello/releases/download/v#{version}/Granello-#{version}-macOS-#{arch}.dmg"
  name "Granello"
  desc "Meeting notepad with local transcription and AI notes"
  homepage "https://granello.dambox.ch/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # l'app si aggiorna da sola (updater di Tauri)
  auto_updates true
  depends_on macos: :ventura

  app "Granello.app"

  # The app is not signed with an Apple Developer ID yet:
  # drop the quarantine attribute so Gatekeeper lets it open.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/Granello.app"],
        must_succeed:   false,
        writable_paths: ["Granello.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/ch.dambox.granello",
    "~/Library/Caches/ch.dambox.granello",
    "~/Library/Logs/ch.dambox.granello",
    "~/Library/Preferences/ch.dambox.granello.plist",
    "~/Library/Saved Application State/ch.dambox.granello.savedState",
    "~/Library/WebKit/ch.dambox.granello",
  ]
end
EOF
