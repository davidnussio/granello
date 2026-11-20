//! Aggiornamenti automatici. All'avvio controlla se su GitHub c'è una release
//! pubblicata più recente; se c'è, chiede prima di scaricarla e installarla e
//! riavvia l'app solo se non sta registrando. Le release in bozza non contano:
//! l'endpoint `releases/latest` vede solo quelle pubblicate.

use crate::commands::AppState;
use crate::i18n::tr;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// Avvia il controllo in sottofondo. Le build di sviluppo non si aggiornano.
pub fn spawn_check(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check(&app).await {
            log::warn!("controllo degli aggiornamenti: {e}");
        }
    });
}

async fn check(app: &AppHandle) -> anyhow::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    log::info!("aggiornamento disponibile: {} -> {}", update.current_version, update.version);

    let install = ask(
        app,
        tr("Aggiornamento disponibile", "Update available"),
        trf!(
            "È disponibile Granello {}. Vuoi installarlo adesso? L'app si riavvia alla fine, se non stai registrando.",
            "Granello {} is available. Install it now? The app restarts when it is done, unless you are recording.",
            update.version
        ),
        tr("Installa", "Install"),
        tr("Più tardi", "Later"),
    )
    .await;
    if !install {
        return Ok(());
    }

    update.download_and_install(|_, _| {}, || {}).await?;
    log::info!("aggiornamento {} installato", update.version);

    if is_recording(app) {
        // la nuova versione parte alla prossima apertura dell'app
        app.dialog()
            .message(tr(
                "Aggiornamento installato. Granello userà la nuova versione dalla prossima apertura.",
                "Update installed. Granello will use the new version the next time you open it.",
            ))
            .kind(MessageDialogKind::Info)
            .show(|_| {});
        return Ok(());
    }
    app.restart();
}

fn is_recording(app: &AppHandle) -> bool {
    app.state::<AppState>().session.lock().is_some()
}

async fn ask(app: &AppHandle, title: &str, message: String, ok: &str, cancel: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(ok.to_string(), cancel.to_string()))
        .show(move |answer| {
            let _ = tx.send(answer);
        });
    rx.await.unwrap_or(false)
}
