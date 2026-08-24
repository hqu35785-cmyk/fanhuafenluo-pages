# 繁花·纷落｜角色档案

角色卡静态档案站，部署于 GitHub Pages。

- 在线网站：<https://hqu35785-cmyk.github.io/fanhuafenluo-pages/>
- 源代码仓库：<https://github.com/hqu35785-cmyk/fanhuafenluo-pages>

## 结构

- `index.html`：页面骨架。
- `src/app.js`：站点交互与运行逻辑。
- `src/data/`：角色目录和详细资料。
- `src/styles/main.css`：页面样式。
- `assets/previews/`：网页展示使用的轻量预览。
- `assets/authors/`：作者/分区头像。
- `assets/tavo/`、`assets/shark/`、`assets/wa/`、`assets/source/`：角色卡源 PNG。它们不随 Pages artifact 全量发布，但保存角色卡时会按需从仓库/CDN读取，因此不能仅因体积大而删除。
- `scripts/`：长期构建、资源验证、跨浏览器验证和图片维护工具。
- `tests/`：站点回归测试。

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
