// Fails when the built bundle grows past its budget. Run after `npm run build`.
// Budgets are gzip bytes (what users download), about 10% above the size at
// the time they were set. Raise one deliberately when growth is intended.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGETS = {
  largestJs: 700_000, // biggest single JS/MJS chunk (the app entry)
  totalJs: 1_250_000, // all JS/MJS chunks together, incl. pdf worker (1.214 MB after draft figures, #1056; raised deliberately per QA)
  totalCss: 16_000, // all CSS together (14.98 KB after draft figures, #1056; raised deliberately per QA)
};

const dir = join(import.meta.dirname, "..", "dist", "assets");
const files = readdirSync(dir)
  .filter((f) => /\.(js|mjs|css)$/.test(f))
  .map((f) => {
    const buf = readFileSync(join(dir, f));
    return { name: f, kind: f.endsWith(".css") ? "css" : "js", raw: buf.length, gzip: gzipSync(buf).length };
  })
  .sort((a, b) => b.gzip - a.gzip);

if (files.length === 0) {
  console.error(`No JS/CSS found in ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(1).padStart(9) + " KB";
console.log("file".padEnd(40), "raw".padStart(12), "gzip".padStart(12));
for (const f of files) console.log(f.name.padEnd(40), kb(f.raw), kb(f.gzip));

const js = files.filter((f) => f.kind === "js");
const css = files.filter((f) => f.kind === "css");
const sum = (xs) => xs.reduce((s, f) => s + f.gzip, 0);
const checks = [
  { label: `largest JS chunk (${js[0]?.name})`, actual: js[0]?.gzip ?? 0, budget: BUDGETS.largestJs },
  { label: "total JS", actual: sum(js), budget: BUDGETS.totalJs },
  { label: "total CSS", actual: sum(css), budget: BUDGETS.totalCss },
];

console.log();
let failed = false;
for (const c of checks) {
  const over = c.actual > c.budget;
  failed ||= over;
  console.log(`${over ? "FAIL" : "ok  "} ${c.label}: ${c.actual} gzip bytes, budget ${c.budget}`);
  if (over) console.error(`Over budget: ${c.label} is ${c.actual} gzip bytes, budget is ${c.budget} (+${c.actual - c.budget}).`);
}
process.exit(failed ? 1 : 0);
