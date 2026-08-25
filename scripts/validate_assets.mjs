import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "src", "data", "works.js");
const APP = path.join(ROOT, "src", "app.js");
const PREVIEW_ROOT = path.join(ROOT, "assets", "previews");

function fail(message) {
  throw new Error(`[assets] ${message}`);
}

function extractArray(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
  if (!match) fail(`missing static array ${name}`);
  const value = JSON.parse(match[1]);
  if (!Array.isArray(value)) fail(`${name} is not an array`);
  return value;
}

function assetPath(value) {
  if (typeof value !== "string" || !value.startsWith("assets/")) fail(`invalid asset path ${value}`);
  const decoded = decodeURI(value);
  const full = path.resolve(ROOT, decoded);
  if (full !== ROOT && !full.startsWith(`${ROOT}${path.sep}`)) fail(`asset escapes repository ${value}`);
  return full;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function pngState(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail(`invalid PNG signature ${file}`);
  let offset = 8;
  let charaCount = 0;
  let iendEnd = -1;
  const charaPayloads = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) fail(`truncated PNG chunk ${file}`);
    if (type === "tEXt") {
      const data = bytes.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul >= 0 && data.subarray(0, nul).toString("latin1") === "chara") {
        charaCount += 1;
        charaPayloads.push(data.subarray(nul + 1).toString("latin1"));
      }
    }
    offset = chunkEnd;
    if (type === "IEND") {
      iendEnd = offset;
      break;
    }
  }
  if (iendEnd !== bytes.length) fail(`PNG IEND is missing or trailing data exists ${file}`);
  return { charaCount, charaPayloads };
}

function decodeChara(payload) {
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function walkWebpFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkWebpFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".webp")) result.push(path.resolve(full));
  }
  return result;
}

async function main() {
  const source = fs.readFileSync(DATA, "utf8");
  const latest = extractArray(source, "latestFanhuaWorks");
  const publicWorks = [
    ...extractArray(source, "publicWorks"),
    ...extractArray(source, "legacySharkWorks"),
    ...extractArray(source, "legacyWaWorks"),
  ];
  const authors = [
    { name: "繁花·纷落", works: [...latest, ...extractArray(source, "fanhuaWorks")] },
    { name: "公开", works: publicWorks },
  ];
  const expectedCounts = { "繁花·纷落": 70, "公开": 31 };
  const counts = Object.fromEntries(authors.map((author) => [author.name, author.works.length]));
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) fail(`counts ${JSON.stringify(counts)}`);
  const works = authors.flatMap((author) => author.works);
  const pairs = works.map((work) => `${work.name}\u0000${work.alias}`);
  const images = works.map((work) => work.image);
  if (new Set(pairs).size !== pairs.length) fail("duplicate name/alias combination");
  if (new Set(images).size !== images.length) fail("duplicate source image path");
  if (!fs.readFileSync(APP, "utf8").includes("const PREVIEW_LOAD_CONCURRENCY=3;")) fail("preview concurrency is not 3");

  const newNames = new Set(["刻律德菈", "云璃", "雾矢葵"]);
  const publicAssets = new Map([
    ["assets/public/Public_%E8%B0%83%E6%9C%88%E8%8E%89%E9%9F%B3_0BB6.png", "调月莉音"],
    ["assets/public/Public_%E8%AE%A4%E7%9F%A5%E4%BF%AE%E6%94%B9%C2%B7%E5%90%8E%E5%AE%AB%E6%80%A7%E7%94%9F%E6%B4%BB_14FA.png", "认知修改·后宫性生活"],
    ["assets/public/Public_%E6%98%9F%E9%87%8E_1BB2.png", "星野"],
  ]);
  const expectedPreviews = new Set();
  let sourceBytes = 0;
  let previewBytes = 0;
  let completeChara = 0;
  const newAssetReport = [];
  for (const work of works) {
    const png = assetPath(work.image);
    const webp = assetPath(work.preview);
    if (!fs.existsSync(png)) fail(`missing PNG ${png}`);
    if (!fs.existsSync(webp)) fail(`missing WebP ${webp}`);
    if (!png.toLowerCase().endsWith(".png") || !webp.toLowerCase().endsWith(".webp")) fail(`bad extension ${work.name}`);
    const pngInfo = pngState(png);
    if (pngInfo.charaCount === 1) completeChara += 1;
    const publicAssetName = publicAssets.get(work.image);
    if (newNames.has(work.name) || publicAssetName) {
      if (pngInfo.charaCount !== 1) fail(`new PNG must have exactly one chara chunk ${work.name}`);
      const decoded = decodeChara(pngInfo.charaPayloads[0]);
      const embeddedName = decoded?.data?.name || decoded?.name || "";
      const embeddedCreator = decoded?.data?.creator || decoded?.creator || "";
      if (embeddedName !== (publicAssetName || work.name)) fail(`embedded name mismatch ${work.name}/${embeddedName}`);
      if (embeddedCreator !== "『繁花·纷落』") fail(`embedded creator mismatch ${work.name}/${embeddedCreator}`);
      newAssetReport.push({ name: work.name, sha256: sha256(png), embeddedName, embeddedCreator });
    }
    const meta = await sharp(webp).metadata();
    if (meta.format !== "webp" || !meta.width || !meta.height) fail(`WebP cannot be decoded ${webp}`);
    const compactPreview = newNames.has(work.name) || Boolean(publicAssetName);
    const maxWidth = compactPreview ? 640 : 960;
    const maxHeight = compactPreview ? 960 : 1440;
    if (meta.width > maxWidth || meta.height > maxHeight) fail(`WebP exceeds ${maxWidth}x${maxHeight} ${webp}`);
    if (fs.statSync(webp).size > 200 * 1024) fail(`WebP exceeds 200 KiB ${webp}`);
    expectedPreviews.add(webp);
    sourceBytes += fs.statSync(png).size;
    previewBytes += fs.statSync(webp).size;
  }
  const actualPreviews = new Set(walkWebpFiles(PREVIEW_ROOT));
  if (actualPreviews.size !== expectedPreviews.size || [...expectedPreviews].some((file) => !actualPreviews.has(file))) {
    fail(`preview set mismatch expected=${expectedPreviews.size} actual=${actualPreviews.size}`);
  }
  if (previewBytes > 8 * 1024 * 1024) fail("combined preview budget exceeds 8 MiB");
  console.log(JSON.stringify({
    ok: true,
    counts,
    total: works.length,
    previews: actualPreviews.size,
    completeChara,
    sourceMiB: +(sourceBytes / 1024 / 1024).toFixed(2),
    previewMiB: +(previewBytes / 1024 / 1024).toFixed(2),
    newAssets: newAssetReport,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
