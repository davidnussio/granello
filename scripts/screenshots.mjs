// Schermate per la vetrina (dambox.ch), con i dati di esempio e l'anteprima nel browser.
//   pnpm screenshots            (avvia da sé l'anteprima su http://localhost:1430)
// Escono in shots/<lingua>/<schermata>.webp: 1440×900, tema scuro, cwebp -q 82 -m 6.
// Una copia va in docs/src/assets/shots/<lingua>/, per il sito di documentazione.
// Servono Google Chrome e cwebp (brew install webp).
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1430/preview.html";
const PORT = 9341;
const LANGS = ["it", "en"];

const text = {
  it: {
    transcript: "Trascrizione",
    library: "Libreria",
    notes: "Le mie note",
    items: "Elementi",
    recordings: "Registrazioni",
    templates: "Template",
    interview: "Colloquio",
    settings: "Impostazioni",
    find: "margine",
  },
  en: {
    transcript: "Transcript",
    library: "Library",
    notes: "My notes",
    items: "Items",
    recordings: "Recordings",
    templates: "Templates",
    interview: "Interview",
    settings: "Settings",
    find: "margin",
  },
};

const pause = "const wait = (ms) => new Promise((r) => setTimeout(r, ms));";
const setValue = (proto) => `Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set`;

// Privacy blindata e un pezzo di trascrizione selezionato: compaiono "Da verificare" e "Oscura".
const hardenAndSelect = `(async () => {
  ${pause}
  const level = document.querySelector(".privacy-select");
  ${setValue("HTMLSelectElement")}.call(level, "hardened");
  level.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(300);
  // dall'inizio, così in cima resta visibile il livello di privacy
  document.querySelector(".transcript").scrollTop = 0;
  await wait(200);
  const node = document.querySelectorAll(".transcript [data-seg]")[1].firstChild;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, Math.min(node.textContent.length, 46));
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await wait(300);
})()`;

// La scheda di un template: il suo nome compare anche tra i meeting, quindi si cerca tra le card.
const openTemplate = (name) => `(() => {
  const card = [...document.querySelectorAll(".tpl-card")].find((c) => c.textContent.startsWith(${JSON.stringify(name)}));
  if (!card) throw new Error("template non trovato");
  card.click();
})()`;

// Trova e sostituisci aperto su una parola della nota.
const find = (word) => `(async () => {
  ${pause}
  const note = document.querySelector(".doc .ProseMirror");
  note.focus();
  note.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", metaKey: true, bubbles: true, cancelable: true }));
  await wait(300);
  const field = document.querySelector(".find-bar input");
  ${setValue("HTMLInputElement")}.call(field, ${JSON.stringify(word)});
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(300);
})()`;

// Ogni schermata: i passi dopo il caricamento, in ordine. Una stringa è un clic sull'elemento
// con quel testo, `{ js }` è codice da eseguire nella pagina; `query` si aggiunge all'indirizzo.
const shots = (lang) => {
  const fixtures = JSON.parse(readFileSync(`preview/fixtures/${lang}.json`, "utf8"));
  const meeting = fixtures.details["demo-rinnovo"].meeting.title;
  const latest = fixtures.meetings[0].title;
  const l = text[lang];
  return [
    { name: "home", steps: [] },
    { name: "notes", steps: [meeting, l.notes] },
    { name: "transcript", steps: [meeting, l.transcript] },
    { name: "privacy", steps: [meeting, l.transcript, { js: hardenAndSelect }] },
    { name: "recording", query: "&rec", steps: [latest] },
    { name: "find", steps: [meeting, l.notes, { js: find(l.find) }] },
    { name: "library", steps: [l.library] },
    { name: "items", steps: [l.library, l.items] },
    { name: "recordings", steps: [l.library, l.recordings] },
    { name: "templates", steps: [l.templates, { js: openTemplate(l.interview) }] },
    { name: "settings", steps: [l.settings] },
  ];
};

async function waitFor(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await sleep(200);
  }
  throw new Error(`non risponde: ${url}`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const send = async (method, params = {}) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  return { send, close: () => ws.close() };
}

// Clic sull'elemento più interno il cui testo (senza icone iniziali) inizia con `label`.
const clickScript = (label) => `(() => {
  const all = [...document.querySelectorAll("body *")].filter(
    (el) =>
      el.textContent.replace(/^[^\\p{L}\\d]+/u, "").startsWith(${JSON.stringify(label)}) &&
      el.getClientRects().length,
  );
  const target = all.find((el) => ![...el.children].some((c) => all.includes(c)));
  if (!target) return false;
  (target.closest("button, a, [role=button], [role=option], li") ?? target).click();
  return true;
})()`;

let vite;
if (
  !(await fetch(BASE)
    .then((r) => r.ok)
    .catch(() => false))
) {
  execFileSync("pnpm", ["preview:data"], { stdio: "inherit" });
  vite = spawn("pnpm", ["exec", "vite", "--port", "1430", "--strictPort"], { stdio: "ignore" });
  await waitFor(BASE);
}

const profile = mkdtempSync(join(tmpdir(), "granello-shots-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "--hide-scrollbars",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const version = await (await waitFor(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = cdp(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = cdp(pages.find((p) => p.id === targetId).webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });

  for (const lang of LANGS) {
    const dir = join("shots", lang);
    mkdirSync(dir, { recursive: true });
    const docsDir = join("docs", "src", "assets", "shots", lang);
    mkdirSync(docsDir, { recursive: true });
    for (const shot of shots(lang)) {
      await page.send("Page.navigate", { url: `${BASE}?lang=${lang}&shots${shot.query ?? ""}` });
      await sleep(1500);
      for (const step of shot.steps) {
        if (typeof step === "string") {
          const { result } = await page.send("Runtime.evaluate", { expression: clickScript(step) });
          if (!result.value) throw new Error(`${lang}/${shot.name}: non trovo «${step}»`);
        } else {
          const { exceptionDetails } = await page.send("Runtime.evaluate", {
            expression: step.js,
            awaitPromise: true,
          });
          if (exceptionDetails)
            throw new Error(`${lang}/${shot.name}: ${exceptionDetails.exception?.description}`);
        }
        await sleep(700);
      }
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const png = join(profile, `${shot.name}.png`);
      writeFileSync(png, Buffer.from(data, "base64"));
      execFileSync("cwebp", ["-quiet", "-q", "82", "-m", "6", png, "-o", join(dir, `${shot.name}.webp`)]);
      copyFileSync(join(dir, `${shot.name}.webp`), join(docsDir, `${shot.name}.webp`));
      console.log(join(dir, `${shot.name}.webp`));
    }
  }
  page.close();
  browser.close();
} finally {
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  vite?.kill();
  rmSync(profile, { recursive: true, force: true });
}
