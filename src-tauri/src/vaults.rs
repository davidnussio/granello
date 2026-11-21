//! Vault: cartelle scelte dall'utente, ognuna con il suo database, i suoi allegati e le sue
//! registrazioni. I meeting di un vault esistono solo lì: su un disco cifrato o esterno, per
//! esempio. Se ne apre uno alla volta, e ciò che l'app mostra è il contenuto di quello aperto.
//!
//! Il vault principale è la cartella dei dati dell'app e c'è sempre. L'elenco degli altri sta
//! nel database principale, insieme alle impostazioni: sono preferenze di questo computer, non
//! contenuto di un vault.

use crate::commands::{err, AppState, CmdResult};
use crate::db::Db;
use crate::i18n::tr;
use crate::models::Privacy;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

pub const MAIN_ID: &str = "main";
const DB_FILE: &str = "granello.sqlite";
/// Chiave dell'elenco nella tabella delle impostazioni del database principale.
const KEY: &str = "vaults";

/// Il vault aperto in questo momento.
#[derive(Debug, Clone)]
pub struct Open {
    pub id: String,
    pub dir: PathBuf,
    /// I meeting del vault non scendono sotto questo livello di privacy.
    pub min_privacy: Privacy,
}

/// Un vault aggiunto dall'utente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vault {
    id: String,
    name: String,
    path: String,
    #[serde(default)]
    min_privacy: Privacy,
}

/// Quello che si salva: i vault aggiunti, quale è aperto e la privacy minima del principale.
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Registry {
    vaults: Vec<Vault>,
    /// Vuoto = il vault principale.
    active: String,
    main_min_privacy: Privacy,
}

impl Registry {
    fn load(main: &Db) -> Registry {
        main.setting(KEY).ok().flatten().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
    }

    fn save(&self, main: &Db) -> CmdResult<()> {
        main.set_setting(KEY, &serde_json::to_string(self).map_err(err)?).map_err(err)
    }

    /// Aggiunge un vault dopo aver controllato nome e cartella. Non tocca il disco.
    fn add(&mut self, main_dir: &Path, name: &str, path: &str, min_privacy: Privacy) -> CmdResult<Vault> {
        let name = clean_name(name)?;
        let path = path.trim();
        let dir = Path::new(path);
        if path.is_empty() || !dir.is_absolute() {
            return Err(tr("Scegli la cartella del vault", "Choose the vault's folder").into());
        }
        if same_dir(dir, main_dir) {
            return Err(tr(
                "Quella è la cartella del vault principale. Scegline un'altra.",
                "That is the main vault's folder. Choose another one.",
            )
            .into());
        }
        if let Some(other) = self.vaults.iter().find(|v| same_dir(Path::new(&v.path), dir)) {
            return Err(crate::trf!(
                "Quella cartella è già il vault «{}». Scegline un'altra.",
                "That folder is already the vault \"{}\". Choose another one.",
                other.name
            ));
        }
        if self.vaults.iter().any(|v| v.name.eq_ignore_ascii_case(&name)) {
            return Err(crate::trf!(
                "Esiste già un vault con il nome «{}». Scegline un altro.",
                "A vault named \"{}\" already exists. Choose another name.",
                name
            ));
        }
        let vault = Vault { id: uuid::Uuid::new_v4().to_string(), name, path: path.to_string(), min_privacy };
        self.vaults.push(vault.clone());
        Ok(vault)
    }
}

fn clean_name(name: &str) -> CmdResult<String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect();
    if name.is_empty() {
        return Err(tr("Dai un nome al vault", "Give the vault a name").into());
    }
    Ok(name)
}

/// La stessa cartella, anche se scritta in due modi (link simbolici, barra finale).
fn same_dir(a: &Path, b: &Path) -> bool {
    let real = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.components().collect());
    real(a) == real(b)
}

/// Apre (o crea) il database di un vault e chiude i meeting rimasti in registrazione.
fn open_db(dir: &Path) -> CmdResult<Db> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let db = Db::open(&dir.join(DB_FILE)).map_err(err)?;
    if let Err(e) = db.recover_interrupted() {
        log::error!("recupero dei meeting interrotti del vault: {e}");
    }
    Ok(db)
}

/// Porta i meeting al livello minimo del vault e cancella l'audio che quelli alzati avevano
/// conservato per la trascrizione online: con un livello di privacy non deve più poter uscire.
fn enforce(db: &Db, dir: &Path, min: Privacy) -> CmdResult<()> {
    for id in db.raise_privacy(min).map_err(err)? {
        crate::keep::remove(dir, &id);
    }
    Ok(())
}

/// All'avvio: il database e la cartella del vault che era aperto. Se non c'è più (disco
/// scollegato, cartella spostata) si riparte dal principale, senza toccare l'elenco.
pub fn startup(main: &Db, main_dir: &Path) -> anyhow::Result<(Db, Open)> {
    let registry = Registry::load(main);
    if let Some(vault) = registry.vaults.iter().find(|v| v.id == registry.active) {
        let dir = PathBuf::from(&vault.path);
        // solo se la cartella esiste: crearla al posto di un disco scollegato darebbe un vault vuoto
        if dir.join(DB_FILE).is_file() {
            match open_db(&dir).and_then(|db| enforce(&db, &dir, vault.min_privacy).map(|()| db)) {
                Ok(db) => return Ok((db, Open { id: vault.id.clone(), dir, min_privacy: vault.min_privacy })),
                Err(e) => log::error!("il vault aperto l'ultima volta non si apre: {e}"),
            }
        } else {
            log::warn!("il vault aperto l'ultima volta non è disponibile: si apre il principale");
        }
    }
    // seconda connessione allo stesso file del database principale
    let db = Db::open(&main_dir.join(DB_FILE))?;
    enforce(&db, main_dir, registry.main_min_privacy).map_err(anyhow::Error::msg)?;
    Ok((db, Open { id: MAIN_ID.into(), dir: main_dir.to_path_buf(), min_privacy: registry.main_min_privacy }))
}

/// Un vault come lo vede l'interfaccia.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    id: String,
    name: String,
    path: String,
    min_privacy: Privacy,
    /// Il vault principale: c'è sempre, non si rinomina e non si toglie.
    main: bool,
    /// È quello aperto.
    active: bool,
    /// La sua cartella è raggiungibile (un disco esterno può non essere collegato).
    available: bool,
}

fn infos(state: &AppState, registry: &Registry) -> Vec<VaultInfo> {
    let open = state.vault.read().id.clone();
    let main = VaultInfo {
        id: MAIN_ID.into(),
        name: tr("Principale", "Main").into(),
        path: state.data_dir.display().to_string(),
        min_privacy: registry.main_min_privacy,
        main: true,
        active: open == MAIN_ID,
        available: true,
    };
    let others = registry.vaults.iter().map(|v| VaultInfo {
        id: v.id.clone(),
        name: v.name.clone(),
        path: v.path.clone(),
        min_privacy: v.min_privacy,
        main: false,
        active: open == v.id,
        available: Path::new(&v.path).join(DB_FILE).is_file(),
    });
    std::iter::once(main).chain(others).collect()
}

#[tauri::command]
pub fn list_vaults(state: State<AppState>) -> CmdResult<Vec<VaultInfo>> {
    Ok(infos(&state, &Registry::load(&state.main.lock())))
}

/// Fa scegliere la cartella di un vault. `None` se la scelta viene annullata.
#[tauri::command]
pub async fn pick_vault_dir(app: AppHandle) -> CmdResult<Option<String>> {
    crate::commands::pick_folder(&app, tr("Cartella del vault", "Vault folder")).await
}

/// Aggiunge un vault in una cartella: se contiene già un vault di Granello lo ritrova con i
/// suoi meeting, altrimenti ne crea uno vuoto. Non lo apre.
#[tauri::command]
pub fn create_vault(
    state: State<AppState>,
    name: String,
    path: String,
    min_privacy: Privacy,
) -> CmdResult<Vec<VaultInfo>> {
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    let vault = registry.add(&state.data_dir, &name, &path, min_privacy)?;
    let dir = PathBuf::from(&vault.path);
    let db = open_db(&dir).map_err(|e| {
        crate::trf!(
            "Non riesco a creare il vault in quella cartella: {}. Scegline una in cui puoi scrivere.",
            "Could not create the vault in that folder: {}. Choose one you can write to.",
            e
        )
    })?;
    enforce(&db, &dir, min_privacy)?;
    registry.save(&main)?;
    log::info!("vault aggiunto (privacy minima {})", min_privacy.as_str());
    Ok(infos(&state, &registry))
}

/// Cambia nome e privacy minima di un vault. Del principale cambia solo la privacy minima.
/// Alzare il minimo alza subito i meeting del vault che stavano sotto.
#[tauri::command]
pub fn update_vault(state: State<AppState>, id: String, name: String, min_privacy: Privacy) -> CmdResult<Vec<VaultInfo>> {
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    let dir = if id == MAIN_ID {
        registry.main_min_privacy = min_privacy;
        state.data_dir.clone()
    } else {
        let name = clean_name(&name)?;
        if registry.vaults.iter().any(|v| v.id != id && v.name.eq_ignore_ascii_case(&name)) {
            return Err(crate::trf!(
                "Esiste già un vault con il nome «{}». Scegline un altro.",
                "A vault named \"{}\" already exists. Choose another name.",
                name
            ));
        }
        let vault =
            registry.vaults.iter_mut().find(|v| v.id == id).ok_or(tr("Vault non trovato", "Vault not found"))?;
        vault.name = name;
        vault.min_privacy = min_privacy;
        PathBuf::from(&vault.path)
    };
    registry.save(&main)?;
    if state.vault.read().id == id {
        state.vault.write().min_privacy = min_privacy;
        enforce(&state.db.lock(), &dir, min_privacy)?;
    } else if dir.join(DB_FILE).is_file() {
        // un vault non disponibile si mette in regola quando lo si riapre
        enforce(&open_db(&dir)?, &dir, min_privacy)?;
    }
    Ok(infos(&state, &registry))
}

/// Toglie un vault dall'elenco. La cartella e i suoi dati restano dove sono: si può
/// riaggiungere scegliendo la stessa cartella.
#[tauri::command]
pub fn remove_vault(state: State<AppState>, id: String) -> CmdResult<Vec<VaultInfo>> {
    if id == MAIN_ID {
        return Err(tr("Il vault principale non si può togliere", "The main vault cannot be removed").into());
    }
    if state.vault.read().id == id {
        return Err(tr(
            "Questo vault è aperto: apri un altro vault prima di toglierlo.",
            "This vault is open: open another vault before removing it.",
        )
        .into());
    }
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    registry.vaults.retain(|v| v.id != id);
    registry.save(&main)?;
    Ok(infos(&state, &registry))
}

/// Apre un vault: da qui in poi l'app mostra i suoi meeting.
#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<Vec<VaultInfo>> {
    if state.busy() {
        return Err(tr(
            "C'è una registrazione o una generazione in corso: aspetta che finisca prima di cambiare vault.",
            "A recording or a generation is in progress: wait for it to finish before switching vault.",
        )
        .into());
    }
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    let open = if id == MAIN_ID {
        Open { id: MAIN_ID.into(), dir: state.data_dir.clone(), min_privacy: registry.main_min_privacy }
    } else {
        let vault = registry.vaults.iter().find(|v| v.id == id).ok_or(tr("Vault non trovato", "Vault not found"))?;
        let dir = PathBuf::from(&vault.path);
        if !dir.join(DB_FILE).is_file() {
            return Err(tr(
                "La cartella di questo vault non è raggiungibile. Collega il disco su cui si trova e riprova.",
                "This vault's folder cannot be reached. Connect the disk it is on and try again.",
            )
            .into());
        }
        Open { id: vault.id.clone(), dir, min_privacy: vault.min_privacy }
    };
    let db = open_db(&open.dir)?;
    enforce(&db, &open.dir, open.min_privacy)?;
    registry.active = if id == MAIN_ID { String::new() } else { id };
    registry.save(&main)?;
    let settings = main.get_settings().map_err(err)?;
    drop(main);
    *state.db.lock() = db;
    *state.vault.write() = open;
    crate::commands::allow_recordings_dir(&app, &state.vault_dir(), state.chosen_recordings(&settings));
    log::info!("vault aperto");
    Ok(infos(&state, &registry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_checks_names_and_folders() {
        let main_dir = Path::new("/dati/granello");
        let mut registry = Registry::default();
        let first = registry.add(main_dir, "  Clienti   riservati ", "/Volumes/Cifrato/granello", Privacy::Hardened).unwrap();
        assert_eq!((first.name.as_str(), first.min_privacy), ("Clienti riservati", Privacy::Hardened));

        // senza nome, senza cartella, con una cartella relativa
        assert!(registry.add(main_dir, " ", "/altro", Privacy::Open).is_err());
        assert!(registry.add(main_dir, "Altro", "", Privacy::Open).is_err());
        assert!(registry.add(main_dir, "Altro", "relativa/cartella", Privacy::Open).is_err());
        // la cartella del principale o di un altro vault, e un nome già usato
        assert!(registry.add(main_dir, "Altro", "/dati/granello/", Privacy::Open).is_err());
        assert!(registry.add(main_dir, "Altro", "/Volumes/Cifrato/granello", Privacy::Open).is_err());
        assert!(registry.add(main_dir, "clienti riservati", "/altro", Privacy::Open).is_err());
        assert_eq!(registry.vaults.len(), 1);

        // l'elenco torna uguale dopo essere stato salvato e riletto
        let db = Db::open_in_memory().unwrap();
        assert_eq!(Registry::load(&db), Registry::default());
        registry.active = first.id.clone();
        registry.main_min_privacy = Privacy::Audio;
        registry.save(&db).unwrap();
        assert_eq!(Registry::load(&db), registry);
    }

    #[test]
    fn a_vault_keeps_its_own_meetings_and_minimum_privacy() {
        let root = std::env::temp_dir().join(format!("granello-vault-{}", uuid::Uuid::new_v4()));
        let (main_dir, vault_dir) = (root.join("app"), root.join("riservato"));
        std::fs::create_dir_all(&main_dir).unwrap();
        let main = Db::open(&main_dir.join(DB_FILE)).unwrap();

        // senza vault aggiunti si apre il principale
        let (db, open) = startup(&main, &main_dir).unwrap();
        assert_eq!((open.id.as_str(), open.min_privacy), (MAIN_ID, Privacy::Open));
        db.create_meeting("Nel principale", None, &[], None).unwrap();
        drop(db);

        // un vault blindato: i meeting che ci sono già vengono alzati quando lo si apre
        let mut registry = Registry::load(&main);
        let vault = registry.add(&main_dir, "Riservato", vault_dir.to_str().unwrap(), Privacy::Hardened).unwrap();
        let inside = open_db(&vault_dir).unwrap();
        let meeting = inside.create_meeting("Nel vault", None, &[], None).unwrap();
        drop(inside);
        registry.active = vault.id.clone();
        registry.save(&main).unwrap();

        let (db, open) = startup(&main, &main_dir).unwrap();
        assert_eq!((open.id.as_str(), open.dir.as_path()), (vault.id.as_str(), vault_dir.as_path()));
        let listed = db.list_meetings(None).unwrap();
        assert_eq!(listed.len(), 1, "il vault mostra solo i suoi meeting");
        assert_eq!(db.get_meeting(&meeting.id).unwrap().unwrap().privacy, Privacy::Hardened);
        drop(db);

        // se la cartella non c'è più si riparte dal principale, e il vault resta in elenco
        std::fs::remove_dir_all(&vault_dir).unwrap();
        let (db, open) = startup(&main, &main_dir).unwrap();
        assert_eq!(open.id, MAIN_ID);
        assert_eq!(db.list_meetings(None).unwrap()[0].title, "Nel principale");
        assert_eq!(Registry::load(&main).vaults.len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }
}
