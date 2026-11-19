//! API key di Claude: nel Portachiavi su macOS, in un file 0600 altrove.

use anyhow::Result;
use std::path::Path;

#[cfg(target_os = "macos")]
const SERVICE: &str = "ch.dambox.granello";
#[cfg(target_os = "macos")]
const ACCOUNT: &str = "anthropic-api-key";

#[cfg(target_os = "macos")]
pub fn get_api_key(_dir: &Path) -> Result<Option<String>> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.is_empty() {
            return Ok(Some(k));
        }
    }
    match keyring::Entry::new(SERVICE, ACCOUNT)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(target_os = "macos")]
pub fn set_api_key(_dir: &Path, key: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)?;
    if key.is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(key)?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn get_api_key(dir: &Path) -> Result<Option<String>> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.is_empty() {
            return Ok(Some(k));
        }
    }
    match std::fs::read_to_string(dir.join("api_key")) {
        Ok(k) if !k.trim().is_empty() => Ok(Some(k.trim().to_string())),
        _ => Ok(None),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_api_key(dir: &Path, key: &str) -> Result<()> {
    let path = dir.join("api_key");
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
