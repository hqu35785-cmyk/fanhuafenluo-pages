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
  let injected = 0;
  let mirrored = 0;

  for (const [imagePath, createTime] of Object.entries(cards)) {
    if (createTime == null || createTime === "") continue;

    const image = escapeRegExp(imagePath);
    const imagePattern = new RegExp(`(\\"image\\":\\"${image}\\")`);
    const serialized = JSON.stringify(createTime);

    let next = source.replace(imagePattern, match => `${match},\"createTime\":${serialized}`);
    if (next !== source) injected += 1;

    const normalized = normalizeCreateTime(createTime);
    if (normalized) {
      const createdAtPattern = new RegExp(`(\\"image\\":\\"${image}\\"[^{}]*?\\"createdAt\\":\\")[^\\"]*(\\")`);
      const mirroredSource = next.replace(createdAtPattern, `$1${normalized}$2`);
      if (mirroredSource !== next) mirrored += 1;
      next = mirroredSource;
    }

    source = next;
  }

  fs.writeFileSync(worksPath, source, "utf8");
  return { injected, mirrored };
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
console.log(`createTime injected into deployed works.js: ${applied.injected}/${createTimes.found}`);
console.log(`createdAt compatibility mirror: ${applied.mirrored}/${createTimes.found}`);
if (createTimes.missing.length) {
  console.warn(`create_time missing: ${createTimes.missing.length}`);
}
if (createTimes.errors.length) {
  console.warn(`create_time parse errors: ${createTimes.errors.length}`);
}
