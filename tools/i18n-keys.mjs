// Lists every translation key and checks the language packs against it.
//   node tools/i18n-keys.mjs          writes src/game/i18n/keys.json (sorted) and prints a coverage report
//   node tools/i18n-keys.mjs --check  exits 1 if a pack misses a key or breaks a placeholder
// Keys come from two places:
//   1. t("…") / t('…') / t(`…`) calls with a literal first argument anywhere under src/ (client code)
//   2. every Korean string literal in the shared data files (names, quest and story text), which the client
//      passes to t() where it shows them (src/shared stays Korean: the server uses it too)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "src");
const PACKS = ["en", "ja", "zh-Hant", "zh-Hans"];
const SHARED_DATA = ["story.ts", "world.ts", "items.ts", "combat.ts", "growth.ts", "types.ts", "book.ts", "rank.ts"];
const HANGUL = /[가-힣]/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Drop comments, keeping strings intact (a small scanner, enough for this code base). */
function stripComments(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2); i = i < 0 ? src.length : i + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; let j = i + 1;
      while (j < src.length && src[j] !== q) { if (src[j] === "\\") j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function unescape(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|n|t|\\|"|'|`|\$)/g, (_m, e) => {
    if (e === "n") return "\n";
    if (e === "t") return "\t";
    if (e[0] === "u") return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ""), 16));
    return e;
  });
}

const keys = new Map(); // key -> first place seen
const dynamic = [];
// the particle table in story.ts (fillName) is grammar, not text
const SKIP = new Set(["(이)", "이", "가", "은", "는", "을", "를", "아", "야", "과", "와"]);
const add = (k, where) => { if (HANGUL.test(k) && !SKIP.has(k) && !keys.has(k)) keys.set(k, where); };

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const code = stripComments(fs.readFileSync(file, "utf8"));
  // 1. t("…") calls
  const call = /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let m; (m = call.exec(code)); ) {
    if (m[1] === "`" && m[2].includes("${")) { dynamic.push(`${rel}: t(\`${m[2].slice(0, 40)}…\`)`); continue; }
    add(unescape(m[2]), rel);
  }
  // 2. shared data literals
  if (rel.startsWith("src/shared/") && SHARED_DATA.includes(path.basename(file))) {
    const lit = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    for (let m; (m = lit.exec(code)); ) {
      if (m[1] === "`" && m[2].includes("${")) continue; // built at run time; the client translates those itself
      add(unescape(m[2]), rel);
    }
  }
}

const sorted = [...keys.keys()].sort();
const keysFile = path.join(SRC, "game", "i18n", "keys.json");
const check = process.argv.includes("--check");
if (!check) fs.writeFileSync(keysFile, JSON.stringify(sorted, null, 1) + "\n");

const ph = (s) => (s.match(/\{[^}]*\}/g) ?? []).map((p) => p.replace(/^\{이름\/[^}]*\}$/, "{이름}")).sort().join(" ");
let bad = 0;
for (const lang of PACKS) {
  const f = path.join(SRC, "game", "i18n", `${lang}.json`);
  const pack = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  const missing = sorted.filter((k) => typeof pack[k] !== "string" || !pack[k].trim());
  const broken = sorted.filter((k) => typeof pack[k] === "string" && ph(k).replace(/\{이름\}/g, "") !== ph(pack[k]).replace(/\{이름\}/g, ""));
  const nameLost = sorted.filter((k) => typeof pack[k] === "string" && /\{이름/.test(k) && !/\{이름\}/.test(pack[k]));
  const stale = Object.keys(pack).filter((k) => !keys.has(k));
  console.log(`${lang}: ${sorted.length - missing.length}/${sorted.length} translated, ${broken.length} placeholder mismatches, ${nameLost.length} lost {이름}, ${stale.length} unused`);
  if (check && (missing.length || broken.length || nameLost.length)) {
    bad++;
    for (const k of [...missing.slice(0, 5)]) console.log(`  missing: ${k}`);
    for (const k of [...broken.slice(0, 5)]) console.log(`  placeholders: ${k}  →  ${pack[k]}`);
    for (const k of [...nameLost.slice(0, 5)]) console.log(`  {이름} lost: ${k}  →  ${pack[k]}`);
  }
}
if (dynamic.length) console.log(`t() with \${} inside (not translatable, use {placeholders}):\n  ${dynamic.join("\n  ")}`);
console.log(`${sorted.length} keys${check ? "" : ` → ${path.relative(ROOT, keysFile)}`}`);
process.exit(check && (bad || dynamic.length) ? 1 : 0);
