mod audio;
mod calendar;
mod commands;
mod db;
mod llm;
mod models;
mod prompts;
mod secrets;
mod transcribe;

use commands::AppState;
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let models_dir = data_dir.join("models");
            std::fs::create_dir_all(&models_dir)?;
            let db = db::Db::open(&data_dir.join("granello.sqlite"))?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                data_dir,
                models_dir,
                transcribers: Arc::new(Default::default()),
                session: Mutex::new(None),
                calendar: tokio::sync::Mutex::new(Default::default()),
                downloading: Mutex::new(Default::default()),
            });
            spawn_calendar_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_meetings,
            commands::get_meeting,
            commands::create_meeting,
            commands::update_meeting,
            commands::delete_meeting,
            commands::list_audio_devices,
            commands::start_recording,
            commands::stop_recording,
            commands::recording_status,
            commands::enhance_notes,
            commands::get_chat,
            commands::clear_chat,
            commands::chat,
            commands::list_templates,
            commands::save_template,
            commands::delete_template,
            commands::get_settings,
            commands::save_settings,
            commands::has_api_key,
            commands::set_api_key,
            commands::list_whisper_models,
            commands::download_whisper_model,
            commands::upcoming_events,
        ])
        .run(tauri::generate_context!())
        .expect("errore nell'avvio di Granello");
}

/// Ogni 30s: aggiorna il calendario (cache 10 min) e notifica i meeting in partenza.
fn spawn_calendar_watcher(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<AppState>();
            if let Ok(true) = commands::refresh_calendar(&state, false).await {
                let _ = app.emit("calendar-updated", ());
            }
            let before_min = state
                .db
                .lock()
                .get_settings()
                .map(|s| s.notify_before_min)
                .unwrap_or(1);
            let now = chrono::Utc::now().timestamp_millis();
            let events = commands::current_events(&state).await;
            let mut cal = state.calendar.lock().await;
            for e in events {
                let until = e.start - now;
                if until <= before_min * 60_000 && until > -60_000 && cal.notified.insert(e.id.clone()) {
                    let _ = app
                        .notification()
                        .builder()
                        .title(format!("Sta per iniziare: {}", e.title))
                        .body("Apri Granello e premi Registra per prendere le note.")
                        .show();
                    let _ = app.emit("meeting-starting", e);
                }
            }
            drop(cal);
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
