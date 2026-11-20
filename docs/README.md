# Granello docs

The documentation site, at [granello.dambox.ch](https://granello.dambox.ch): Astro Starlight, English at the root and Italian under `/it/`.

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # static site in dist/
```

It is a package of its own, with its own `pnpm-workspace.yaml` and lockfile, outside the app's install.

- Pages are in `src/content/docs` (English) and `src/content/docs/it` (Italian), with the same file names.
- Screenshots are in `src/assets/shots/<lang>`. `pnpm screenshots` in the repository root regenerates them from the demo data and copies them here, with one image per `/` command in `commands/` (examples in `scripts/command-examples.mjs`): never use real meetings.
- Vercel builds this folder (project root directory `docs`, settings in `vercel.json`) and skips the build when nothing here changed.
