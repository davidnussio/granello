//! Lingua dei testi che il backend mostra all'utente (errori, notifiche, template di sistema).
//! L'italiano è la lingua sorgente; ogni testo porta con sé la traduzione inglese.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    It,
    En,
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn lang() -> Lang {
    if CURRENT.load(Ordering::Relaxed) == 1 {
        Lang::En
    } else {
        Lang::It
    }
}

/// Lingua del sistema operativo: italiano se il Mac è in italiano, altrimenti inglese.
fn system() -> Lang {
    from_locale(&sys_locale::get_locale().unwrap_or_default())
}

fn from_locale(locale: &str) -> Lang {
    if locale.to_ascii_lowercase().starts_with("it") {
        Lang::It
    } else {
        Lang::En
    }
}

/// `setting`: "it", "en" oppure "system" (o qualsiasi altro valore) per seguire il sistema.
pub fn resolve(setting: &str) -> Lang {
    match setting {
        "it" => Lang::It,
        "en" => Lang::En,
        _ => system(),
    }
}

pub fn set(lang: Lang) {
    CURRENT.store(if lang == Lang::En { 1 } else { 0 }, Ordering::Relaxed);
}

/// Testo fisso nella lingua corrente.
pub fn tr(it: &'static str, en: &'static str) -> &'static str {
    match lang() {
        Lang::It => it,
        Lang::En => en,
    }
}

/// Come `format!`, con il formato italiano e quello inglese.
#[macro_export]
macro_rules! trf {
    ($it:literal, $en:literal $(, $($arg:tt)*)?) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::It => format!($it $(, $($arg)*)?),
            $crate::i18n::Lang::En => format!($en $(, $($arg)*)?),
        }
    };
}

/// Come `anyhow!`, con il formato italiano e quello inglese.
#[macro_export]
macro_rules! tra {
    ($($t:tt)*) => { anyhow::anyhow!("{}", $crate::trf!($($t)*)) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_language() {
        assert_eq!(resolve("it"), Lang::It);
        assert_eq!(resolve("en"), Lang::En);
        assert_eq!(from_locale("it-CH"), Lang::It);
        assert_eq!(from_locale("IT_it"), Lang::It);
        assert_eq!(from_locale("de-CH"), Lang::En);
        assert_eq!(from_locale(""), Lang::En);
    }
}
