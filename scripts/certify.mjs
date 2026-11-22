// Certificazione: controlli sulla configurazione di rilascio che ogni versione deve passare.
// L'elenco completo dei requisiti, con i test Rust che li coprono, è in CERTIFICATION.md.
// Esce con codice 1 se un controllo fallisce.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));
const results = [];

/** Un requisito: `check` ritorna i problemi trovati (vuoto = superato). */
function req(id, title, check) {
  let problems;
  try {
    problems = check();
  } catch (e) {
    problems = [String(e?.message ?? e)];
  }
  results.push({ id, title, problems });
}

function files(dir, test) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, test) : test(p) ? [p] : [];
  });
}

/** Gli argomenti di una macro Rust da `start` (subito dopo la parentesi aperta) alla chiusa. */
function macroArgs(src, start) {
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/** Le chiavi di un plist semplice (dict piatto) con il loro valore. */
function plist(path) {
  const out = {};
  for (const m of read(path).matchAll(
    /<key>([^<]+)<\/key>\s*<(string|true|false)\s*\/?>(?:([^<]*)<\/string>)?/g,
  )) {
    out[m[1]] = m[2] === "string" ? m[3].trim() : m[2] === "true";
  }
  return out;
}

const tauri = json("src-tauri/tauri.conf.json");
const pkg = json("package.json");
const cargo = read("src-tauri/Cargo.toml");

// ---------------- identità e rilascio ----------------

req("C-REL-01", "L'identificatore resta ch.dambox.granello", () =>
  tauri.identifier === "ch.dambox.granello" ? [] : [`identifier è "${tauri.identifier}"`],
);

req("C-REL-02", "La versione è la stessa in package.json, Cargo.toml, Cargo.lock e tauri.conf.json", () => {
  const versions = {
    "package.json": pkg.version,
    "tauri.conf.json": tauri.version,
    "Cargo.toml": cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1],
    "Cargo.lock": read("src-tauri/Cargo.lock").match(/name = "granello"\nversion = "([^"]+)"/)?.[1],
  };
  const distinct = new Set(Object.values(versions));
  return distinct.size === 1 && !distinct.has(undefined)
    ? []
    : [
        Object.entries(versions)
          .map(([f, v]) => `${f}: ${v}`)
          .join(", "),
      ];
});

req("C-REL-03", "Gli aggiornamenti sono firmati e arrivano dalle release di GitHub", () => {
  const updater = tauri.plugins?.updater ?? {};
  const problems = [];
  const key = Buffer.from(updater.pubkey ?? "", "base64").toString();
  if (!key.includes("minisign public key")) problems.push("manca la chiave pubblica dell'updater");
  const endpoints = updater.endpoints ?? [];
  if (endpoints.length === 0) problems.push("nessun endpoint per gli aggiornamenti");
  for (const e of endpoints) {
    if (!e.startsWith("https://github.com/davidnussio/granello/releases/"))
      problems.push(`endpoint inatteso: ${e}`);
  }
  return problems;
});

req("C-REL-04", "La CI crea solo bozze di release: la pubblicazione la decide David", () => {
  const workflow = read(".github/workflows/release.yml");
  return /^\s*draft:\s*true\b/m.test(workflow) ? [] : ["release.yml non crea la release come bozza"];
});

req("C-REL-05", "Nessun segreto nei file del repository", () => {
  const patterns = [
    [/untrusted comment: [a-z]+ encrypted secret key/, "chiave privata dell'updater"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "chiave privata PEM"],
    [/sk-ant-[A-Za-z0-9_-]{20,}/, "API key di Anthropic"],
    [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, "API key in stile OpenAI"],
    [/TAURI_SIGNING_PRIVATE_KEY\s*[:=]\s*["']?[A-Za-z0-9+/=]{40,}/, "chiave di firma in chiaro"],
  ];
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const problems = [];
  for (const f of tracked) {
    if (f === "scripts/certify.mjs" || !existsSync(f) || statSync(f).size > 2_000_000) continue;
    const buf = readFileSync(f);
    if (buf.includes(0)) continue; // binario
    const text = buf.toString("utf8");
    for (const [re, what] of patterns) if (re.test(text)) problems.push(`${f}: ${what}`);
  }
  return problems;
});

// ---------------- macOS e sandbox ----------------

req("C-MAC-01", "Il Mac spiega perché chiede microfono e audio della call", () => {
  const info = plist("src-tauri/Info.plist");
  return ["NSMicrophoneUsageDescription", "NSAudioCaptureUsageDescription"]
    .filter((k) => typeof info[k] !== "string" || info[k].length < 20)
    .map((k) => `${k} manca o è troppo corta`);
});

req("C-MAC-02", "La versione minima di macOS è quella promessa nella documentazione", () => {
  const min = tauri.bundle?.macOS?.minimumSystemVersion;
  const major = min?.split(".")[0];
  const problems = [];
  if (!major) return ["minimumSystemVersion non impostata"];
  for (const [doc, phrase] of [
    ["docs/src/content/docs/start/install.md", `macOS ${major} or later`],
    ["docs/src/content/docs/it/start/install.md", `macOS ${major} o successivo`],
  ]) {
    if (!read(doc).includes(phrase)) problems.push(`${doc} non dice "${phrase}"`);
  }
  return problems;
});

req("C-SEC-01", "L'app chiede solo i permessi che usa (entitlement)", () => {
  const expected = ["com.apple.security.device.audio-input", "com.apple.security.network.client"];
  const actual = Object.entries(plist("src-tauri/entitlements.plist"))
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const extra = actual.filter((k) => !expected.includes(k));
  const missing = expected.filter((k) => !actual.includes(k));
  return [...extra.map((k) => `entitlement non previsto: ${k}`), ...missing.map((k) => `manca ${k}`)];
});

req("C-SEC-02", "L'interfaccia ha solo i permessi Tauri previsti", () => {
  const expected = [
    "core:default",
    "core:window:allow-start-dragging",
    "notification:default",
    "opener:default",
  ];
  const problems = [];
  for (const f of files("src-tauri/capabilities", (p) => p.endsWith(".json"))) {
    for (const perm of json(f).permissions ?? []) {
      const id = typeof perm === "string" ? perm : perm.identifier;
      if (!expected.includes(id)) problems.push(`${f}: permesso non previsto ${id}`);
    }
  }
  return problems;
});

req("C-SEC-03", "La CSP non permette script esterni né connessioni dirette dall'interfaccia", () => {
  const csp = tauri.app?.security?.csp ?? "";
  const directives = Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name, values]),
  );
  const problems = [];
  if (!csp) return ["CSP assente"];
  if (csp.includes("'unsafe-eval'")) problems.push("'unsafe-eval' nella CSP");
  const scripts = directives["script-src"] ?? directives["default-src"] ?? [];
  if (scripts.some((s) => s !== "'self'")) problems.push(`script ammessi da: ${scripts.join(" ")}`);
  // tutta la rete passa dal backend Rust, che applica le regole di privacy
  const connect = directives["connect-src"] ?? [];
  if (connect.some((c) => !["ipc:", "http://ipc.localhost"].includes(c))) {
    problems.push(`connect-src ammette: ${connect.join(" ")}`);
  }
  return problems;
});

// ---------------- privacy ----------------

req("C-PRIV-03", "Nessun log formatta note, trascrizioni, titoli, chiavi o indirizzi", () => {
  const forbidden =
    /\b(notes?|notes_md|enhanced_md|transcript|segments?|text|title|content|body|api_key|key|secret|token|url|ics|question|answer|prompt|instruction|attendees)\b/;
  const problems = [];
  for (const f of files("src-tauri/src", (p) => p.endsWith(".rs"))) {
    const src = read(f);
    for (const m of src.matchAll(/\blog::(?:trace|debug|info|warn|error)!\(/g)) {
      const call = macroArgs(src, m.index + m[0].length);
      // i segnaposto nel testo ({nome}) e gli argomenti dopo il testo
      const literal = call.match(/^\s*"((?:[^"\\]|\\.)*)"/);
      const placeholders = literal ? [...literal[1].matchAll(/\{([a-z_][a-z0-9_.]*)/g)].map((p) => p[1]) : [];
      const args = literal ? call.slice(literal[0].length) : call;
      const hit = [...placeholders, args].find((part) =>
        forbidden.test(part.replace(/"(?:[^"\\]|\\.)*"/g, "")),
      );
      if (hit !== undefined) {
        const line = src.slice(0, m.index).split("\n").length;
        problems.push(`${relative(".", f)}:${line}: ${(m[0] + call).replace(/\s+/g, " ").slice(0, 120)})`);
      }
    }
  }
  return problems;
});

// ---------------- documentazione ----------------

/** Le pagine di una cartella della documentazione, senza estensione. */
const pages = (dir) =>
  files(dir, (p) => /\.mdx?$/.test(p)).map((p) => relative(dir, p).replace(/\.mdx?$/, ""));

req("C-DOC-01", "Ogni pagina della documentazione esiste in inglese e in italiano", () => {
  const root = "docs/src/content/docs";
  const en = pages(root).filter((p) => !p.startsWith("it/"));
  const it = pages(join(root, "it"));
  return [
    ...en.filter((p) => !it.includes(p)).map((p) => `manca la versione italiana di ${p}`),
    ...it.filter((p) => !en.includes(p)).map((p) => `manca la versione inglese di ${p}`),
  ];
});

// ---------------- esito ----------------

let failed = 0;
for (const { id, title, problems } of results) {
  if (problems.length === 0) {
    console.log(`✓ ${id}  ${title}`);
  } else {
    failed++;
    console.log(`✗ ${id}  ${title}`);
    for (const p of problems) console.log(`    ${p}`);
  }
}
console.log(
  failed === 0
    ? `\nCertificazione: ${results.length} controlli superati. I test Rust: cargo test certification`
    : `\nCertificazione: ${failed} controlli su ${results.length} non superati.`,
);
process.exit(failed === 0 ? 0 : 1);
