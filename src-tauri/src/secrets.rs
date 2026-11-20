//! API key dei provider AI: nel Portachiavi su macOS, in file 0600 altrove.
//! Ogni provider ha la sua voce, identificata dal suo `id`.
//!
//! Su macOS ogni chiave viene letta dal Portachiavi una sola volta per avvio e poi tenuta in
//! memoria: senza una firma Developer ID il permesso "Consenti sempre" si perde a ogni build,
//! e ogni lettura chiederebbe di nuovo la password. Vedi "Prossimi passi" nel README.
//!
//! Per lo stesso motivo le build di sviluppo (`tauri dev`) non usano il Portachiavi: ogni
//! ricompilazione chiederebbe la password a ogni avvio, una volta per chiave, e Touch ID lì
//! non è disponibile. Tengono le chiavi in file 0600 nella cartella dati, come sugli altri
//! sistemi; la prima volta le copiano dal Portachiavi. Le build di rilascio usano il Portachiavi.

use anyhow::Result;
use std::path::Path;

/// Provider predefinito: mantiene la voce storica del Portachiavi e la variabile d'ambiente.
pub const ANTHROPIC_ID: &str = "anthropic";

#[cfg(target_os = "macos")]
const SERVICE: &str = "ch.dambox.granello";

fn account(provider_id: &str) -> String {
    if provider_id == ANTHROPIC_ID {
        "anthropic-api-key".into()
    } else {
        format!("provider-{provider_id}-api-key")
    }
}

/// Variabili d'ambiente da cui leggere la chiave di Claude, in ordine. L'ultima è il nome che
/// `envsec run --inject` dà al segreto `claude.api-key` (il trattino resta).
const CLAUDE_ENV: &[&str] = &["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_API-KEY"];

/// Con la chiave nell'ambiente il Portachiavi non viene letto: niente richiesta di password.
fn env_key(provider_id: &str) -> Option<String> {
    if provider_id != ANTHROPIC_ID {
        return None;
    }
    key_from(|name| std::env::var(name).ok())
}

fn key_from(var: impl Fn(&str) -> Option<String>) -> Option<String> {
    CLAUDE_ENV.iter().find_map(|name| var(name).map(|k| k.trim().to_string()).filter(|k| !k.is_empty()))
}

/// Chiavi già lette in questo avvio, per provider. `None` = il Portachiavi non ha la voce.
#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
struct KeyCache(parking_lot::Mutex<std::collections::HashMap<String, Option<String>>>);

#[cfg(any(target_os = "macos", test))]
impl KeyCache {
    /// La chiave in memoria, altrimenti quella letta con `load`. Un errore (per esempio
    /// l'accesso al Portachiavi negato) non viene ricordato: la prossima volta si riprova.
    fn get(&self, provider_id: &str, load: impl FnOnce() -> Result<Option<String>>) -> Result<Option<String>> {
        // il lock resta preso durante la lettura: due richieste insieme fanno un solo prompt
        let mut keys = self.0.lock();
        if let Some(k) = keys.get(provider_id) {
            return Ok(k.clone());
        }
        let key = load()?;
        keys.insert(provider_id.to_string(), key.clone());
        Ok(key)
    }

    fn set(&self, provider_id: &str, key: Option<String>) {
        self.0.lock().insert(provider_id.to_string(), key);
    }
}

#[cfg(target_os = "macos")]
static CACHE: std::sync::LazyLock<KeyCache> = std::sync::LazyLock::new(KeyCache::default);

/// Le build di sviluppo non sono firmate in modo stabile: lì il Portachiavi chiederebbe la
/// password a ogni avvio, per ogni chiave.
#[cfg(target_os = "macos")]
const USE_KEYCHAIN: bool = !cfg!(debug_assertions);

#[cfg(target_os = "macos")]
fn keychain_get(provider_id: &str) -> Result<Option<String>> {
    match keyring::Entry::new(SERVICE, &account(provider_id))?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Segna che per questo provider il Portachiavi è già stato guardato una volta.
#[cfg(target_os = "macos")]
fn imported_marker(dir: &Path, provider_id: &str) -> std::path::PathBuf {
    key_file(dir, provider_id).with_extension("imported")
}

#[cfg(target_os = "macos")]
pub fn get_api_key(dir: &Path, provider_id: &str) -> Result<Option<String>> {
    if let Some(k) = env_key(provider_id) {
        return Ok(Some(k));
    }
    if USE_KEYCHAIN {
        return CACHE.get(provider_id, || keychain_get(provider_id));
    }
    if let Some(k) = file_get(dir, provider_id) {
        return Ok(Some(k));
    }
    // prima volta in sviluppo: la chiave salvata dal Portachiavi viene copiata nel file,
    // con un'ultima richiesta di password; poi il Portachiavi non si tocca più
    let marker = imported_marker(dir, provider_id);
    if marker.exists() {
        return Ok(None);
    }
    let key = CACHE.get(provider_id, || keychain_get(provider_id))?;
    if let Some(k) = &key {
        file_set(dir, provider_id, k)?;
    }
    let _ = std::fs::write(marker, "");
    Ok(key)
}

#[cfg(target_os = "macos")]
pub fn set_api_key(dir: &Path, provider_id: &str, key: &str) -> Result<()> {
    if !USE_KEYCHAIN {
        // una chiave tolta qui non deve tornare dal Portachiavi al prossimo avvio
        let _ = std::fs::write(imported_marker(dir, provider_id), "");
        CACHE.set(provider_id, (!key.is_empty()).then(|| key.to_string()));
        return file_set(dir, provider_id, key);
    }
    let entry = keyring::Entry::new(SERVICE, &account(provider_id))?;
    if key.is_empty() {
        let _ = entry.delete_credential();
        CACHE.set(provider_id, None);
    } else {
        entry.set_password(key)?;
        CACHE.set(provider_id, Some(key.to_string()));
    }
    Ok(())
}

fn key_file(dir: &Path, provider_id: &str) -> std::path::PathBuf {
    if provider_id == ANTHROPIC_ID {
        dir.join("api_key")
    } else {
        dir.join(format!("api_key_{provider_id}"))
    }
}

/// La chiave salvata in un file della cartella dati, leggibile solo dall'utente (0600).
fn file_get(dir: &Path, provider_id: &str) -> Option<String> {
    match std::fs::read_to_string(key_file(dir, provider_id)) {
        Ok(k) if !k.trim().is_empty() => Some(k.trim().to_string()),
        _ => None,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_api_key(dir: &Path, provider_id: &str) -> Result<Option<String>> {
    if let Some(k) = env_key(provider_id) {
        return Ok(Some(k));
    }
    Ok(file_get(dir, provider_id))
}

#[cfg(not(target_os = "macos"))]
pub fn set_api_key(dir: &Path, provider_id: &str, key: &str) -> Result<()> {
    file_set(dir, provider_id, key)
}

fn file_set(dir: &Path, provider_id: &str, key: &str) -> Result<()> {
    let path = key_file(dir, provider_id);
    if key.is_empty() {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    std::fs::write(&path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_files_are_private_and_removable() {
        let dir = std::env::temp_dir().join(format!("granello-keys-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(file_get(&dir, "gladia"), None);
        file_set(&dir, "gladia", "sk-file").unwrap();
        assert_eq!(file_get(&dir, "gladia").as_deref(), Some("sk-file"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(key_file(&dir, "gladia")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        file_set(&dir, "gladia", "").unwrap();
        assert_eq!(file_get(&dir, "gladia"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn accounts_are_per_provider() {
        assert_eq!(account(ANTHROPIC_ID), "anthropic-api-key"); // compatibile con le versioni precedenti
        assert_eq!(account("lmstudio"), "provider-lmstudio-api-key");
        assert!(env_key("lmstudio").is_none());
    }

    #[test]
    fn reads_the_claude_key_from_the_environment() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| pairs.iter().find(|(n, _)| *n == name).map(|(_, v)| v.to_string())
        };
        assert_eq!(key_from(env(&[("CLAUDE_API-KEY", " sk-envsec\n")])).as_deref(), Some("sk-envsec"));
        assert_eq!(key_from(env(&[("CLAUDE_API_KEY", "sk-b"), ("CLAUDE_API-KEY", "sk-c")])).as_deref(), Some("sk-b"));
        // una variabile vuota non conta: si passa alla successiva
        assert_eq!(key_from(env(&[("ANTHROPIC_API_KEY", ""), ("CLAUDE_API_KEY", "sk-b")])).as_deref(), Some("sk-b"));
        assert_eq!(key_from(env(&[("OPENAI_API_KEY", "sk-x")])), None);
    }

    #[test]
    fn reads_each_key_once_per_launch() {
        let cache = KeyCache::default();
        let reads = std::cell::Cell::new(0);
        let load = || {
            reads.set(reads.get() + 1);
            Ok(Some("sk-1".to_string()))
        };
        assert_eq!(cache.get("a", load).unwrap().as_deref(), Some("sk-1"));
        assert_eq!(cache.get("a", load).unwrap().as_deref(), Some("sk-1"));
        assert_eq!(reads.get(), 1);
        // anche "nessuna chiave" si ricorda, e ogni provider ha la sua voce
        assert_eq!(cache.get("b", || Ok(None)).unwrap(), None);
        assert_eq!(cache.get("b", || panic!("già letta")).unwrap(), None);

        // salvare o togliere una chiave aggiorna la memoria senza rileggere
        cache.set("a", Some("sk-2".into()));
        assert_eq!(cache.get("a", || panic!("già in memoria")).unwrap().as_deref(), Some("sk-2"));
        cache.set("a", None);
        assert_eq!(cache.get("a", || panic!("già in memoria")).unwrap(), None);
    }

    #[test]
    fn a_denied_read_is_retried() {
        let cache = KeyCache::default();
        assert!(cache.get("a", || Err(anyhow::anyhow!("accesso negato"))).is_err());
        assert_eq!(cache.get("a", || Ok(Some("sk-1".into()))).unwrap().as_deref(), Some("sk-1"));
    }
}
