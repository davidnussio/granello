//! Certificazione: i requisiti che ogni versione deve rispettare prima di essere rilasciata.
//! L'elenco completo, con i controlli sulla configurazione e i test che stanno negli altri
//! moduli, è in `CERTIFICATION.md`. Qui ci sono i test che attraversano più moduli e
//! lavorano su uno stato dell'app vero, con database su disco.
//!
//! Ogni test porta l'id del requisito: un test che fallisce blocca il rilascio.

use crate::commands::{local_only, resolve_model_for, AppState};
use crate::db::{Db, MIGRATIONS};
use crate::models::{Calendar, ModelRef, Privacy, Provider, ProviderKind};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Una cartella temporanea che sparisce alla fine del test.
pub(crate) struct Temp(pub(crate) PathBuf);

impl Temp {
    pub(crate) fn new(name: &str) -> Temp {
        let dir = std::env::temp_dir().join(format!("granello-cert-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Temp(dir)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Lo stato dell'app come lo costruisce `lib.rs`, con la cartella dei dati in `dir`.
pub(crate) fn app_state(dir: &Path) -> AppState {
    let main = Db::open(&dir.join("granello.sqlite")).unwrap();
    let (vault_db, vault) = crate::vaults::startup(&main, dir).unwrap();
    AppState {
        db: Arc::new(Mutex::new(vault_db)),
        main: Arc::new(Mutex::new(main)),
        vault: parking_lot::RwLock::new(vault),
        data_dir: dir.to_path_buf(),
        models_dir: dir.join("models"),
        transcribers: Arc::new(Default::default()),
        session: Mutex::new(None),
        dictation: Mutex::new(None),
        calendar: tokio::sync::Mutex::new(Default::default()),
        downloading: Mutex::new(Default::default()),
        http: crate::commands::http_client(Duration::from_secs(5)),
        llm_http: crate::commands::http_client(Duration::from_secs(5)),
        streams: Mutex::new(Default::default()),
        working: Arc::new(Default::default()),
    }
}

fn provider(id: &str, base_url: &str) -> Provider {
    Provider { id: id.into(), name: id.into(), kind: ProviderKind::Openai, base_url: base_url.into(), context_tokens: None }
}

// ---------------- privacy ----------------

/// C-PRIV-01: un meeting blindato, o con parti ancora da verificare, non arriva mai a un
/// modello online. Se c'è un modello locale configurato si usa quello, altrimenti la
/// funzione non è disponibile.
#[test]
fn c_priv_01_protected_meetings_never_reach_an_online_model() {
    let temp = Temp::new("priv");
    let state = app_state(&temp.0);
    let online = provider("online", "https://api.example.com/v1");
    let local = provider("local", "http://localhost:1234/v1");
    for p in [&online, &local] {
        // niente Portachiavi nei test: la chiave vuota segna il provider come già guardato
        crate::secrets::set_api_key(&temp.0, &p.id, "").unwrap();
    }
    let mut settings = state.main.lock().get_settings().unwrap();
    settings.providers = vec![online.clone()];
    settings.notes_model = ModelRef { provider_id: online.id.clone(), model: "grande".into() };
    settings.chat_model = settings.notes_model.clone();

    let db = state.db.lock();
    let open = db.create_meeting("Aperto", None, &[], None).unwrap();
    let hardened = db.create_meeting("Blindato", None, &[], None).unwrap();
    db.set_privacy(&hardened.id, Privacy::Hardened).unwrap();
    let reviewed = db.create_meeting("Da verificare", None, &[], None).unwrap();
    let part = db.add_segment(&reviewed.id, "them", 0, 1000, "una frase da verificare").unwrap();
    db.set_review(&reviewed.id, &[part.id], true).unwrap();

    let model_for = |settings: &crate::models::Settings, id: &str| {
        let meeting = db.get_meeting(id).unwrap().unwrap();
        resolve_model_for(&state, settings, &settings.notes_model, local_only(&db, &meeting).unwrap())
    };
    // solo un modello online: il meeting aperto lo usa, gli altri no
    assert_eq!(model_for(&settings, &open.id).unwrap().provider.id, "online");
    for id in [&hardened.id, &reviewed.id] {
        assert!(model_for(&settings, id).is_err(), "un meeting protetto è arrivato a un modello online");
    }
    // con un modello locale configurato, i meeting protetti vanno a quello
    settings.providers.push(local.clone());
    settings.chat_model = ModelRef { provider_id: local.id.clone(), model: "piccolo".into() };
    for id in [&hardened.id, &reviewed.id] {
        assert_eq!(model_for(&settings, id).unwrap().provider.id, "local");
    }
    // finita la verifica, il meeting torna libero
    db.set_review(&reviewed.id, &[part.id], false).unwrap();
    assert_eq!(model_for(&settings, &reviewed.id).unwrap().provider.id, "online");
}

/// Raccoglie tutto quello che l'app scrive nei log durante i test.
struct Capture;

static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        LINES.lock().push(record.args().to_string());
    }
    fn flush(&self) {}
}

fn capture_logs() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    static CAPTURE: Capture = Capture;
    ONCE.call_once(|| {
        log::set_logger(&CAPTURE).expect("un solo logger nei test");
        log::set_max_level(log::LevelFilter::Trace);
    });
}

/// C-PRIV-02: i log non contengono mai note, trascrizioni, titoli, API key o indirizzi dei
/// calendari, neanche quando qualcosa va storto.
#[test]
fn c_priv_02_logs_never_contain_content_keys_or_calendar_urls() {
    capture_logs();
    const SECRET: &str = "Cert7f3aSegreto";
    let temp = Temp::new("logs");
    let state = app_state(&temp.0);

    // contenuto di un meeting: titolo, note, trascrizione, parti oscurate
    {
        let db = state.db.lock();
        let m = db.create_meeting(&format!("Titolo {SECRET}"), None, &[format!("Persona {SECRET}")], None).unwrap();
        db.update_meeting(&m.id, None, Some(&format!("Nota {SECRET}")), Some(&format!("AI {SECRET}")), None).unwrap();
        let s = db.add_segment(&m.id, "them", 0, 1000, &format!("Detto {SECRET}")).unwrap();
        db.redact(&m.id, &[(s.id, Some((0, 5)))]).unwrap();
        db.set_privacy(&m.id, Privacy::Hardened).unwrap();
    }

    // una API key salvata
    crate::secrets::set_api_key(&temp.0, "cert", &format!("sk-{SECRET}")).unwrap();

    // un calendario che non risponde: l'indirizzo iCal è segreto
    let mut settings = state.main.lock().get_settings().unwrap();
    settings.calendars = vec![Calendar {
        id: "cal".into(),
        name: "Lavoro".into(),
        url: format!("http://127.0.0.1:9/{SECRET}.ics"),
        enabled: true,
    }];
    state.main.lock().save_settings(&settings).unwrap();
    let _ = tauri::async_runtime::block_on(crate::commands::refresh_calendar(&state, true));
    let cache = tauri::async_runtime::block_on(state.calendar.lock());
    let shown: Vec<String> = cache.feeds.iter().filter_map(|f| f.last_error.clone()).collect();
    drop(cache);
    assert!(!shown.is_empty(), "il calendario irraggiungibile doveva dare un errore");

    // il sync con un file rovinato da un altro Mac
    let sync_dir = temp.0.join("sync");
    std::fs::create_dir_all(&sync_dir).unwrap();
    crate::sync::enable(&state.db.lock(), &sync_dir).unwrap();
    crate::vaults::set_sync_dir(&state.main.lock(), crate::vaults::MAIN_ID, Some(sync_dir.display().to_string())).unwrap();
    let other = sync_dir.join("log").join("altro-mac");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(other.join("0000000001.jsonl"), format!("{{\"rotto\": \"{SECRET}\"\n")).unwrap();
    let sync_error = crate::sync::turn(&state).err().map(|e| e.to_string()).unwrap_or_default();

    // riaprire il vault: recupero e migrazioni scrivono nei log
    drop(state);
    let _ = app_state(&temp.0);

    let leaked: Vec<String> = LINES.lock().iter().filter(|l| l.contains(SECRET)).cloned().collect();
    assert!(leaked.is_empty(), "contenuto finito nei log: {leaked:?}");
    for message in shown.iter().chain([&sync_error]) {
        assert!(!message.contains(SECRET), "contenuto in un messaggio di errore: {message}");
    }
}

// ---------------- dati ----------------

/// C-DATA-01: un database creato da qualunque versione rilasciata si apre con questa e
/// arriva all'ultimo schema senza errori di integrità. Un database di una versione più
/// recente non si apre e resta com'è.
#[test]
fn c_data_01_every_schema_upgrades_and_newer_ones_are_left_alone() {
    let temp = Temp::new("schema");
    for version in 0..=MIGRATIONS.len() {
        let path = temp.0.join(format!("v{version}.sqlite"));
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..version] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", version).unwrap();
        }
        let db = Db::open(&path).unwrap_or_else(|e| panic!("lo schema {version} non si aggiorna: {e}"));
        let conn = db.conn();
        let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(current, MIGRATIONS.len(), "schema {version}");
        let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
        assert_eq!(integrity, "ok", "schema {version}");
        let broken: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(broken, 0, "schema {version}: chiavi esterne rotte");
        // e l'app ci lavora
        db.create_meeting("Dopo l'aggiornamento", None, &[], None).unwrap();
    }

    let newer = temp.0.join("futuro.sqlite");
    {
        let conn = rusqlite::Connection::open(&newer).unwrap();
        conn.pragma_update(None, "user_version", MIGRATIONS.len() + 1).unwrap();
    }
    let before = std::fs::read(&newer).unwrap();
    assert!(Db::open(&newer).is_err(), "un database più recente non va aperto");
    let conn = rusqlite::Connection::open(&newer).unwrap();
    let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, MIGRATIONS.len() + 1);
    let tables: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get(0)).unwrap();
    assert_eq!(tables, 0, "il database più recente è stato toccato");
    drop(conn);
    assert!(std::fs::read(&newer).unwrap().len() >= before.len());
}

// ---------------- vault ----------------

/// C-VAULT-01: un lavoro lungo tiene occupato il vault, e se il vault cambia lo stesso il
/// risultato non finisce nel database dell'altro.
#[test]
fn c_vault_01_a_long_job_never_writes_into_another_vault() {
    let temp = Temp::new("vault");
    let state = app_state(&temp.0);
    assert!(!state.busy());

    let work = state.work();
    assert!(state.busy(), "un lavoro in corso deve bloccare il cambio di vault");
    let meeting = work.db().unwrap().create_meeting("Nel principale", None, &[], None).unwrap();

    // il cambio come lo fa open_vault: database e vault insieme, sotto lo stesso lock
    let other_dir = temp.0.join("altro");
    std::fs::create_dir_all(&other_dir).unwrap();
    let other = Db::open(&other_dir.join("granello.sqlite")).unwrap();
    {
        let mut current = state.db.lock();
        *current = other;
        *state.vault.write() =
            crate::vaults::Open { id: "altro".into(), dir: other_dir.clone(), min_privacy: Privacy::Open, lock: None };
    }

    assert!(work.db().is_err(), "il lavoro ha scritto nel vault sbagliato");
    assert!(work.check().is_err());
    assert_eq!(work.dir, temp.0, "il lavoro usa la cartella del vault in cui è partito");
    drop(work);
    assert!(!state.busy(), "finito il lavoro il vault si cambia di nuovo");
    assert!(state.db.lock().get_meeting(&meeting.id).unwrap().is_none());

    // un lavoro che comincia nel nuovo vault ci scrive normalmente
    let work = state.work();
    work.db().unwrap().create_meeting("Nell'altro", None, &[], None).unwrap();
}
