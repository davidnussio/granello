//! API key dei provider AI: nel Portachiavi su macOS, in file 0600 altrove.
//! Ogni provider ha la sua voce, identificata dal suo `id`.
//!
//! Su macOS ogni chiave viene letta dal Portachiavi una sola volta per avvio e poi tenuta in
//! memoria: senza una firma Developer ID il permesso "Consenti sempre" si perde a ogni build,
//! e ogni lettura chiederebbe di nuovo la password. Vedi "Prossimi passi" nel README.

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

fn env_key(provider_id: &str) -> Option<String> {
    if provider_id != ANTHROPIC_ID {
        return None;
    }
    std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty())
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

#[cfg(target_os = "macos")]
pub fn get_api_key(_dir: &Path, provider_id: &str) -> Result<Option<String>> {
    if let Some(k) = env_key(provider_id) {
        return Ok(Some(k));
    }
    CACHE.get(provider_id, || {
        match keyring::Entry::new(SERVICE, &account(provider_id))?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

#[cfg(target_os = "macos")]
pub fn set_api_key(_dir: &Path, provider_id: &str, key: &str) -> Result<()> {
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

#[cfg(not(target_os = "macos"))]
fn key_file(dir: &Path, provider_id: &str) -> std::path::PathBuf {
    if provider_id == ANTHROPIC_ID {
        dir.join("api_key")
    } else {
        dir.join(format!("api_key_{provider_id}"))
    }
}

#[cfg(not(target_os = "macos"))]
pub fn get_api_key(dir: &Path, provider_id: &str) -> Result<Option<String>> {
    if let Some(k) = env_key(provider_id) {
        return Ok(Some(k));
    }
    match std::fs::read_to_string(key_file(dir, provider_id)) {
        Ok(k) if !k.trim().is_empty() => Ok(Some(k.trim().to_string())),
        _ => Ok(None),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_api_key(dir: &Path, provider_id: &str, key: &str) -> Result<()> {
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
    fn accounts_are_per_provider() {
        assert_eq!(account(ANTHROPIC_ID), "anthropic-api-key"); // compatibile con le versioni precedenti
        assert_eq!(account("lmstudio"), "provider-lmstudio-api-key");
        assert!(env_key("lmstudio").is_none());
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
