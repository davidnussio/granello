// Schermate per la vetrina (dambox.ch), con i dati di esempio e l'anteprima nel browser.
//   pnpm screenshots            (avvia da sé l'anteprima su http://localhost:1430)
// Escono in shots/<lingua>/<schermata>.webp: 1440×900, tema scuro, cwebp -q 82 -m 6.
// Servono Google Chrome e cwebp (brew install webp).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1430/preview.html";
const PORT = 9341;
const LANGS = ["it", "en"];

const text = {
  it: { transcript: "Trascrizione", library: "Libreria" },
  en: { transcript: "Transcript", library: "Library" },
};

// Ogni schermata: cosa cliccare dopo il caricamento, in ordine.
const shots = (lang) => {
  const fixtures = JSON.parse(readFileSync(`preview/fixtures/${lang}.json`, "utf8"));
  const meeting = fixtures.details["demo-rinnovo"].meeting.title;
  return [
    { name: "home", clicks: [] },
    { name: "notes", clicks: [meeting] },
    { name: "transcript", clicks: [meeting, text[lang].transcript] },
    { name: "library", clicks: [text[lang].library] },
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
    for (const shot of shots(lang)) {
      await page.send("Page.navigate", { url: `${BASE}?lang=${lang}&shots` });
      await sleep(1500);
      for (const label of shot.clicks) {
        const { result } = await page.send("Runtime.evaluate", { expression: clickScript(label) });
        if (!result.value) throw new Error(`${lang}/${shot.name}: non trovo «${label}»`);
        await sleep(700);
      }
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const png = join(profile, `${shot.name}.png`);
      writeFileSync(png, Buffer.from(data, "base64"));
      execFileSync("cwebp", ["-quiet", "-q", "82", "-m", "6", png, "-o", join(dir, `${shot.name}.webp`)]);
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
