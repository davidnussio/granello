//! I file della Libreria e gli import da altre app (Impostazioni → Importa da).

use crate::commands::{err, AppState, CmdResult};
use crate::i18n::tr;
use crate::models::{ImportRecord, LooseFile};
use crate::{attachments, obsidian};
use serde::Serialize;
use tauri::{AppHandle, State};

/// Un file della Libreria che non è una registrazione: un allegato di una nota, o un file
/// arrivato senza nota.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    /// L'id del file senza nota, o `nota:percorso` per un allegato.
    pub id: String,
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub meeting_id: Option<String>,
    pub meeting_title: Option<String>,
    /// La cartella da cui veniva un file senza nota.
    pub folder: Option<String>,
    pub at: i64,
    /// Il file non c'è più nella cartella degli allegati.
    pub missing: bool,
}

/// Gli allegati delle note e i file senza nota, dal più recente.
#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> CmdResult<Vec<LibraryFile>> {
    let (notes, loose) = {
        let db = state.db.lock();
        (db.notes_for_files().map_err(err)?, db.loose_files().map_err(err)?)
    };
    let dir = state.vault_dir();
    tokio::task::spawn_blocking(move || {
        let size = |path: &str| attachments::resolve(&dir, path).ok().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
        let mut out = Vec::new();
        for (id, title, at, text) in notes {
            for (path, name) in attachments::labeled(&text) {
                let bytes = size(&path);
                out.push(LibraryFile {
                    id: format!("{id}:{path}"),
                    bytes: bytes.unwrap_or(0),
                    missing: bytes.is_none(),
                    path,
                    name,
                    meeting_id: Some(id.clone()),
                    meeting_title: Some(title.clone()),
                    folder: None,
                    at,
                });
            }
        }
        for LooseFile { id, path, name, bytes, folder, created_at } in loose {
            out.push(LibraryFile {
                id,
                missing: size(&path).is_none(),
                path,
                name,
                bytes: bytes.max(0) as u64,
                meeting_id: None,
                meeting_title: None,
                folder: Some(folder),
                at: created_at,
            });
        }
        out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.name.cmp(&b.name)));
        out
    })
    .await
    .map_err(err)
}

/// Elimina un file senza nota. Gli allegati di una nota si tolgono dalla nota.
#[tauri::command]
pub fn delete_file(state: State<AppState>, id: String) -> CmdResult<()> {
    let db = state.db.lock();
    if let Some(path) = db.delete_file(&id).map_err(err)? {
        if !db.attachment_in_use(&path).unwrap_or(true) {
            attachments::remove(&state.vault_dir(), &path);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_import_dir(app: AppHandle) -> CmdResult<Option<String>> {
    crate::commands::pick_folder(&app, tr("Cartella del vault Obsidian", "Obsidian vault folder")).await
}

/// Cosa importerebbe quella cartella, senza copiare né scrivere niente.
#[tauri::command]
pub async fn scan_obsidian(state: State<'_, AppState>, dir: String) -> CmdResult<obsidian::Summary> {
    let already = state.db.lock().already_imported(&dir).map_err(err)?;
    tokio::task::spawn_blocking(move || obsidian::prepare(std::path::Path::new(&dir), &already, None))
        .await
        .map_err(err)?
        .map(|p| p.summary)
        .map_err(err)
}

/// Importa un vault Obsidian nel vault aperto. La cartella viene solo letta.
#[tauri::command]
pub async fn import_obsidian(state: State<'_, AppState>, dir: String) -> CmdResult<ImportRecord> {
    if state.session.lock().is_some() {
        return Err(tr("Ferma la registrazione prima di importare", "Stop the recording before importing").into());
    }
    let already = state.db.lock().already_imported(&dir).map_err(err)?;
    let data_dir = state.vault_dir();
    let root = dir.clone();
    let prepared = tokio::task::spawn_blocking(move || obsidian::prepare(std::path::Path::new(&root), &already, Some(&data_dir)))
        .await
        .map_err(err)?
        .map_err(err)?;
    if prepared.notes.is_empty() && prepared.files.is_empty() {
        return Err(tr("Non c'è niente di nuovo da importare in questa cartella.", "There is nothing new to import in this folder.").into());
    }
    let report = serde_json::to_value(&prepared.summary).map_err(err)?;
    let privacy = state.vault.read().min_privacy;
    let saved = state.db.lock().save_import("obsidian", &dir, &prepared.notes, &prepared.files, privacy, &report);
    match saved {
        Ok(record) => {
            let (count, loose) = (record.notes, record.files);
            log::info!("import obsidian: {count} note, {loose} file senza nota");
            Ok(record)
        }
        Err(e) => {
            // niente nel database: i file copiati non servono a nessuno
            for path in &prepared.copied {
                attachments::remove(&state.vault_dir(), path);
            }
            Err(err(e))
        }
    }
}

#[tauri::command]
pub fn list_imports(state: State<AppState>) -> CmdResult<Vec<ImportRecord>> {
    state.db.lock().list_imports().map_err(err)
}

/// Annulla un import: le sue note, i suoi file e i progetti che aveva creato. Ritorna quante
/// note ha tolto.
#[tauri::command]
pub fn undo_import(state: State<AppState>, id: String) -> CmdResult<usize> {
    let db = state.db.lock();
    let (notes, files) = db.undo_import(&id).map_err(err)?;
    let dir = state.vault_dir();
    let mut paths: Vec<String> = files;
    for text in &notes {
        paths.extend(attachments::referenced(text));
    }
    paths.sort();
    paths.dedup();
    for path in paths {
        if !db.attachment_in_use(&path).unwrap_or(true) {
            attachments::remove(&dir, &path);
        }
    }
    Ok(notes.len())
}
