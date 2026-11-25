//! Vault: cartelle scelte dall'utente, ognuna con il suo database, i suoi allegati e le sue
//! registrazioni. I meeting di un vault esistono solo lì: su un disco cifrato o esterno, per
//! esempio. Se ne apre uno alla volta, e ciò che l'app mostra è il contenuto di quello aperto.
//!
//! Il vault principale è la cartella dei dati dell'app e c'è sempre. L'elenco degli altri sta
//! nel database principale, insieme alle impostazioni: sono preferenze di questo computer, non
//! contenuto di un vault.
//!
//! Quello che deve seguire il vault da un computer all'altro sta invece nel vault stesso: la
//! sua identità e la privacy minima. E un vault si apre da un computer alla volta: chi lo apre
//! lascia nella cartella un file che dice chi lo sta usando.

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
/// Chiave, nel database di ogni vault, della sua identità e della sua privacy minima.
const META: &str = "vault";
/// Il file che dice quale computer ha il vault aperto.
const LOCK_FILE: &str = "granello.lock";

/// Il vault aperto in questo momento.
#[derive(Debug)]
pub struct Open {
    pub id: String,
    pub dir: PathBuf,
    /// I meeting del vault non scendono sotto questo livello di privacy.
    pub min_privacy: Privacy,
    /// Finché il vault è aperto qui, gli altri computer lo vedono occupato. Il principale non
    /// ne ha bisogno: sta nella cartella dell'app, e l'app gira una volta sola.
    pub lock: Option<Lock>,
}

/// Quello che un vault sa di sé, su qualunque computer venga aperto.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    id: String,
    #[serde(default)]
    min_privacy: Privacy,
}

impl Meta {
    fn read(db: &Db) -> Option<Meta> {
        db.setting(META).ok().flatten().and_then(|raw| serde_json::from_str(&raw).ok())
    }

    fn write(&self, db: &Db) -> CmdResult<()> {
        db.set_setting(META, &serde_json::to_string(self).map_err(err)?).map_err(err)
    }

    /// Quello che il vault sa di sé. Un vault nato prima che lo scrivesse lo impara adesso,
    /// dall'elenco di questo computer.
    fn ensure(db: &Db, id: &str, min_privacy: Privacy) -> CmdResult<Meta> {
        if let Some(meta) = Meta::read(db) {
            return Ok(meta);
        }
        let meta = Meta { id: id.to_string(), min_privacy };
        meta.write(db)?;
        Ok(meta)
    }
}

/// Un computer, come compare nel file di blocco di un vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Device {
    id: String,
    name: String,
}

impl Device {
    /// L'identità di questo computer: creata la prima volta, poi sempre la stessa. Il nome
    /// serve solo a dirlo a chi trova il vault occupato; due computer con lo stesso nome
    /// restano distinti.
    fn this(main: &Db) -> Device {
        // la stessa identità che il sync usa nel suo log
        let id = crate::sync::device_id(main).unwrap_or_else(|e| {
            log::error!("identità del computer non salvata: {e}");
            uuid::Uuid::new_v4().to_string()
        });
        Device { id, name: computer_name() }
    }
}

/// Il nome con cui l'utente conosce questo computer.
fn computer_name() -> String {
    static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        #[cfg(target_os = "macos")]
        let named = std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned());
        #[cfg(not(target_os = "macos"))]
        let named = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
        let name: String = named.unwrap_or_default().chars().filter(|c| !c.is_control()).take(80).collect();
        match name.trim() {
            "" => tr("un altro computer", "another computer").into(),
            name => name.to_string(),
        }
    })
    .clone()
}

/// Il vault è aperto da questo computer: il file nella sua cartella lo dice agli altri.
/// Lasciarlo cadere libera il vault.
#[derive(Debug)]
pub struct Lock {
    file: PathBuf,
    device: String,
}

impl Lock {
    /// Il computer che ha lasciato il file di blocco, se c'è e si legge.
    fn holder(dir: &Path) -> Option<Device> {
        serde_json::from_str(&std::fs::read_to_string(dir.join(LOCK_FILE)).ok()?).ok()
    }

    /// Un altro computer ha il vault aperto. Un file lasciato da questo computer non conta:
    /// l'app gira una volta sola, quindi è rimasto da una chiusura andata male.
    fn held_by_other(dir: &Path, me: &Device) -> Option<Device> {
        Lock::holder(dir).filter(|holder| holder.id != me.id)
    }

    /// Il messaggio per chi trova il vault occupato: cosa fare adesso.
    fn busy(holder: &Device) -> String {
        crate::trf!(
            "Questo vault risulta aperto su «{}». Chiudi Granello su quel computer e riprova. Se non lo sta più usando, vai in Impostazioni → Vault e scegli «Apri comunque».",
            "This vault appears to be open on \"{}\". Quit Granello on that computer and try again. If it is no longer using it, go to Settings → Vaults and choose \"Open anyway\".",
            holder.name
        )
    }

    /// Prende il vault per questo computer. Se lo ha un altro si ferma, a meno di `force`:
    /// serve quando l'altro computer non ha potuto liberarlo (spento di colpo, disco staccato).
    fn acquire(dir: &Path, me: &Device, force: bool) -> CmdResult<Lock> {
        if let Some(holder) = Lock::held_by_other(dir, me).filter(|_| !force) {
            return Err(Lock::busy(&holder));
        }
        let file = dir.join(LOCK_FILE);
        std::fs::write(&file, serde_json::to_string(me).map_err(err)?).map_err(|e| {
            crate::trf!(
                "Non riesco a scrivere nella cartella del vault: {}. Controlla di poterci scrivere e riprova.",
                "Could not write to the vault's folder: {}. Check that you can write to it and try again.",
                e
            )
        })?;
        Ok(Lock { file, device: me.id.clone() })
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        // solo se è ancora nostro: un altro computer può averlo preso con «Apri comunque»
        let ours = self.file.parent().and_then(Lock::holder).is_some_and(|holder| holder.id == self.device);
        if ours {
            let _ = std::fs::remove_file(&self.file);
        }
    }
}

/// Un vault aggiunto dall'utente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vault {
    id: String,
    name: String,
    path: String,
    /// Copia di quella scritta nel vault, per mostrarla anche quando non è raggiungibile.
    #[serde(default)]
    min_privacy: Privacy,
    /// La cartella in cui questo Mac sincronizza il vault (fase 0 del sync). Sta qui e non nel
    /// vault: lo stesso vault può essere in una cartella diversa su ogni Mac.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sync_dir: Option<String>,
    /// I calendari (configurati una volta nelle impostazioni) che questo vault non mostra.
    /// Si salvano quelli nascosti e non quelli mostrati: un calendario nuovo compare ovunque
    /// finché non lo si toglie da un vault, come prima che si potesse scegliere.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    hidden_calendars: Vec<String>,
}

/// Quello che si salva: i vault aggiunti e quale è aperto.
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Registry {
    vaults: Vec<Vault>,
    /// Vuoto = il vault principale.
    active: String,
    /// Solo per i database nati prima che la privacy minima stesse nel vault: il principale
    /// la impara da qui la prima volta.
    main_min_privacy: Privacy,
    #[serde(skip_serializing_if = "Option::is_none")]
    main_sync_dir: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    main_hidden_calendars: Vec<String>,
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
        let vault = Vault {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            path: path.to_string(),
            min_privacy,
            sync_dir: None,
            hidden_calendars: Vec::new(),
        };
        self.vaults.push(vault.clone());
        Ok(vault)
    }

    /// Dopo `add`, guardando dentro la cartella: un vault che esiste già porta con sé la sua
    /// identità e la sua privacy minima, che riaggiungerlo non può abbassare. Uno nuovo riceve
    /// quelle appena scelte.
    fn adopt(&mut self, db: &Db) -> CmdResult<Meta> {
        let added = self.vaults.pop().ok_or(tr("Vault non trovato", "Vault not found"))?;
        let meta = match Meta::read(db) {
            Some(found) => {
                if let Some(other) = self.vaults.iter().find(|v| v.id == found.id) {
                    return Err(crate::trf!(
                        "Questo vault è già in elenco come «{}», in un'altra cartella. Toglilo dall'elenco prima di aggiungerlo da qui.",
                        "This vault is already in the list as \"{}\", in another folder. Remove it from the list before adding it from here.",
                        other.name
                    ));
                }
                Meta { min_privacy: found.min_privacy.max(added.min_privacy), ..found }
            }
            None => Meta { id: added.id.clone(), min_privacy: added.min_privacy },
        };
        meta.write(db)?;
        self.vaults.push(Vault { id: meta.id.clone(), min_privacy: meta.min_privacy, ..added });
        Ok(meta)
    }

    /// Identità e privacy minima del vault principale: stanno nel suo database, come per ogni
    /// altro vault.
    fn main_meta(&self, main: &Db) -> CmdResult<Meta> {
        Meta::ensure(main, &uuid::Uuid::new_v4().to_string(), self.main_min_privacy)
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

/// La cartella in cui questo Mac sincronizza un vault, se il sync è attivo.
pub fn sync_dir(main: &Db, id: &str) -> Option<PathBuf> {
    let registry = Registry::load(main);
    let dir = if id == MAIN_ID {
        registry.main_sync_dir
    } else {
        registry.vaults.into_iter().find(|v| v.id == id).and_then(|v| v.sync_dir)
    };
    dir.map(PathBuf::from)
}

/// Attiva (`Some`) o spegne (`None`) il sync di un vault su questo Mac.
pub fn set_sync_dir(main: &Db, id: &str, dir: Option<String>) -> CmdResult<()> {
    let mut registry = Registry::load(main);
    if id == MAIN_ID {
        registry.main_sync_dir = dir;
    } else {
        let vault = registry.vaults.iter_mut().find(|v| v.id == id).ok_or(tr("Vault non trovato", "Vault not found"))?;
        vault.sync_dir = dir;
    }
    registry.save(main)
}

/// I calendari che un vault non mostra (né nella home né nelle notifiche).
pub fn hidden_calendars(main: &Db, id: &str) -> Vec<String> {
    let registry = Registry::load(main);
    if id == MAIN_ID {
        registry.main_hidden_calendars
    } else {
        registry.vaults.into_iter().find(|v| v.id == id).map(|v| v.hidden_calendars).unwrap_or_default()
    }
}

/// Mostra o nasconde un calendario in un vault.
pub fn set_calendar_shown(main: &Db, id: &str, calendar: &str, shown: bool) -> CmdResult<()> {
    let mut registry = Registry::load(main);
    let hidden = if id == MAIN_ID {
        &mut registry.main_hidden_calendars
    } else {
        &mut registry.vaults.iter_mut().find(|v| v.id == id).ok_or(tr("Vault non trovato", "Vault not found"))?.hidden_calendars
    };
    hidden.retain(|c| c != calendar);
    if !shown {
        hidden.push(calendar.to_string());
    }
    registry.save(main)
}

/// Porta i meeting al livello minimo del vault e cancella l'audio che quelli alzati avevano
/// conservato per la trascrizione online: con un livello di privacy non deve più poter uscire.
pub(crate) fn enforce(db: &Db, dir: &Path, min: Privacy) -> CmdResult<()> {
    for id in db.raise_privacy(min).map_err(err)? {
        crate::keep::remove(dir, &id);
    }
    Ok(())
}

fn unreachable() -> String {
    tr(
        "La cartella di questo vault non è raggiungibile. Collega il disco su cui si trova e riprova.",
        "This vault's folder cannot be reached. Connect the disk it is on and try again.",
    )
    .into()
}

/// Apre il vault principale, con la privacy minima scritta nel suo database.
fn open_main(registry: &Registry, main: &Db, main_dir: &Path) -> CmdResult<(Db, Open)> {
    // seconda connessione allo stesso file del database principale
    let db = Db::open(&main_dir.join(DB_FILE)).map_err(err)?;
    let min_privacy = registry.main_meta(main)?.min_privacy;
    enforce(&db, main_dir, min_privacy)?;
    Ok((db, Open { id: MAIN_ID.into(), dir: main_dir.to_path_buf(), min_privacy, lock: None }))
}

/// Apre un vault dell'elenco: lo prende per questo computer e applica la privacy minima che
/// porta scritta, aggiornando la copia nell'elenco.
fn open_added(vault: &mut Vault, me: &Device, force: bool) -> CmdResult<(Db, Open)> {
    let dir = PathBuf::from(&vault.path);
    if !dir.join(DB_FILE).is_file() {
        // crearla al posto di un disco scollegato darebbe un vault vuoto
        return Err(unreachable());
    }
    let lock = Lock::acquire(&dir, me, force)?;
    let db = open_db(&dir)?;
    let meta = Meta::ensure(&db, &vault.id, vault.min_privacy)?;
    enforce(&db, &dir, meta.min_privacy)?;
    vault.min_privacy = meta.min_privacy;
    Ok((db, Open { id: vault.id.clone(), dir, min_privacy: meta.min_privacy, lock: Some(lock) }))
}

/// All'avvio: il database e la cartella del vault che era aperto. Se non c'è più (disco
/// scollegato, cartella spostata) o lo ha aperto un altro computer si riparte dal principale,
/// senza toccare l'elenco.
pub fn startup(main: &Db, main_dir: &Path) -> anyhow::Result<(Db, Open)> {
    let mut registry = Registry::load(main);
    let active = registry.active.clone();
    if let Some(vault) = registry.vaults.iter_mut().find(|v| v.id == active) {
        match open_added(vault, &Device::this(main), false) {
            Ok(opened) => {
                if let Err(e) = registry.save(main) {
                    log::error!("elenco dei vault non salvato: {e}");
                }
                return Ok(opened);
            }
            // il messaggio dice solo perché: disco, permessi o il nome dell'altro computer
            Err(e) => log::warn!("il vault aperto l'ultima volta non si apre, si apre il principale: {e}"),
        }
    }
    open_main(&registry, main, main_dir).map_err(anyhow::Error::msg)
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
    /// I calendari che non mostra.
    hidden_calendars: Vec<String>,
    /// Il nome del computer che lo ha aperto, se è un altro.
    held_by: Option<String>,
}

fn infos(state: &AppState, main: &Db, registry: &Registry) -> Vec<VaultInfo> {
    let open = state.vault.read().id.clone();
    let me = Device::this(main);
    let first = VaultInfo {
        id: MAIN_ID.into(),
        name: tr("Principale", "Main").into(),
        path: state.data_dir.display().to_string(),
        min_privacy: registry.main_meta(main).map(|m| m.min_privacy).unwrap_or(registry.main_min_privacy),
        main: true,
        active: open == MAIN_ID,
        available: true,
        hidden_calendars: registry.main_hidden_calendars.clone(),
        held_by: None,
    };
    let others = registry.vaults.iter().map(|v| {
        let dir = Path::new(&v.path);
        let available = dir.join(DB_FILE).is_file();
        VaultInfo {
            id: v.id.clone(),
            name: v.name.clone(),
            path: v.path.clone(),
            min_privacy: v.min_privacy,
            main: false,
            active: open == v.id,
            available,
            hidden_calendars: v.hidden_calendars.clone(),
            held_by: Lock::held_by_other(dir, &me).filter(|_| available && open != v.id).map(|holder| holder.name),
        }
    });
    std::iter::once(first).chain(others).collect()
}

/// Mostra o nasconde un calendario in un vault (`None`: quello aperto).
#[tauri::command]
pub fn show_calendar_in_vault(
    state: State<AppState>,
    vault: Option<String>,
    calendar: String,
    shown: bool,
) -> CmdResult<Vec<VaultInfo>> {
    let vault = vault.unwrap_or_else(|| state.vault.read().id.clone());
    let main = state.main.lock();
    set_calendar_shown(&main, &vault, &calendar, shown)?;
    Ok(infos(&state, &main, &Registry::load(&main)))
}

#[tauri::command]
pub fn list_vaults(state: State<AppState>) -> CmdResult<Vec<VaultInfo>> {
    let main = state.main.lock();
    Ok(infos(&state, &main, &Registry::load(&main)))
}

/// Fa scegliere la cartella di un vault. `None` se la scelta viene annullata.
#[tauri::command]
pub async fn pick_vault_dir(app: AppHandle) -> CmdResult<Option<String>> {
    crate::commands::pick_folder(&app, tr("Cartella del vault", "Vault folder")).await
}

/// Aggiunge un vault in una cartella: se contiene già un vault di Granello lo ritrova con i
/// suoi meeting, la sua identità e la sua privacy minima; altrimenti ne crea uno vuoto. Non lo
/// apre.
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
    if let Some(holder) = Lock::held_by_other(&dir, &Device::this(&main)) {
        return Err(crate::trf!(
            "Questo vault risulta aperto su «{}». Chiudi Granello su quel computer e riprova. Se non lo sta più usando, elimina il file {} dalla cartella del vault.",
            "This vault appears to be open on \"{}\". Quit Granello on that computer and try again. If it is no longer using it, delete the file {} from the vault's folder.",
            holder.name,
            LOCK_FILE
        ));
    }
    let db = open_db(&dir).map_err(|e| {
        crate::trf!(
            "Non riesco a creare il vault in quella cartella: {}. Scegline una in cui puoi scrivere.",
            "Could not create the vault in that folder: {}. Choose one you can write to.",
            e
        )
    })?;
    let meta = registry.adopt(&db)?;
    enforce(&db, &dir, meta.min_privacy)?;
    registry.save(&main)?;
    log::info!("vault aggiunto (privacy minima {})", meta.min_privacy.as_str());
    Ok(infos(&state, &main, &registry))
}

/// Cambia nome e privacy minima di un vault. Del principale cambia solo la privacy minima.
/// Il nome è di questo computer; la privacy minima si scrive nel vault, che quindi deve
/// essere raggiungibile e non aperto altrove. Alzare il minimo alza subito i meeting del
/// vault che stavano sotto.
#[tauri::command]
pub fn update_vault(state: State<AppState>, id: String, name: String, min_privacy: Privacy) -> CmdResult<Vec<VaultInfo>> {
    // prima `db`, poi `main`: chi tiene il database principale non prende quello del vault
    let db = state.db.lock();
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    let open_here = state.vault.read().id == id;
    if id == MAIN_ID {
        Meta { min_privacy, ..registry.main_meta(&main)? }.write(&main)?;
        enforce(&main, &state.data_dir, min_privacy)?;
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
        if vault.min_privacy != min_privacy {
            let dir = PathBuf::from(&vault.path);
            let apply = |db: &Db| -> CmdResult<()> {
                Meta { min_privacy, ..Meta::ensure(db, &id, min_privacy)? }.write(db)?;
                enforce(db, &dir, min_privacy)
            };
            if open_here {
                apply(&db)?;
            } else if !dir.join(DB_FILE).is_file() {
                return Err(tr(
                    "La privacy minima si scrive nel vault, che ora non è raggiungibile. Collega il disco su cui si trova e riprova.",
                    "The minimum privacy is written in the vault, which cannot be reached now. Connect the disk it is on and try again.",
                )
                .into());
            } else if let Some(holder) = Lock::held_by_other(&dir, &Device::this(&main)) {
                return Err(Lock::busy(&holder));
            } else {
                apply(&open_db(&dir)?)?;
            }
            vault.min_privacy = min_privacy;
        }
    }
    registry.save(&main)?;
    if open_here {
        state.vault.write().min_privacy = min_privacy;
    }
    Ok(infos(&state, &main, &registry))
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
    Ok(infos(&state, &main, &registry))
}

/// Apre un vault: da qui in poi l'app mostra i suoi meeting. Con `force` lo apre anche se
/// risulta aperto su un altro computer.
#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<AppState>, id: String, force: bool) -> CmdResult<Vec<VaultInfo>> {
    if state.busy() {
        return Err(tr(
            "C'è un lavoro in corso su questo vault (registrazione, trascrizione o AI): aspetta che finisca prima di cambiare vault.",
            "Something is still running on this vault (recording, transcription or AI): wait for it to finish before switching vault.",
        )
        .into());
    }
    let main = state.main.lock();
    let mut registry = Registry::load(&main);
    if state.vault.read().id == id {
        return Ok(infos(&state, &main, &registry));
    }
    let (db, open) = if id == MAIN_ID {
        open_main(&registry, &main, &state.data_dir)?
    } else {
        let vault =
            registry.vaults.iter_mut().find(|v| v.id == id).ok_or(tr("Vault non trovato", "Vault not found"))?;
        open_added(vault, &Device::this(&main), force)?
    };
    registry.active = if id == MAIN_ID { String::new() } else { id };
    registry.save(&main)?;
    let settings = main.get_settings().map_err(err)?;
    drop(main);
    // database e vault cambiano insieme: chi tiene `db` vede sempre il vault che gli corrisponde
    let mut current = state.db.lock();
    *current = db;
    // il vault di prima viene liberato qui, quando il suo blocco esce di scena
    *state.vault.write() = open;
    drop(current);
    crate::commands::allow_recordings_dir(&app, &state.vault_dir(), state.chosen_recordings(&settings));
    log::info!("vault aperto");
    Ok(infos(&state, &state.main.lock(), &registry))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("granello-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn device(name: &str) -> Device {
        Device { id: uuid::Uuid::new_v4().to_string(), name: name.into() }
    }

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

        // la cartella di sync è di questo Mac, per vault
        assert_eq!(sync_dir(&db, &first.id), None);
        set_sync_dir(&db, &first.id, Some("/iCloud/Granello".into())).unwrap();
        set_sync_dir(&db, MAIN_ID, Some("/iCloud/Principale".into())).unwrap();
        assert_eq!(sync_dir(&db, &first.id), Some(PathBuf::from("/iCloud/Granello")));
        assert_eq!(sync_dir(&db, MAIN_ID), Some(PathBuf::from("/iCloud/Principale")));
        set_sync_dir(&db, &first.id, None).unwrap();
        assert_eq!(sync_dir(&db, &first.id), None);
        assert!(set_sync_dir(&db, "non-esiste", None).is_err());

        // i calendari si scelgono per vault: di base li mostrano tutti
        assert!(hidden_calendars(&db, &first.id).is_empty());
        set_calendar_shown(&db, &first.id, "casa", false).unwrap();
        set_calendar_shown(&db, &first.id, "casa", false).unwrap();
        set_calendar_shown(&db, MAIN_ID, "lavoro", false).unwrap();
        assert_eq!(hidden_calendars(&db, &first.id), ["casa"]);
        assert_eq!(hidden_calendars(&db, MAIN_ID), ["lavoro"]);
        set_calendar_shown(&db, &first.id, "casa", true).unwrap();
        assert!(hidden_calendars(&db, &first.id).is_empty());
        assert_eq!(hidden_calendars(&db, MAIN_ID), ["lavoro"], "ogni vault ha la sua scelta");
        assert!(set_calendar_shown(&db, "non-esiste", "casa", false).is_err());
    }

    #[test]
    fn a_vault_keeps_its_own_meetings_and_minimum_privacy() {
        let root = temp_root("vault");
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
        // aperto qui: il file di blocco c'è, e sparisce quando il vault si chiude
        assert!(vault_dir.join(LOCK_FILE).is_file());
        drop((db, open));
        assert!(!vault_dir.join(LOCK_FILE).exists());

        // se la cartella non c'è più si riparte dal principale, e il vault resta in elenco
        std::fs::remove_dir_all(&vault_dir).unwrap();
        let (db, open) = startup(&main, &main_dir).unwrap();
        assert_eq!(open.id, MAIN_ID);
        assert_eq!(db.list_meetings(None).unwrap()[0].title, "Nel principale");
        assert_eq!(Registry::load(&main).vaults.len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn identity_and_minimum_privacy_travel_with_the_vault() {
        let root = temp_root("identita");
        let (main_dir, vault_dir) = (root.join("app"), root.join("riservato"));
        let path = vault_dir.to_str().unwrap();

        // il primo computer crea il vault blindato
        let mut first = Registry::default();
        first.add(&main_dir, "Riservato", path, Privacy::Hardened).unwrap();
        let created = first.adopt(&open_db(&vault_dir).unwrap()).unwrap();
        assert_eq!((first.vaults[0].id.as_str(), created.min_privacy), (created.id.as_str(), Privacy::Hardened));

        // un altro computer lo aggiunge chiedendo meno: identità e minimo restano quelli del vault
        let mut second = Registry::default();
        second.add(&main_dir, "Lo stesso", path, Privacy::Open).unwrap();
        let found = second.adopt(&open_db(&vault_dir).unwrap()).unwrap();
        assert_eq!(found, created);
        assert_eq!((second.vaults[0].id.as_str(), second.vaults[0].min_privacy), (created.id.as_str(), Privacy::Hardened));

        // riaggiungerlo può alzare il minimo, non abbassarlo
        let audio_dir = root.join("audio");
        let mut third = Registry::default();
        third.add(&main_dir, "Audio", audio_dir.to_str().unwrap(), Privacy::Audio).unwrap();
        let audio = third.adopt(&open_db(&audio_dir).unwrap()).unwrap();
        let mut fourth = Registry::default();
        fourth.add(&main_dir, "Audio", audio_dir.to_str().unwrap(), Privacy::Hardened).unwrap();
        let raised = fourth.adopt(&open_db(&audio_dir).unwrap()).unwrap();
        assert_eq!((raised.id, raised.min_privacy), (audio.id, Privacy::Hardened));

        // lo stesso vault copiato in un'altra cartella non entra due volte nell'elenco
        let copy_dir = root.join("copia");
        std::fs::create_dir_all(&copy_dir).unwrap();
        Meta::read(&open_db(&vault_dir).unwrap()).unwrap().write(&open_db(&copy_dir).unwrap()).unwrap();
        second.add(&main_dir, "Copia", copy_dir.to_str().unwrap(), Privacy::Open).unwrap();
        assert!(second.adopt(&open_db(&copy_dir).unwrap()).is_err());
        assert_eq!(second.vaults.len(), 1);

        // aprendolo vale il minimo scritto nel vault, non la copia nell'elenco
        second.vaults[0].min_privacy = Privacy::Open;
        let (_db, open) = open_added(&mut second.vaults[0], &device("Secondo"), false).unwrap();
        assert_eq!((open.min_privacy, second.vaults[0].min_privacy), (Privacy::Hardened, Privacy::Hardened));

        // il principale impara il suo minimo dall'elenco di prima, poi lo tiene nel database
        let main = Db::open_in_memory().unwrap();
        let old = Registry { main_min_privacy: Privacy::Audio, ..Registry::default() };
        let learned = old.main_meta(&main).unwrap();
        assert_eq!(learned.min_privacy, Privacy::Audio);
        assert_eq!(Registry::default().main_meta(&main).unwrap(), learned);
        drop(open);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_vault_is_open_on_one_computer_at_a_time() {
        let dir = temp_root("blocco");
        let (here, there) = (device("Studio"), device("Portatile"));

        let lock = Lock::acquire(&dir, &here, false).unwrap();
        assert_eq!(Lock::held_by_other(&dir, &here), None);
        assert_eq!(Lock::held_by_other(&dir, &there), Some(here.clone()));
        // l'altro computer si ferma, e il messaggio dice chi lo ha aperto
        let refused = Lock::acquire(&dir, &there, false).unwrap_err();
        assert!(refused.contains("Studio"));

        // chiuso il vault, l'altro lo può aprire
        drop(lock);
        assert!(!dir.join(LOCK_FILE).exists());
        let theirs = Lock::acquire(&dir, &there, false).unwrap();

        // un blocco rimasto dopo una chiusura andata male si supera solo chiedendolo
        assert!(Lock::acquire(&dir, &here, false).is_err());
        let forced = Lock::acquire(&dir, &here, true).unwrap();
        // chi è stato scavalcato non toglie il blocco dell'altro quando chiude
        drop(theirs);
        assert_eq!(Lock::holder(&dir), Some(here.clone()));

        // lo stesso computer riprende un blocco suo senza chiedere
        std::mem::forget(forced);
        let again = Lock::acquire(&dir, &here, false).unwrap();
        // un file illeggibile non blocca nessuno
        std::fs::write(dir.join(LOCK_FILE), "non è json").unwrap();
        assert_eq!(Lock::held_by_other(&dir, &there), None);
        drop(again);
        let _ = std::fs::remove_dir_all(dir);
    }
}
