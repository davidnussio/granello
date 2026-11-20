# Granello: notes for agents

Tauri 2 desktop app for macOS: Rust backend in `src-tauri/src`, React +
TypeScript (Vite) in `src`. Read `README.md` for features, architecture and
privacy rules; `TODO.md` for open work. A dambox project: shared decisions
and knowledge live in `~/Developer/repos/dev-commons`.

- Keep the identifier `ch.dambox.granello`: the data folder
  (`~/Library/Application Support/ch.dambox.granello/`), the logs, the
  keychain entries and the update URL depend on it. Only the visible name may
  change.
- Privacy is the product. Logs never contain notes, transcripts, API keys or
  calendar URLs. Audio is never stored unless the user turned on saved
  recordings or online transcription. A meeting with privacy "hardened", or
  with parts still to review, never reaches an online model.
- Interface text: Italian is the source language. `t("Testo italiano")` in the
  frontend, with the English version in `src/i18n/en.ts`; `tr("italiano",
  "english")` / `trf!` in the backend. Error messages say what to do next.
- A schema change is a new versioned migration in `src-tauri/src/db.rs`
  (`PRAGMA user_version`), with a test.
- Editor features are plugins in `src/editor/plugins`; every block must stay
  readable Markdown (table in the README).
- Demo data: `src-tauri/demo/it.txt` and `en.txt`, every meeting tagged
  `#faker`. Screenshots and anything public use only demo data.
- `pnpm check` must pass: tsc, `oxlint --deny-warnings`, `oxfmt --check`,
  translations, clippy with warnings as errors, cargo test. Format with
  `pnpm fmt`.
- UI changes: `pnpm preview` serves the interface in the browser with demo
  data and no backend (`preview.html`, port 1430); check it there before
  saying it works. `pnpm screenshots` regenerates the showcase images.
- Vite uses port 1420 (Tauri's `devUrl`).
- Documentation site: `docs/` (Astro Starlight, English and Italian, granello.dambox.ch on
  Vercel). It is a package of its own (run `pnpm install` inside it). A
  change users can see goes in the docs too, in both languages; `pnpm screenshots` also
  refreshes the images there. Text on that site follows the same rules as any public text:
  demo data only, nothing promised that does not exist.
- Releases: `version` must match in `package.json`, `src-tauri/Cargo.toml`
  and `src-tauri/tauri.conf.json`; the tag `vX.Y.Z` starts
  `.github/workflows/release.yml`, which builds Apple Silicon and Intel DMGs,
  signs the updater artifacts and creates a **draft** release with
  `latest.json`. Never publish it without David's go-ahead: once published it
  reaches every installed app as an update. The updater private key exists
  only in GitHub secrets and David's password manager; never commit it.
- Commits follow Conventional Commits, written in Italian, with no AI
  attribution trailer.
