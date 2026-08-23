import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodeLocalPath(urlPath) {
  const clean = String(urlPath || "").split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function readTextChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG file");
  }

  const chunks = [];
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      throw new Error(`truncated PNG chunk ${type}`);
    }

    const data = buffer.subarray(dataStart, dataEnd);

    try {
      if (type === "tEXt") {
        const zero = data.indexOf(0);
        if (zero >= 0) {
          chunks.push({
            keyword: data.subarray(0, zero).toString("latin1"),
            text: data.subarray(zero + 1).toString("utf8")
          });
        }
      } else if (type === "zTXt") {
        const zero = data.indexOf(0);
        if (zero >= 0 && zero + 2 <= data.length) {
          const compressed = data.subarray(zero + 2);
          chunks.push({
            keyword: data.subarray(0, zero).toString("latin1"),
            text: zlib.inflateSync(compressed).toString("utf8")
          });
        }
      } else if (type === "iTXt") {
        const keywordEnd = data.indexOf(0);
        if (keywordEnd >= 0 && keywordEnd + 3 <= data.length) {
          let cursor = keywordEnd + 1;
          const compressionFlag = data[cursor++];
          cursor += 1; // compression method

          const languageEnd = data.indexOf(0, cursor);
          if (languageEnd < 0) throw new Error("invalid iTXt language tag");
          cursor = languageEnd + 1;

          const translatedEnd = data.indexOf(0, cursor);
          if (translatedEnd < 0) throw new Error("invalid iTXt translated keyword");
          cursor = translatedEnd + 1;

          let textData = data.subarray(cursor);
          if (compressionFlag === 1) textData = zlib.inflateSync(textData);

          chunks.push({
            keyword: data.subarray(0, keywordEnd).toString("latin1"),
            text: textData.toString("utf8")
          });
        }
      }
    } catch (error) {
      // One malformed ancillary chunk should not make the whole card unreadable.
      chunks.push({ keyword: type, text: "", error: String(error?.message || error) });
    }

    offset = dataEnd + 4; // skip CRC
    if (type === "IEND") break;
  }

  return chunks;
}

function normalizeKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCreateTime(value, depth = 0, seen = new Set()) {
  if (depth > 16 || value == null) return undefined;

  if (typeof value === "object") {
    if (seen.has(value)) return undefined;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findCreateTime(item, depth + 1, seen);
        if (found !== undefined) return found;
      }
      return undefined;
    }

    for (const [key, child] of Object.entries(value)) {
      if (normalizeKey(key) === "createtime" && child !== "" && child != null) {
        return child;
      }
    }

    for (const child of Object.values(value)) {
      const found = findCreateTime(child, depth + 1, seen);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.length > 8_000_000) return undefined;

    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        return findCreateTime(JSON.parse(text), depth + 1, seen);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function parseCandidate(text) {
  const raw = String(text || "").trim();
  if (!raw) return undefined;

  const candidates = [raw];

  if (/^data:application\/json;base64,/i.test(raw)) {
    candidates.push(Buffer.from(raw.replace(/^data:application\/json;base64,/i, ""), "base64").toString("utf8"));
  } else if (raw.length >= 16 && raw.length % 4 === 0 && /^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8").trim();
      if (decoded) candidates.push(decoded);
    } catch {
      // Ignore invalid base64 and keep trying the direct payload.
    }
  }

  if (/%(?:7B|5B|22|3A|2C)/i.test(raw)) {
    try {
      candidates.push(decodeURIComponent(raw));
    } catch {
      // Ignore malformed URI encoding.
    }
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      const found = findCreateTime(parsed);
      if (found !== undefined) return found;

      if (typeof parsed === "string" && parsed !== trimmed) {
        const nested = parseCandidate(parsed);
        if (nested !== undefined) return nested;
      }
    } catch {
      // The payload may be plain text rather than JSON.
    }

    const inline = trimmed.match(/["']create_time["']\s*:\s*(?:["']([^"']+)["']|(-?\d+(?:\.\d+)?))/i);
    if (inline) return inline[1] ?? inline[2];
  }

  return undefined;
}

export function extractCreateTimeFromPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  const chunks = readTextChunks(buffer);

  // If create_time itself is stored as the PNG text keyword, use its value directly.
  for (const chunk of chunks) {
    if (normalizeKey(chunk.keyword) === "createtime") {
      const direct = String(chunk.text || "").trim();
      if (direct) return direct;
    }
  }

  // Character-card PNGs commonly use a "chara" text chunk, but scan every
  // textual chunk so Tavo-specific or future-compatible keywords also work.
  const ordered = [...chunks].sort((a, b) => {
    const rank = chunk => /^(chara|ccv3|character)$/i.test(chunk.keyword || "") ? 0 : 1;
    return rank(a) - rank(b);
  });

  for (const chunk of ordered) {
    const found = parseCandidate(chunk.text);
    if (found !== undefined) return found;
  }

  return undefined;
}

export function extractCreateTimes({ root = process.cwd(), worksFile = "src/data/works.js" } = {}) {
  const source = fs.readFileSync(path.join(root, worksFile), "utf8");
  const imagePattern = /["']image["']\s*:\s*["']([^"']+\.png(?:[?#][^"']*)?)["']/gi;
  const imagePaths = [];
  const seen = new Set();

  for (const match of source.matchAll(imagePattern)) {
    const imagePath = match[1];
    if (!seen.has(imagePath)) {
      seen.add(imagePath);
      imagePaths.push(imagePath);
    }
  }

  const cards = {};
  const missing = [];
  const errors = [];

  for (const imagePath of imagePaths) {
    const localPath = path.join(root, decodeLocalPath(imagePath));

    if (!fs.existsSync(localPath)) {
      missing.push({ image: imagePath, reason: "file-not-found" });
      continue;
    }

    try {
      const createTime = extractCreateTimeFromPng(localPath);
      if (createTime === undefined) {
        missing.push({ image: imagePath, reason: "create_time-not-found" });
      } else {
        cards[imagePath] = createTime;
      }
    } catch (error) {
      errors.push({ image: imagePath, reason: String(error?.message || error) });
    }
  }

  return {
    cards,
    missing,
    errors,
    total: imagePaths.length,
    found: Object.keys(cards).length
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const result = extractCreateTimes();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.errors.length) process.exitCode = 1;
}
