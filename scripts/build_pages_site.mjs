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
// 原始角色卡 PNG 也随站点发布：展示页从 github.io 同源地址直接下载，
// 不再只靠 jsDelivr / GitHub Raw（大陆移动网络下经常连不上，jsDelivr 还拒绝 20 MB 以上的文件）。
for (const dir of ["tavo", "shark", "wa", "public", "source"]) {
  fs.cpSync(path.join(ROOT, "assets", dir), path.join(SITE, "assets", dir), { recursive: true });
}

console.log(`Built ${SITE}`);
