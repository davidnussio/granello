// prima degli altri moduli: definisce le macro trf!/tra! che usano
#[macro_use]
mod i18n;

mod attachments;
mod audio;
mod calendar;
mod commands;
mod db;
mod decode;
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

/// Tempo massimo concesso alla chiusura per finire di trascrivere l'audio in coda.
const QUIT_DRAIN_TIMEOUT: Duration = Duration::from_secs(120);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // deve essere il primo plugin: una seconda istanza aprirebbe lo stesso database
        // e contenderebbe il microfono
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let models_dir = data_dir.join("models");
            std::fs::create_dir_all(&models_dir)?;
            let db = db::Db::open(&data_dir.join("granello.sqlite"))?;
            match db.recover_interrupted() {
                Ok(0) => {}
                Ok(n) => log::warn!("{n} meeting erano rimasti in registrazione: chiusi e reindicizzati"),
                Err(e) => log::error!("recupero dei meeting interrotti: {e}"),
            }
            // lingua dell'interfaccia: dalle impostazioni, altrimenti quella del sistema
            let ui_language = db.get_settings().map(|s| s.ui_language).unwrap_or_default();
            i18n::set(i18n::resolve(&ui_language));
            db.seed_templates()?;
            log::info!("Granello {} avviato (lingua {:?})", env!("CARGO_PKG_VERSION"), i18n::lang());
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                data_dir,
                models_dir,
                transcribers: Arc::new(Default::default()),
                session: Mutex::new(None),
                dictation: Mutex::new(None),
                calendar: tokio::sync::Mutex::new(Default::default()),
                downloading: Mutex::new(Default::default()),
                http: commands::http_client(Duration::from_secs(120)),
                llm_http: commands::http_client(Duration::from_secs(600)),
                streams: Mutex::new(Default::default()),
            });
            spawn_calendar_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_meetings,
            commands::get_meeting,
            commands::create_meeting,
            commands::update_meeting,
            commands::update_meeting_meta,
            commands::delete_meeting,
            commands::list_tags,
            commands::list_people,
            commands::delete_person,
            commands::suggest_people,
            commands::calendar_match,
            commands::list_audio_devices,
            commands::start_recording,
            commands::stop_recording,
            commands::import_audio,
            commands::set_system_device,
            commands::recording_status,
            commands::recording_position,
            commands::enhance_notes,
            commands::fill_moments,
            commands::ai_assist,
            commands::dictation_start,
            commands::dictation_stop,
            commands::cancel_stream,
            commands::get_chat,
            commands::clear_chat,
            commands::chat,
            commands::list_templates,
            commands::save_template,
            commands::delete_template,
            commands::get_settings,
            commands::save_settings,
            commands::app_info,
            commands::log_frontend_error,
            commands::has_api_key,
            commands::ai_ready,
            commands::list_provider_models,
            commands::set_api_key,
            commands::list_whisper_models,
            commands::download_whisper_model,
            commands::delete_whisper_model,
            commands::upcoming_events,
            commands::set_calendar_enabled,
            commands::save_attachment,
            commands::pick_attachment,
            commands::read_attachment,
            commands::open_attachment,
            commands::link_title,
        ])
        .build(tauri::generate_context!())
        .expect("errore nell'avvio di Granello");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            finish_recording_before_exit(app);
        }
    });
}

/// Se si esce a registrazione in corso, ferma la cattura e finisce di trascrivere
/// quello che è già stato registrato, così il meeting non perde la coda.
fn finish_recording_before_exit(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    let Some(session) = state.session.lock().take() else { return };
    let id = session.meeting_id.clone();
    log::info!("uscita con registrazione in corso ({id}): completo la trascrizione");
    if !session.finish(QUIT_DRAIN_TIMEOUT) {
        log::warn!("trascrizione di {id} non completata entro il tempo limite");
        // il thread di trascrizione non ha potuto chiudere il meeting: lo si fa qui
        if let Err(e) = state.db.lock().mark_ended(&id) {
            log::error!("chiusura meeting {id}: {e}");
        }
    }
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
                        .title(trf!("Sta per iniziare: {}", "Starting soon: {}", e.title))
                        .body(i18n::tr(
                            "Apri Granello e premi Registra per prendere le note.",
                            "Open Granello and press Record to take notes.",
                        ))
                        .show();
                    let _ = app.emit("meeting-starting", e);
                }
            }
            drop(cal);
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
