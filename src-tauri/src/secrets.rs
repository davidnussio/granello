//! API key dei provider AI: nel Portachiavi su macOS, in file 0600 altrove.
//! Ogni provider ha la sua voce, identificata dal suo `id`.

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

#[cfg(target_os = "macos")]
pub fn get_api_key(_dir: &Path, provider_id: &str) -> Result<Option<String>> {
    if let Some(k) = env_key(provider_id) {
        return Ok(Some(k));
    }
    match keyring::Entry::new(SERVICE, &account(provider_id))?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(target_os = "macos")]
pub fn set_api_key(_dir: &Path, provider_id: &str, key: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, &account(provider_id))?;
    if key.is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(key)?;
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
}
