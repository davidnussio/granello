// Verifica che ogni testo passato a t("…") abbia una traduzione inglese
// e che il dizionario non contenga chiavi non più usate.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

const literal = /"(?:[^"\\]|\\.)*"/;
const used = new Set();
for (const f of files("src")) {
  if (f.includes("/i18n/")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(new RegExp(`\\bt\\(\\s*(${literal.source})`, "g"))) used.add(JSON.parse(m[1]));
}

// chiavi calcolate a runtime (t(variabile)): elencate qui perché l'analisi statica non le vede
const dynamic = [
  "Titolo",
  "Sezione",
  "Sottosezione",
  "Italiano",
  "Tedesco",
  "Francese",
  "Inglese",
  "Rilevamento automatico",
  "Altro",
  "Server personalizzato",
];

const dictSrc = readFileSync("src/i18n/en.ts", "utf8");
const keys = new Set();
for (const m of dictSrc.matchAll(
  new RegExp(`^\\s*(${literal.source}|[\\p{L}_$][\\p{L}\\p{N}_$]*):`, "gmu"),
)) {
  keys.add(m[1].startsWith('"') ? JSON.parse(m[1]) : m[1]);
}

// i nomi propri restano uguali in tutte le lingue
const same = new Set(["LM Studio", "Ollama", "OpenAI"]);
const missing = [...used, ...dynamic].filter((k) => !keys.has(k) && !same.has(k));
const unused = [...keys].filter((k) => !used.has(k) && !dynamic.includes(k));

for (const k of missing) console.error(`manca la traduzione inglese: ${JSON.stringify(k)}`);
for (const k of unused) console.error(`traduzione non più usata: ${JSON.stringify(k)}`);
if (missing.length || unused.length) process.exit(1);
console.log(`i18n ok: ${used.size + dynamic.length} testi tradotti`);
