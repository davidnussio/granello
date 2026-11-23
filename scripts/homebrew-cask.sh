#!/usr/bin/env bash
# Scrive il cask Homebrew di Granello per una versione pubblicata, con lo SHA-256 del DMG.
# Lo usa .github/workflows/homebrew.yml per aggiornare davidnussio/homebrew-tap. Per ora
# solo Mac Apple Silicon.
#
#   scripts/homebrew-cask.sh <versione> <sha256 del DMG arm64> > Casks/granello.rb
set -euo pipefail

VERSION="$1"
SHA256="$2"

cat <<EOF
cask "granello" do
  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/davidnussio/granello/releases/download/v#{version}/Granello-#{version}-macOS-arm64.dmg"
  name "Granello"
  desc "Meeting notepad with local transcription and AI notes"
  homepage "https://granello.dambox.ch/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # l'app si aggiorna da sola (updater di Tauri)
  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :ventura

  # firmata con Developer ID e notarizzata: Gatekeeper la apre senza passaggi
  app "Granello.app"

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
