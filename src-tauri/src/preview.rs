//! Dati per l'anteprima dell'interfaccia nel browser (`pnpm preview`): il
//! database vero con i meeting di esempio, letto con le stesse funzioni dei
//! comandi e salvato come JSON in `preview/fixtures/<lingua>.json`.
//! Si genera con `cargo test --lib preview_fixtures -- --ignored`.

#[cfg(test)]
mod tests {
    use crate::db::Db;
    use crate::i18n::{self, Lang};
    use crate::models::MeetingDetail;
    use serde_json::{json, Map, Value};
    use std::path::PathBuf;

    #[test]
    #[ignore = "genera i dati dell'anteprima, non è un controllo"]
    fn preview_fixtures() {
        let out = std::env::var("PREVIEW_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../preview/fixtures"));
        std::fs::create_dir_all(&out).unwrap();

        for (lang, code) in [(Lang::It, "it"), (Lang::En, "en")] {
            i18n::set(lang);
            let db = Db::open_in_memory().unwrap();
            db.seed_templates().unwrap();
            db.insert_demo(&crate::demo::load(lang).unwrap()).unwrap();

            let mut settings = serde_json::to_value(db.get_settings().unwrap()).unwrap();
            settings["uiLanguage"] = json!(code);
            settings["language"] = json!(code);

            let summaries = db.list_meetings(None).unwrap();
            let mut meetings = Map::new();
            for s in &summaries {
                let meeting = db.get_meeting(&s.id).unwrap().unwrap();
                let segments = db.segments(&s.id).unwrap();
                meetings.insert(s.id.clone(), serde_json::to_value(MeetingDetail { meeting, segments }).unwrap());
            }

            let data = json!({
                "settings": settings,
                "meetings": summaries,
                "details": Value::Object(meetings),
                "tags": db.all_tags().unwrap(),
                "people": db.list_people().unwrap(),
                "projects": db.list_projects().unwrap(),
                "groups": db.list_groups().unwrap(),
                "items": db.list_items().unwrap(),
                "templates": db.list_templates().unwrap(),
                "demoCount": db.demo_count().unwrap(),
                "whisperModels": crate::transcribe::model_catalog(std::path::Path::new("/nonexistent")),
            });
            let path = out.join(format!("{code}.json"));
            std::fs::write(&path, serde_json::to_string(&data).unwrap()).unwrap();
            println!("{}", path.display());
        }
    }
}
