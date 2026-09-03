import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE = path.join(ROOT, "_site");
const INDEX = path.join(SITE, "index.html");

function fail(message) {
  throw new Error(`[pages-site] ${message}`);
}

function hash12(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim();
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

function files(dir, extension) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...files(full, extension));
    else if (!extension || entry.name.toLowerCase().endsWith(extension)) result.push(full);
  }
  return result;
}

if (!fs.existsSync(INDEX)) fail("_site/index.html is missing");
const html = fs.readFileSync(INDEX, "utf8");
for (const file of files(SITE, ".png")) fail(`full PNG leaked into Pages artifact: ${file}`);
const previewFiles = files(path.join(SITE, "assets", "previews"), ".webp");
if (previewFiles.length !== 102) fail(`expected 102 preview WebPs, found ${previewFiles.length}`);
for (const file of files(path.join(SITE, "src"), ".js")) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail(`Pages JavaScript syntax error: ${file}\n${result.stderr}`);
}
const cssHash = hash12(path.join(ROOT, "src", "styles", "main.css"));
const dataHash = hash12(path.join(ROOT, "src", "data", "works.js"));
const appHash = hash12(path.join(ROOT, "src", "app.js"));
if (!html.includes(`src/styles/main.css?v=${cssHash}`)) fail("Pages HTML CSS hash is stale");
if (!html.includes(`src/data/works.js?v=${dataHash}`)) fail("Pages HTML data hash is stale");
if (!html.includes(`src/app.js?v=${appHash}`)) fail("Pages HTML app hash is stale");
for (const match of html.matchAll(/(?:src|href)="(src|assets)\/([^"?#]+)(?:\?[^"#]*)?"/g)) {
  const file = path.join(SITE, match[1], decodeURI(match[2]));
  if (!fs.existsSync(file)) fail(`HTML references missing Pages file: ${file}`);
}
console.log(JSON.stringify({ ok: true, previewCount: previewFiles.length, pngCount: 0, cssHash, dataHash, appHash }, null, 2));
