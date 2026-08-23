import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE = path.join(ROOT, "_site");

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, "assets"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "index.html"), path.join(SITE, "index.html"));
fs.writeFileSync(path.join(SITE, ".nojekyll"), "", "utf8");
fs.cpSync(path.join(ROOT, "src"), path.join(SITE, "src"), { recursive: true });
fs.cpSync(path.join(ROOT, "assets", "previews"), path.join(SITE, "assets", "previews"), { recursive: true });
fs.cpSync(path.join(ROOT, "assets", "authors"), path.join(SITE, "assets", "authors"), { recursive: true });

console.log(`Built ${SITE}`);
