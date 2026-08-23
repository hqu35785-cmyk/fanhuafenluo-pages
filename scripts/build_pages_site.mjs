import fs from "node:fs";
import path from "node:path";
import { extractCreateTimes } from "./extract_create_times.mjs";

const ROOT = process.cwd();
const SITE = path.join(ROOT, "_site");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCreateTime(value) {
  if (value == null || value === "") return "";

  const raw = String(value).trim();
  const dateMatch = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
  }

  if (/^\d{10}$/.test(raw)) {
    const date = new Date(Number(raw) * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  if (/^\d{13}$/.test(raw)) {
    const date = new Date(Number(raw));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return "";
}

function applyCreateTimesToWorks(worksPath, cards) {
  let source = fs.readFileSync(worksPath, "utf8");
  let applied = 0;

  for (const [imagePath, createTime] of Object.entries(cards)) {
    const normalized = normalizeCreateTime(createTime);
    if (!normalized) continue;

    const image = escapeRegExp(imagePath);
    const pattern = new RegExp(`(\\"image\\":\\"${image}\\"[^{}]*?\\"createdAt\\":\\")[^\\"]*(\\")`);

    const next = source.replace(pattern, `$1${normalized}$2`);
    if (next !== source) {
      source = next;
      applied += 1;
    }
  }

  fs.writeFileSync(worksPath, source, "utf8");
  return applied;
}

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, "assets"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "index.html"), path.join(SITE, "index.html"));
fs.writeFileSync(path.join(SITE, ".nojekyll"), "", "utf8");
fs.cpSync(path.join(ROOT, "src"), path.join(SITE, "src"), { recursive: true });
fs.cpSync(path.join(ROOT, "assets", "previews"), path.join(SITE, "assets", "previews"), { recursive: true });
fs.cpSync(path.join(ROOT, "assets", "authors"), path.join(SITE, "assets", "authors"), { recursive: true });

const createTimes = extractCreateTimes({ root: ROOT });
const createTimesPath = path.join(SITE, "src", "data", "create-times.json");
fs.writeFileSync(
  createTimesPath,
  `${JSON.stringify(createTimes, null, 2)}\n`,
  "utf8"
);

const deployedWorksPath = path.join(SITE, "src", "data", "works.js");
const applied = applyCreateTimesToWorks(deployedWorksPath, createTimes.cards);

console.log(`Built ${SITE}`);
console.log(`create_time extracted: ${createTimes.found}/${createTimes.total}`);
console.log(`create_time applied to deployed works.js: ${applied}/${createTimes.found}`);
if (createTimes.missing.length) {
  console.warn(`create_time missing: ${createTimes.missing.length}`);
}
if (createTimes.errors.length) {
  console.warn(`create_time parse errors: ${createTimes.errors.length}`);
}
