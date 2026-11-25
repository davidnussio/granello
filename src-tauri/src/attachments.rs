//! Allegati delle note: immagini incollate e file collegati, copiati nella cartella dati.
//! Nel Markdown compaiono come percorso relativo `attachments/<nome>`, mai come percorso assoluto.

use anyhow::Result;
use serde::Serialize;
use std::path::{Path, PathBuf};

const DIR: &str = "attachments";
/// Un file più grande non viene copiato.
pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    /// Percorso relativo alla cartella dati, come compare nella nota.
    pub path: String,
    /// Nome originale del file, da mostrare.
    pub name: String,
    pub size: u64,
}

/// Estensione sicura da tenere nel nome del file salvato.
fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".into())
}

fn display_name(name: &str) -> String {
    let base = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let clean: String = base.chars().filter(|c| !c.is_control() && !"[]()".contains(*c)).take(80).collect();
    if clean.trim().is_empty() { "file".into() } else { clean.trim().to_string() }
}

fn too_big() -> anyhow::Error {
    tra!("Il file è troppo grande: al massimo 25 MB.", "The file is too large: 25 MB at most.")
}

/// Un nome nuovo nella cartella degli allegati, con l'estensione del file originale.
fn new_file(data_dir: &Path, name: &str) -> Result<(PathBuf, String)> {
    let dir = data_dir.join(DIR);
    std::fs::create_dir_all(&dir)?;
    let file = format!("{}.{}", uuid::Uuid::new_v4().simple(), extension(name));
    Ok((dir.join(&file), format!("{DIR}/{file}")))
}

/// Salva tra gli allegati un contenuto arrivato dall'interfaccia (incolla, trascina).
pub fn store(data_dir: &Path, name: &str, bytes: &[u8]) -> Result<Attachment> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(too_big());
    }
    let (target, path) = new_file(data_dir, name)?;
    std::fs::write(target, bytes)?;
    Ok(Attachment { path, name: display_name(name), size: bytes.len() as u64 })
}

/// Copia tra gli allegati un file scelto dall'utente.
pub fn import(data_dir: &Path, source: &Path) -> Result<Attachment> {
    let size = std::fs::metadata(source)?.len();
    if size > MAX_BYTES {
        return Err(too_big());
    }
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let (target, path) = new_file(data_dir, name)?;
    std::fs::copy(source, target)?;
    Ok(Attachment { path, name: display_name(name), size })
}

/// Il file a cui punta un percorso `attachments/<nome>`. Accetta solo nomi semplici:
/// niente sottocartelle, niente `..`, quindi mai un file fuori dalla cartella degli allegati.
pub fn resolve(data_dir: &Path, rel: &str) -> Result<PathBuf> {
    let name = rel.strip_prefix("attachments/").unwrap_or("");
    let ok = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !ok {
        return Err(tra!("Allegato non valido", "Invalid attachment"));
    }
    let path = data_dir.join(DIR).join(name);
    if !path.is_file() {
        return Err(tra!("Allegato non trovato", "Attachment not found"));
    }
    Ok(path)
}

/// Un'immagine allegata come data URL. I file che non sono immagini vengono rifiutati.
pub fn image_data_url(data_dir: &Path, rel: &str) -> Result<String> {
    use base64::Engine;
    let path = resolve(data_dir, rel)?;
    let mime = match extension(rel).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        _ => return Err(tra!("L'allegato non è un'immagine", "The attachment is not an image")),
    };
    let bytes = std::fs::read(path)?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// I percorsi `attachments/<nome>` citati in un testo Markdown.
pub fn referenced(markdown: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = markdown;
    while let Some(at) = rest.find("attachments/") {
        let tail = &rest[at + "attachments/".len()..];
        let len = tail.find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-')).unwrap_or(tail.len());
        let name = tail[..len].trim_end_matches('.');
        if !name.is_empty() {
            let path = format!("attachments/{name}");
            if !found.contains(&path) {
                found.push(path);
            }
        }
        rest = &tail[len..];
    }
    found
}

/// Gli allegati citati in un testo Markdown con il nome che la nota mostra: il testo del link
/// (`[📎 verbale.pdf (12 KB)](…)` → `verbale.pdf`) o di un'immagine (`![schema](…)`).
pub fn labeled(markdown: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for path in referenced(markdown) {
        let label = markdown
            .match_indices(&format!("]({path}"))
            .find_map(|(at, _)| {
                let open = markdown[..at].rfind('[')?;
                let text = markdown[open + 1..at].trim();
                let text = text.strip_prefix("📎").unwrap_or(text).trim();
                // la dimensione tra parentesi in fondo la calcola chi mostra il file
                let text = match text.rfind(" (") {
                    Some(i) if text.ends_with(" KB)") || text.ends_with(" MB)") => &text[..i],
                    _ => text,
                };
                (!text.is_empty() && !text.contains('\n')).then(|| text.to_string())
            })
            .unwrap_or_else(|| path.trim_start_matches("attachments/").to_string());
        out.push((path, label));
    }
    out
}

/// Elimina un allegato. Un file già sparito non è un errore.
pub fn remove(data_dir: &Path, rel: &str) {
    if let Ok(path) = resolve(data_dir, rel) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("eliminazione allegato {}: {e}", path.display());
        }
    }
}

/// Il titolo di una pagina HTML: `og:title` se c'è, altrimenti `<title>`.
pub fn page_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let og = lower.find("property=\"og:title\"").or_else(|| lower.find("property='og:title'")).and_then(|at| {
        // l'attributo content sta nello stesso tag, prima o dopo property
        let start = lower[..at].rfind('<')?;
        let end = at + lower[at..].find('>')?;
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        let c = tag_lower.find("content=")? + "content=".len();
        let quote = tag[c..].chars().next().filter(|q| *q == '"' || *q == '\'')?;
        let value = &tag[c + 1..];
        Some(value[..value.find(quote)?].to_string())
    });
    let title = og.or_else(|| {
        let open = lower.find("<title")?;
        let start = open + lower[open..].find('>')? + 1;
        let end = start + lower[start..].find("</title")?;
        Some(html[start..end].to_string())
    })?;
    let decoded = title
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    let clean: String = decoded.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
    (!clean.is_empty()).then_some(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("granello-att-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stores_and_reads_back() {
        let dir = temp_dir("store");
        let a = store(&dir, "Schermata [1].PNG", b"\x89PNG finto").unwrap();
        assert!(a.path.starts_with("attachments/") && a.path.ends_with(".png"), "{}", a.path);
        assert_eq!(a.name, "Schermata 1.PNG");
        assert_eq!(a.size, 10);
        assert!(image_data_url(&dir, &a.path).unwrap().starts_with("data:image/png;base64,"));

        let doc = store(&dir, "verbale.pdf", b"%PDF").unwrap();
        assert!(resolve(&dir, &doc.path).is_ok());
        assert!(image_data_url(&dir, &doc.path).is_err(), "un PDF non è un'immagine");
        assert!(store(&dir, "senza estensione", b"x").unwrap().path.ends_with(".bin"));

        // copia di un file scelto dall'utente
        let source = dir.join("originale.txt");
        std::fs::write(&source, "ciao").unwrap();
        let copy = import(&dir, &source).unwrap();
        assert_eq!((copy.name.as_str(), copy.size), ("originale.txt", 4));
        assert_eq!(std::fs::read_to_string(resolve(&dir, &copy.path).unwrap()).unwrap(), "ciao");

        remove(&dir, &a.path);
        assert!(resolve(&dir, &a.path).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn never_leaves_the_attachments_folder() {
        let dir = temp_dir("escape");
        std::fs::write(dir.join("segreto.txt"), "x").unwrap();
        for bad in [
            "attachments/../segreto.txt",
            "attachments/sub/a.png",
            "attachments/",
            "attachments/.nascosto",
            "/etc/passwd",
            "segreto.txt",
            "attachments/a b.png",
        ] {
            assert!(resolve(&dir, bad).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finds_references_in_markdown() {
        let md = "Testo ![schema](attachments/abc123.png) e [📎 verbale.pdf (12 KB)](attachments/def-456.pdf).\n\
                  Di nuovo attachments/abc123.png, e un link normale https://example.com/attachments/";
        assert_eq!(referenced(md), ["attachments/abc123.png", "attachments/def-456.pdf"]);
        assert!(referenced("nessun allegato").is_empty());
        assert_eq!(
            labeled(md),
            [("attachments/abc123.png".into(), "schema".into()), ("attachments/def-456.pdf".into(), "verbale.pdf".into())]
        );
        assert_eq!(labeled("![](attachments/x.png)"), [("attachments/x.png".into(), "x.png".into())]);
    }

    #[test]
    fn reads_page_titles() {
        assert_eq!(page_title("<html><head><TITLE>\n  Granello &amp; Co.  </TITLE></head>").as_deref(), Some("Granello & Co."));
        assert_eq!(
            page_title(r#"<title>Generico</title><meta property="og:title" content="Titolo vero"/>"#).as_deref(),
            Some("Titolo vero")
        );
        assert_eq!(
            page_title(r#"<meta content='L&#39;articolo' property='og:title'>"#).as_deref(),
            Some("L'articolo")
        );
        assert_eq!(page_title("<p>niente titolo</p>"), None);
        assert_eq!(page_title("<title>   </title>"), None);
    }
}
