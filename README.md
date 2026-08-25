# 繁花·纷落｜角色档案

两个分区、共 101 张角色卡的静态档案站，部署于 GitHub Pages。

- 在线网站：<https://hqu35785-cmyk.github.io/fanhuafenluo-pages/>
- 源代码仓库：<https://github.com/hqu35785-cmyk/fanhuafenluo-pages>

## 结构

- `index.html`：页面骨架。
- `src/app.js`：站点交互与运行逻辑。
- `src/data/`：角色目录和详细资料。
- `src/styles/main.css`：页面样式。
- `assets/previews/`：网页展示使用的轻量预览。
- `assets/authors/`：作者/分区头像。
- `assets/tavo/`、`assets/shark/`、`assets/wa/`、`assets/public/`、`assets/source/`：角色卡源 PNG。它们不随 Pages artifact 全量发布，但保存角色卡时会按需从仓库/CDN读取，因此不能仅因体积大而删除。
- `scripts/`：长期构建、资源验证、跨浏览器验证和图片维护工具。
- `tests/`：站点回归测试。

## 固定分区契约

站点只允许存在以下两个可切换分区：

```text
繁花·纷落  70
公开        31
总计       101
```

`公开` 的 31 张固定按以下顺序组成：

```text
publicWorks          新加入公开分区的 3 张
legacySharkWorks     原鲨鱼分区的 14 张
legacyWaWorks        原咓分区的 14 张
```

`legacySharkWorks` 与 `legacyWaWorks` 只是为了保留已有图片路径、详情 key 和原作者归属的历史数据桶，不再是作者分区。未来新增任何非“繁花·纷落”的角色卡，只能加入 `publicWorks`；不得恢复“鲨鱼”或“咓”的独立切换条目。

详情数据只生成：

```text
src/data/details-fanhua.js
src/data/details-public.js
```

旧的 `details-shark.js` 与 `details-wa.js` 不得重新生成。原卡片中的 `creator`、`alias` 和素材目录保持不变，以保留原作者信息与稳定下载地址。

## 本地验证

```bash
npm ci
npm run validate:assets
npm run build:pages
npm run verify:pages-site
npx playwright install chromium
npm test -- --project=chromium
```

完整浏览器验证：

```bash
npx playwright install
npm test
```

## 部署

推送到 `main` 后，`.github/workflows/pages.yml` 调用 `npm run build:pages` 生成 `_site` 并部署到 GitHub Pages。

日常 push / pull request 使用 Chromium 做回归验证；完整 Chromium / Firefox / WebKit 多视口矩阵通过 Actions 手动触发。
