# Certification

The requirements every Granello version must meet before it is released. Each one has
an id, and each one is checked automatically: a failed check blocks the release.

```bash
pnpm certify
```

It runs the configuration checks (`scripts/certify.mjs`) and the Rust tests that span
several modules (`src-tauri/src/certification.rs`). `pnpm check` runs the configuration
checks too, and every Rust test. The tests listed below by module live next to the code
they check.

A new promise to users (in the README, the docs or the interface) gets a requirement here,
with its check, in the same change.

## Identity and release

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-REL-01 | The identifier stays `ch.dambox.granello`: data folder, logs, keychain entries and updates depend on it. | `certify.mjs` |
| C-REL-02 | The version is the same in `package.json`, `Cargo.toml`, `Cargo.lock` and `tauri.conf.json`. | `certify.mjs` |
| C-REL-03 | Updates are signed (the updater has its public key) and come only from this repository's GitHub releases. | `certify.mjs` |
| C-REL-04 | CI creates the release as a draft: publishing it is David's decision. | `certify.mjs` |
| C-REL-05 | No secrets in tracked files: updater private key, PEM keys, API keys, signing keys. | `certify.mjs` |

## macOS and sandbox

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-MAC-01 | macOS shows why the app asks for the microphone and the call audio. | `certify.mjs` |
| C-MAC-02 | The minimum macOS version is the one the docs promise, in both languages. | `certify.mjs` |
| C-SEC-01 | Entitlements are exactly microphone and outgoing network. | `certify.mjs` |
| C-SEC-02 | The interface has only the expected Tauri permissions (no file system, no shell). | `certify.mjs` |
| C-SEC-03 | The CSP allows no external scripts, no `unsafe-eval`, and no network from the interface: every request goes through the Rust backend. | `certify.mjs` |
| C-SEC-04 | Attachments never leave the attachments folder. | `attachments::never_leaves_the_attachments_folder` |
| C-SEC-05 | API key files are readable only by the user, and one per provider. | `secrets::key_files_are_private_and_removable`, `secrets::accounts_are_per_provider` |

## Privacy

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-PRIV-01 | A hardened meeting, or one with parts still to review, never reaches an online model. With a local model configured it goes there; otherwise the feature is unavailable. | `certification::c_priv_01_…` |
| C-PRIV-02 | Logs and error messages never contain notes, transcripts, titles, API keys or calendar URLs, even when something fails. | `certification::c_priv_02_…` |
| C-PRIV-03 | No log line formats a variable that holds content, keys or addresses. | `certify.mjs` |
| C-PRIV-04 | Only servers on this Mac count as local models. | `commands::only_servers_on_this_mac_are_local` |
| C-PRIV-05 | Redaction is permanent, and parts to review are counted. | `db::redaction_is_permanent_and_reviews_are_counted` |
| C-PRIV-06 | A vault's minimum privacy raises every meeting in it. | `db::a_vault_can_raise_the_privacy_of_its_meetings`, `vaults::a_vault_keeps_its_own_meetings_and_minimum_privacy` |
| C-PRIV-07 | Hardened meetings never reach the sync folder. | `sync::hardened_meetings_stay_on_the_mac` |
| C-PRIV-08 | Audio reaches Gladia only when the user presses *Refine online*: never automatically when a meeting ends. | `certify.mjs` |

## Data

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-DATA-01 | A database from any released schema opens and reaches the latest one with no integrity errors. A database from a newer version is not opened and stays as it is. | `certification::c_data_01_…` |
| C-DATA-02 | Migrations are versioned and run once; earlier data survives them. | `db::migrations_are_versioned_and_idempotent` and the other `db::…_on_migration` tests |
| C-DATA-03 | Meetings left recording after a crash are closed and reindexed. | `db::recovers_meetings_left_recording` |
| C-DATA-04 | Sample data is valid in both languages, every meeting is tagged `#faker`, and removing it never touches real meetings. | `demo::shipped_demo_data_is_valid`, `db::demo_data_comes_and_goes_without_touching_real_meetings` |

## Vaults

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-VAULT-01 | A long job (online refinement, AI, recordings) keeps the vault busy, and never writes into another vault if the vault changes anyway. | `certification::c_vault_01_…` |
| C-VAULT-02 | A vault shows only its own meetings; one that cannot be reached falls back to the main vault without being forgotten. | `vaults::a_vault_keeps_its_own_meetings_and_minimum_privacy` |
| C-VAULT-03 | A sync folder belongs to one vault. | `sync::a_folder_belongs_to_one_vault` |

## Interface

| Id | Requirement | Checked by |
| --- | --- | --- |
| C-UI-01 | Every interface text has its English translation, and the dictionary has no unused entries. | `scripts/check-i18n.mjs` |
| C-DOC-01 | Every documentation page exists in English and in Italian. | `certify.mjs` |
