import fs from "node:fs";
import path from "node:path";
import { extractCreateTimes } from "./extract_create_times.mjs";

const ROOT = process.cwd();
const SITE = path.join(ROOT, "_site");

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

console.log(`Built ${SITE}`);
console.log(`create_time: ${createTimes.found}/${createTimes.total} cards found`);
if (createTimes.missing.length) {
  console.warn(`create_time missing: ${createTimes.missing.length}`);
}
if (createTimes.errors.length) {
  console.warn(`create_time parse errors: ${createTimes.errors.length}`);
}
