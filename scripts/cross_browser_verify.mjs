import fs from "fs";
import path from "path";
import { chromium, firefox, webkit } from "playwright";

const TARGET =
  process.env.TEST_URL || "https://hqu35785-cmyk.github.io/fanhuafenluo-pages/index.html";

/** CI isolation: one process = one browser = one viewport = one page. */
const TEST_BROWSER = (process.env.TEST_BROWSER || "").trim().toLowerCase();
const TEST_VIEWPORT = (process.env.TEST_VIEWPORT || "").trim();
const TEST_ROUND = String(process.env.TEST_ROUND || "1").trim() || "1";
/** Never call page.setViewportSize mid-test when isolating a single viewport job. */
const STATIC_VIEWPORT_MODE =
  process.env.STATIC_VIEWPORT === "1" || Boolean(TEST_VIEWPORT);

const VIEWPORTS = [
  [320, 568],
  [360, 740],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
  [500, 900],
  [600, 960],
  [768, 1024],
  [568, 320],
  [667, 375],
  [740, 360],
  [844, 390],
  [915, 412],
  [932, 430],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];

const BROWSERS = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

let ACTIVE_OUT_DIR = path.join(process.cwd(), "test-artifacts", "final");

function parseViewportSpec(spec) {
  const match = String(spec).match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function outDirFor(browserName, viewport) {
  const [width, height] = viewport;
  return path.join(
    process.cwd(),
    "artifacts",
    `round-${TEST_ROUND}`,
    browserName,
    `${width}x${height}`
  );
}

function selectBrowsers() {
  if (!TEST_BROWSER) return BROWSERS;
  const selected = BROWSERS.filter(([name]) => name === TEST_BROWSER);
  if (!selected.length) {
    throw new Error(
      `Unknown TEST_BROWSER=${TEST_BROWSER}; expected one of ${BROWSERS.map(([n]) => n).join(", ")}`
    );
  }
  return selected;
}

function selectViewports() {
  if (!TEST_VIEWPORT) return VIEWPORTS;
  const viewport = parseViewportSpec(TEST_VIEWPORT);
  if (!viewport) {
    throw new Error(`Invalid TEST_VIEWPORT=${TEST_VIEWPORT}; expected e.g. 360x740`);
  }
  const known = VIEWPORTS.some(([w, h]) => w === viewport[0] && h === viewport[1]);
  if (!known) {
    throw new Error(`TEST_VIEWPORT=${TEST_VIEWPORT} is not in the official VIEWPORTS list`);
  }
  return [viewport];
}

const PAGE_EVAL_HELPERS = `
function isRendered(element) {
  if (!element || !element.isConnected) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}
function intersectRect(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
function visibleRect(element) {
  if (!isRendered(element)) return null;
  let rect = element.getBoundingClientRect();
  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
    const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
    if (clipsX || clipsY) {
      const parentRect = parent.getBoundingClientRect();
      const clipRect = {
        left: clipsX ? parentRect.left : -Infinity,
        right: clipsX ? parentRect.right : Infinity,
        top: clipsY ? parentRect.top : -Infinity,
        bottom: clipsY ? parentRect.bottom : Infinity,
      };
      rect = intersectRect(rect, clipRect);
      if (!rect) return null;
    }
    parent = parent.parentElement;
  }
  return rect;
}
function rectsOverlap(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return (
    a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance
  );
}
function pack(r) {
  if (!r) return null;
  return {
    left: +r.left.toFixed(2),
    right: +r.right.toFixed(2),
    top: +r.top.toFixed(2),
    bottom: +r.bottom.toFixed(2),
    width: +(r.width ?? r.right - r.left).toFixed(2),
    height: +(r.height ?? r.bottom - r.top).toFixed(2),
  };
}
function mediaState() {
  return {
    phonePortrait: matchMedia("(max-width:620px) and (orientation:portrait)").matches,
    narrowBottom: matchMedia(
      "(max-width:620px), (max-height:520px) and (orientation:landscape)"
    ).matches,
    compactLandscape: matchMedia(
      "(max-height:520px) and (orientation:landscape)"
    ).matches,
  };
}
`;

const EDGE_TOLERANCE_PX = 12;

async function pollUntil(fn, { timeout = 2500, interval = 50 } = {}) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeout) {
    lastValue = await fn();
    if (lastValue) return { ok: true, lastValue };
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return { ok: false, lastValue };
}

function isClosedTargetError(error) {
  return /page, context or browser has been closed/i.test(String(error?.stack || error));
}

function isFatalRunnerError(error) {
  const message = String(error?.stack || error);
  return (
    isClosedTargetError(error) ||
    /Page crashed|Target closed|browser has been closed|not attached to the DOM/i.test(message)
  );
}

/** Instant scroll without Playwright stability waits (flip CSS animates ~0.48s). */
async function softScrollIntoView(locator) {
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  });
}

/**
 * Wait for card flip CSS transition to finish without getAnimations()
 * (WebKit headless has crashed on getAnimations + 3D transforms).
 */
async function settleFlipTransition(cardLocator, timeoutMs = 700) {
  await cardLocator.evaluate(async (el, timeout) => {
    await new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      el.addEventListener("transitionend", done, { once: true });
      // Flip transition is ~0.48s; keep a hard cap so we never hang.
      setTimeout(done, timeout);
    });
  }, timeoutMs);
}

async function assertPageAlive(page) {
  if (!page || page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }
  try {
    await page.evaluate(() => document.readyState);
  } catch (error) {
    throw new Error(
      isClosedTargetError(error) || /Page crashed/i.test(String(error))
        ? String(error?.message || error)
        : "Target page, context or browser has been closed"
    );
  }
}

/** Real user-ish click: Playwright click first; WebKit falls back to HTMLElement.click(). */
async function clickControl(locator, browserName) {
  if (browserName === "webkit") {
    // Playwright actionability + 3D-transformed controls is flaky on WebKit CI builds.
    await locator.evaluate((el) => {
      el.click();
    });
    return;
  }
  await locator.click({ timeout: 5000 });
}

async function captureFailure(page, browserName, viewport, state, failure, consoleErrors) {
  const stamp = `${browserName}_${viewport[0]}x${viewport[1]}_${state}_${failure.check}`
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 120);
  fs.mkdirSync(ACTIVE_OUT_DIR, { recursive: true });
  const shot = path.join(ACTIVE_OUT_DIR, `${stamp}.png`);
  const failureShot = path.join(ACTIVE_OUT_DIR, "failure.png");
  try {
    if (page && !page.isClosed()) {
      // fullPage over a 64-card gallery has crashed WebKit on CI; viewport is enough.
      await page.screenshot({ path: shot, fullPage: false });
      try { fs.copyFileSync(shot, failureShot); } catch {}
    }
  } catch {}
  return {
    ok: false,
    browser: browserName,
    viewport: `${viewport[0]}x${viewport[1]}`,
    state,
    check: failure.check,
    expected: failure.expected,
    actual: failure.actual,
    media: failure.media || null,
    selectors: failure.selectors || null,
    visibleRects: failure.visibleRects || null,
    scrollWidth: failure.scrollWidth,
    clientWidth: failure.clientWidth,
    consoleErrors,
    screenshot: path.basename(shot),
    extra: failure.extra || null,
  };
}

async function inspectLayout(page) {
  return page.evaluate((helpersSrc) => {
    // eslint-disable-next-line no-eval
    eval(helpersSrc);
    const media = mediaState();
    const gallery = document.getElementById("gallery");
    const gStyle = getComputedStyle(gallery);
    const horizontalCarousel =
      String(gStyle.scrollSnapType).includes("x") &&
      String(gStyle.gridAutoFlow).includes("column");

    const failures = [];
    const notes = [];
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;

    // Root overflow only — gallery carousel scrollWidth is expected when horizontal.
    if (scrollWidth > clientWidth + 1) {
      failures.push({
        check: "root-horizontal-overflow",
        expected: "documentElement.scrollWidth <= clientWidth + 1",
        actual: `${scrollWidth} > ${clientWidth}`,
        scrollWidth,
        clientWidth,
        media,
      });
    }

    const cols = gStyle.gridTemplateColumns;
    const colCount = cols && cols !== "none" ? cols.trim().split(/\s+/).filter(Boolean).length : 0;
    const firstCard = document.querySelector(".card");
    const aspect = firstCard ? getComputedStyle(firstCard).aspectRatio : null;
    const flipMode = document.documentElement.classList.contains("flip-compat")
      ? "compat"
      : document.documentElement.classList.contains("flip-3d")
        ? "3d"
        : "unknown";

    if (media.phonePortrait) {
      const w = window.innerWidth;
      if (w >= 500 && w <= 620 && colCount !== 3) {
        failures.push({
          check: "phone-portrait-three-columns",
          expected: 3,
          actual: colCount,
          media,
        });
      }
      if (w < 500 && colCount !== 2) {
        failures.push({
          check: "phone-portrait-two-columns",
          expected: 2,
          actual: colCount,
          media,
        });
      }
      const aspectOk =
        aspect &&
        (String(aspect).includes("18") ||
          Math.abs(parseFloat(aspect) - 18 / 25) < 0.02 ||
          String(aspect).replace(/\s/g, "") === "18/25");
      if (!aspectOk) {
        failures.push({
          check: "phone-portrait-aspect-ratio",
          expected: "18 / 25",
          actual: aspect,
          media,
        });
      }
    }

    if (media.compactLandscape) {
      if (!horizontalCarousel) {
        failures.push({
          check: "compact-landscape-carousel",
          expected: "scroll-snap x + grid-auto-flow column",
          actual: `snap=${gStyle.scrollSnapType}; flow=${gStyle.gridAutoFlow}`,
          media,
        });
      }
      const gRect = gallery.getBoundingClientRect();
      if (gRect.left < -2 || gRect.right > window.innerWidth + 2) {
        failures.push({
          check: "gallery-outside-page-bounds",
          expected: "gallery within page x bounds",
          actual: pack(gRect),
          media,
        });
      }
      // First card should be at least partially visible
      const c0 = document.querySelector(".card");
      const c0r = c0 ? visibleRect(c0) : null;
      if (!c0r) {
        failures.push({
          check: "carousel-first-card-visible",
          expected: "first card has visible rect",
          actual: null,
          media,
        });
      }
      // Cards should not overlap each other (sample adjacent)
      const cards = [...document.querySelectorAll(".card")].slice(0, 8);
      for (let i = 0; i < cards.length - 1; i++) {
        const a = visibleRect(cards[i]);
        const b = visibleRect(cards[i + 1]);
        if (a && b && rectsOverlap(a, b, 1)) {
          failures.push({
            check: "carousel-card-overlap",
            expected: "adjacent cards do not overlap",
            actual: { i, a: pack(a), b: pack(b) },
            media,
            selectors: [`.card:nth-child(${i + 1})`, `.card:nth-child(${i + 2})`],
          });
        }
      }
    }

    // Overlap / bounds checks — use visibleRect
    const sampleCards = [...document.querySelectorAll(".card")].slice(0, 6);
    for (const [i, card] of sampleCards.entries()) {
      if (card.classList.contains("flipped")) continue;
      const title = card.querySelector(".card-name b");
      const alias = card.querySelector(".card-name > span:not(.card-meta)");
      const metaLast = card.querySelector(".card-meta span:last-child");
      const btn = card.querySelector(".privacy-unlock");
      const front = card.querySelector(".front");
      const cardOpen = card.querySelector(".card-open");
      const cardVis = visibleRect(card);
      const titleVis = visibleRect(title);
      const aliasVis = visibleRect(alias);
      const metaVis = visibleRect(metaLast);
      const btnVis = visibleRect(btn);

      if (front && cardOpen && cardVis) {
        const frontRect = front.getBoundingClientRect();
        const openRect = cardOpen.getBoundingClientRect();
        const edge = Number.parseFloat(getComputedStyle(front).getPropertyValue("--badge-inset")) || 0;
        const topOffset = openRect.top - frontRect.top;
        const rightOffset = frontRect.right - openRect.right;
        if (Math.abs(topOffset - edge) > 1.5 || Math.abs(rightOffset - edge) > 1.5) {
          failures.push({
            check: "card-open-top-right",
            expected: { topOffset: edge, rightOffset: edge },
            actual: { topOffset, rightOffset, open: pack(openRect), front: pack(frontRect) },
            selectors: [".card-open", ".front"],
            visibleRects: { open: pack(openRect), card: pack(cardVis) },
            media,
            scrollWidth,
            clientWidth,
            extra: { cardIndex: i, cardClass: card.className },
          });
        }
      }

      if (btnVis && cardVis) {
        if (
          btnVis.right > cardVis.right + 1.5 ||
          btnVis.bottom > cardVis.bottom + 1.5 ||
          btnVis.left < cardVis.left - 1.5
        ) {
          failures.push({
            check: "button-outside-card",
            expected: "button visible rect inside card",
            actual: { btn: pack(btnVis), card: pack(cardVis) },
            selectors: [".privacy-unlock", ".card"],
            visibleRects: { btn: pack(btnVis), card: pack(cardVis) },
            media,
            scrollWidth,
            clientWidth,
            extra: { cardIndex: i, cardClass: card.className },
          });
        }
      }

      // Text outside card (visible part)
      for (const [name, rect, sel] of [
        ["title", titleVis, ".card-name b"],
        ["alias", aliasVis, ".card-name > span:not(.card-meta)"],
        ["meta", metaVis, ".card-meta span:last-child"],
      ]) {
        if (!rect || !cardVis) continue;
        if (rect.left < cardVis.left - 1.5 || rect.right > cardVis.right + 1.5 || rect.bottom > cardVis.bottom + 1.5) {
          failures.push({
            check: `${name}-outside-card`,
            expected: `${name} visible rect inside card`,
            actual: { text: pack(rect), card: pack(cardVis) },
            selectors: [sel, ".card"],
            visibleRects: { text: pack(rect), card: pack(cardVis) },
            media,
            scrollWidth,
            clientWidth,
            extra: { cardIndex: i },
          });
        }
      }

      // Overlaps: always check title/alias/meta visible parts vs button
      // (desktop included; uses clipped rects so overflow:hidden false positives are avoided)
      if (titleVis && btnVis && rectsOverlap(titleVis, btnVis, 1)) {
        failures.push({
          check: "title-button-overlap",
          expected: "visible title does not overlap button",
          actual: "overlap",
          selectors: [".card-name b", ".privacy-unlock"],
          visibleRects: { title: pack(titleVis), button: pack(btnVis) },
          media,
          scrollWidth,
          clientWidth,
          extra: { cardIndex: i, cardClass: card.className },
        });
      }
      if (aliasVis && btnVis && rectsOverlap(aliasVis, btnVis, 1)) {
        failures.push({
          check: "alias-button-overlap",
          expected: "visible alias does not overlap button",
          actual: "overlap",
          selectors: [".card-name > span:not(.card-meta)", ".privacy-unlock"],
          visibleRects: { alias: pack(aliasVis), button: pack(btnVis) },
          media,
          scrollWidth,
          clientWidth,
          extra: { cardIndex: i },
        });
      }
      if (metaVis && btnVis && rectsOverlap(metaVis, btnVis, 1)) {
        failures.push({
          check: "meta-button-overlap",
          expected: "visible 点按翻转 does not overlap button",
          actual: "overlap",
          selectors: [".card-meta span:last-child", ".privacy-unlock"],
          visibleRects: { meta: pack(metaVis), button: pack(btnVis) },
          media,
          scrollWidth,
          clientWidth,
          extra: { cardIndex: i, cardClass: card.className },
        });
      }

      // Off-screen cards only fail outside carousel
      if (!media.compactLandscape && !horizontalCarousel && cardVis) {
        if (cardVis.right > window.innerWidth + 2 || cardVis.left < -2) {
          failures.push({
            check: "card-outside-viewport-x",
            expected: "card visible within viewport x (non-carousel)",
            actual: pack(cardVis),
            media,
            scrollWidth,
            clientWidth,
            extra: { cardIndex: i, vw: window.innerWidth },
          });
        }
      }
    }

    // 500-620 three column narrow content check when phonePortrait
    if (media.phonePortrait && window.innerWidth >= 500 && window.innerWidth <= 620) {
      const card = document.querySelector(".card");
      if (card) {
        const r = card.getBoundingClientRect();
        if (r.width < 100) {
          failures.push({
            check: "three-col-too-narrow",
            expected: "card width >= 100px",
            actual: r.width,
            media,
          });
        }
      }
    }

    return {
      media,
      horizontalCarousel,
      colCount,
      aspect,
      flipMode,
      scrollWidth,
      clientWidth,
      gallerySnap: gStyle.scrollSnapType,
      galleryFlow: gStyle.gridAutoFlow,
      failures,
      notes,
      htmlClass: document.documentElement.className,
    };
  }, PAGE_EVAL_HELPERS);
}

async function runViewport(browserType, browserName, viewport) {
  const [w, h] = viewport;
  ACTIVE_OUT_DIR = outDirFor(browserName, viewport);
  fs.mkdirSync(ACTIVE_OUT_DIR, { recursive: true });
  const consoleErrors = [];
  let browser;
  let context;
  let page;
  try {
    browser = await browserType.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
  } catch (launchError) {
    return [{
      ok: false,
      browser: browserName,
      viewport: `${w}x${h}`,
      state: "exception",
      check: "runner-exception",
      expected: "no exception",
      actual: String(launchError?.stack || launchError),
      consoleErrors: [],
      screenshot: null,
      extra: { phase: "launch" },
    }];
  }
  page.on("pageerror", (e) => consoleErrors.push(String(e?.stack || e)));
  // note: original had page.on after newPage - keep duplicate-safe below
  page.on("pageerror", (e) => consoleErrors.push(String(e?.stack || e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const rows = [];
  const pushOk = (state, extra = {}) => {
    rows.push({
      ok: true,
      browser: browserName,
      viewport: `${w}x${h}`,
      state,
      ...extra,
    });
  };
  const pushSkip = (state, reason) => {
    rows.push({
      ok: true,
      skipped: true,
      browser: browserName,
      viewport: `${w}x${h}`,
      state,
      reason,
    });
  };

  try {
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".card", { timeout: 30000 });
    await page.waitForTimeout(500);

    const openContract = await page.evaluate(() => ({
      visibility: document.documentElement.dataset.cardVisibility || "",
      cards: document.querySelectorAll(".card").length,
      unlockAllHidden: document.getElementById("unlockAll")?.hidden ?? false,
      unlockAllInert: document.getElementById("unlockAll")?.hasAttribute("inert") ?? false,
      unlockChoiceHidden: document.getElementById("unlockChoice")?.hidden ?? false,
      unlockChoiceInert: document.getElementById("unlockChoice")?.hasAttribute("inert") ?? false,
      firstNames: [...document.querySelectorAll(".card .card-name b")]
        .slice(0, 6)
        .map((el) => el.textContent?.trim() || ""),
      firstAction: document.querySelector(".card .privacy-unlock")?.dataset.mode || "",
      firstVeilHidden: (() => {
        const veil = document.querySelector(".card .privacy-veil");
        return !veil || veil.hidden;
      })(),
    }));
    const openFailures = [];
    if (openContract.visibility !== "open") openFailures.push(["open-mode-dataset", "open", openContract.visibility]);
    if (openContract.cards !== 70) openFailures.push(["open-mode-fanhua-count", 70, openContract.cards]);
    if (!openContract.unlockAllHidden || !openContract.unlockAllInert) {
      openFailures.push(["open-mode-unlock-all-hidden", { hidden: true, inert: true }, openContract]);
    }
    if (!openContract.unlockChoiceHidden || !openContract.unlockChoiceInert) {
      openFailures.push(["open-mode-unlock-choice-hidden", { hidden: true, inert: true }, openContract]);
    }
    const expectedLatest = ["刻律德菈", "云璃", "雾矢葵", "许知予", "八尺大姐姐", "康娜"];
    if (JSON.stringify(openContract.firstNames) !== JSON.stringify(expectedLatest)) {
      openFailures.push(["open-mode-latest-order", expectedLatest, openContract.firstNames]);
    }
    if (openContract.firstAction !== "save" || openContract.firstVeilHidden !== true) {
      openFailures.push(["open-mode-first-card-direct", { action: "save", veilHidden: true }, openContract]);
    }
    for (const [check, expected, actual] of openFailures) {
      rows.push(
        await captureFailure(page, browserName, viewport, "open-mode", { check, expected, actual }, consoleErrors)
      );
    }
    if (!openFailures.length) pushOk("open-mode", { contract: openContract });

    const deployment = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      });
      return {
        hasAspectRatio: rules.some(
          (rule) =>
            rule.cssText?.includes("aspect-ratio: 18 / 25") ||
            rule.cssText?.includes("aspect-ratio:18 / 25") ||
            rule.cssText?.includes("aspect-ratio:18/25")
        ),
        hasThreeColumns: rules.some(
          (rule) =>
            rule.cssText?.includes("repeat(3,minmax(0,1fr))") ||
            rule.cssText?.includes("repeat(3, minmax(0, 1fr))")
        ),
        portraitCardHeight: getComputedStyle(document.documentElement).getPropertyValue(
          "--portrait-card-height"
        ),
        url: location.href,
      };
    });

    // 1 open cards
    let layout = await inspectLayout(page);
    for (const f of layout.failures) {
      rows.push(
        await captureFailure(page, browserName, viewport, "open-front", f, consoleErrors)
      );
    }
    if (!layout.failures.length) pushOk("open-front", { media: layout.media, flipMode: layout.flipMode, deployment });

    // 1b section switch: 繁花 → 鲨鱼(14) → 咓(14) → 公开(3) → 繁花, unlock isolation
    {
      await page
        .waitForFunction(() => {
          const avatar = document.getElementById("authorAvatar");
          if (!avatar) return false;
          const src = avatar.getAttribute("src") || "";
          return (
            /^assets\/authors\/fanhuafenluo-avatar\.(?:jpe?g|png|webp)(?:\?v=[a-f0-9]+)?$/i.test(src) &&
            avatar.complete &&
            avatar.naturalWidth > 0
          );
        }, { timeout: 10000 })
        .catch(() => {});
      const before = await page.evaluate(() => {
        const avatar = document.getElementById("authorAvatar");
        return {
          name: document.getElementById("authorName")?.textContent || "",
          cards: document.querySelectorAll(".card").length,
          avatarSrc: avatar?.getAttribute("src") || "",
          avatarComplete: !!avatar?.complete,
          avatarNaturalWidth: avatar?.naturalWidth || 0,
          avatarNaturalHeight: avatar?.naturalHeight || 0,
        };
      });
      const initialAuthorAvatarSrc = before.avatarSrc;
      const avatarPathOk =
        /^assets\/authors\/fanhuafenluo-avatar\.(?:jpe?g|png|webp)(?:\?v=[a-f0-9]+)?$/i.test(
          initialAuthorAvatarSrc
        );
      if (
        !avatarPathOk ||
        !before.avatarComplete ||
        before.avatarNaturalWidth <= 0 ||
        before.avatarNaturalHeight <= 0
      ) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "author-switch-back",
            {
              check: "author-avatar-initial",
              expected: "external fanhuafenluo avatar loaded",
              actual: {
                src: initialAuthorAvatarSrc,
                complete: before.avatarComplete,
                naturalWidth: before.avatarNaturalWidth,
                naturalHeight: before.avatarNaturalHeight,
              },
            },
            consoleErrors
          )
        );
      }

      const unlockedBefore = await page.evaluate(
        () => document.querySelectorAll(".card .front:not(.is-locked)").length
      );

      // → 鲨鱼
      await (async () => {
        const sw = page.locator("#authorSwitch");
        await sw.waitFor({ state: "visible", timeout: 10000 });
        if (browserName === "webkit") await sw.evaluate((el) => el.click());
        else await sw.click({ timeout: 10000 });
      })();
      await page.waitForTimeout(350);
      const shark = await page.evaluate(() => ({
        name: document.getElementById("authorName")?.textContent || "",
        cards: document.querySelectorAll(".card").length,
        footer: document.getElementById("footerAuthor")?.textContent || "",
        count: document.getElementById("workCount")?.textContent || "",
        avatar: document.getElementById("authorAvatar")?.getAttribute("src") || "",
        toast: document.getElementById("toast")?.textContent || "",
        empty: !!document.querySelector(".author-empty"),
      }));
      const sharkFails = [];
      if (shark.name !== "鲨鱼") sharkFails.push(["author-name-shark", "鲨鱼", shark.name]);
      if (shark.cards !== 14) sharkFails.push(["author-cards-shark", 14, shark.cards]);
      if (shark.empty) sharkFails.push(["author-not-empty-shark", false, shark.empty]);
      if (shark.footer !== "鲨鱼") sharkFails.push(["author-footer-shark", "鲨鱼", shark.footer]);
      if (shark.count !== "14") sharkFails.push(["author-count-shark", "14", shark.count]);
      if (!shark.avatar.includes("assets/authors/shark.webp"))
        sharkFails.push(["author-avatar-shark", "assets/authors/shark.webp", shark.avatar.slice(0, 60)]);
      if (!String(shark.toast).includes("鲨鱼"))
        sharkFails.push(["author-toast-shark", "contains 鲨鱼", shark.toast]);
      for (const [check, expected, actual] of sharkFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "author-switch-shark", { check, expected, actual }, consoleErrors)
        );
      }
      if (!sharkFails.length) pushOk("author-switch-shark", { beforeCards: before.cards, cards: shark.cards });

      // → 咓
      await (async () => {
        const sw = page.locator("#authorSwitch");
        await sw.waitFor({ state: "visible", timeout: 10000 });
        if (browserName === "webkit") await sw.evaluate((el) => el.click());
        else await sw.click({ timeout: 10000 });
      })();
      await page.waitForTimeout(350);
      const wa = await page.evaluate(() => ({
        name: document.getElementById("authorName")?.textContent || "",
        cards: document.querySelectorAll(".card").length,
        footer: document.getElementById("footerAuthor")?.textContent || "",
        count: document.getElementById("workCount")?.textContent || "",
        avatar: document.getElementById("authorAvatar")?.getAttribute("src") || "",
        empty: !!document.querySelector(".author-empty"),
      }));
      const waFails = [];
      if (wa.name !== "咓") waFails.push(["author-name-wa", "咓", wa.name]);
      if (wa.cards !== 14) waFails.push(["author-cards-wa", 14, wa.cards]);
      if (wa.empty) waFails.push(["author-not-empty-wa", false, wa.empty]);
      if (wa.footer !== "咓") waFails.push(["author-footer-wa", "咓", wa.footer]);
      if (wa.count !== "14") waFails.push(["author-count-wa", "14", wa.count]);
      if (!wa.avatar.includes("assets/authors/wa.webp"))
        waFails.push(["author-avatar-wa", "assets/authors/wa.webp", wa.avatar.slice(0, 60)]);
      for (const [check, expected, actual] of waFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "author-switch-wa", { check, expected, actual }, consoleErrors)
        );
      }
      if (!waFails.length) pushOk("author-switch-wa", { cards: wa.cards });

      // → 公开
      await (async () => {
        const sw = page.locator("#authorSwitch");
        await sw.waitFor({ state: "visible", timeout: 10000 });
        if (browserName === "webkit") await sw.evaluate((el) => el.click());
        else await sw.click({ timeout: 10000 });
      })();
      await page.waitForTimeout(350);
      const publicSection = await page.evaluate(() => ({
        name: document.getElementById("authorName")?.textContent || "",
        cards: document.querySelectorAll(".card").length,
        footer: document.getElementById("footerAuthor")?.textContent || "",
        count: document.getElementById("workCount")?.textContent || "",
        avatar: document.getElementById("authorAvatar")?.getAttribute("src") || "",
        names: [...document.querySelectorAll(".card .card-name b")].map((element) => element.textContent?.trim() || ""),
        empty: !!document.querySelector(".author-empty"),
      }));
      const publicFails = [];
      if (publicSection.name !== "公开") publicFails.push(["author-name-public", "公开", publicSection.name]);
      if (publicSection.cards !== 3) publicFails.push(["author-cards-public", 3, publicSection.cards]);
      if (publicSection.empty) publicFails.push(["author-not-empty-public", false, publicSection.empty]);
      if (publicSection.footer !== "公开") publicFails.push(["author-footer-public", "公开", publicSection.footer]);
      if (publicSection.count !== "03") publicFails.push(["author-count-public", "03", publicSection.count]);
      if (!publicSection.avatar.includes("assets/authors/public.webp"))
        publicFails.push(["author-avatar-public", "assets/authors/public.webp", publicSection.avatar.slice(0, 60)]);
      if (JSON.stringify(publicSection.names) !== JSON.stringify(["调月莉音", "认知修改·后宫性生活", "星野"]))
        publicFails.push(["author-names-public", ["调月莉音", "认知修改·后宫性生活", "星野"], publicSection.names]);
      for (const [check, expected, actual] of publicFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "author-switch-public", { check, expected, actual }, consoleErrors)
        );
      }
      if (!publicFails.length) pushOk("author-switch-public", { cards: publicSection.cards, names: publicSection.names });

      // → 繁花·纷落
      await (async () => {
        const sw = page.locator("#authorSwitch");
        await sw.waitFor({ state: "visible", timeout: 10000 });
        if (browserName === "webkit") await sw.evaluate((el) => el.click());
        else await sw.click({ timeout: 10000 });
      })();
      await page.waitForTimeout(400);
      // Wait for restored external avatar to finish loading after section switch.
      await page
        .waitForFunction(
          (expectedSrc) => {
            const avatar = document.getElementById("authorAvatar");
            if (!avatar) return false;
            const src = avatar.getAttribute("src") || "";
            return src === expectedSrc && avatar.complete && avatar.naturalWidth > 0;
          },
          initialAuthorAvatarSrc,
          { timeout: 10000 }
        )
        .catch(() => {});
      const back = await page.evaluate((initialAuthorAvatarSrc) => {
        const avatar = document.getElementById("authorAvatar");
        const avatarSrc = avatar?.getAttribute("src") || "";
        const authorAvatarRestored =
          avatarSrc === initialAuthorAvatarSrc &&
          /^assets\/authors\/fanhuafenluo-avatar\.(?:jpe?g|png|webp)(?:\?v=[a-f0-9]+)?$/i.test(avatarSrc) &&
          !!avatar?.complete &&
          (avatar?.naturalWidth || 0) > 0 &&
          (avatar?.naturalHeight || 0) > 0;
        return {
          name: document.getElementById("authorName")?.textContent || "",
          cards: document.querySelectorAll(".card").length,
          empty: !!document.querySelector(".author-empty"),
          footer: document.getElementById("footerAuthor")?.textContent || "",
          unlockedFaces: document.querySelectorAll(".card .front:not(.is-locked)").length,
          authorAvatarRestored,
          avatarSrc,
          avatarComplete: !!avatar?.complete,
          avatarNaturalWidth: avatar?.naturalWidth || 0,
          avatarNaturalHeight: avatar?.naturalHeight || 0,
        };
      }, initialAuthorAvatarSrc);
      const backFails = [];
      if (back.name !== "繁花·纷落") backFails.push(["author-name-fanhua", "繁花·纷落", back.name]);
      if (back.cards !== 70) backFails.push(["author-cards-restored", 70, back.cards]);
      if (back.empty) backFails.push(["author-not-empty", false, back.empty]);
      if (back.footer !== "繁花·纷落") backFails.push(["author-footer-fanhua", "繁花·纷落", back.footer]);
      if (!back.authorAvatarRestored) {
        backFails.push([
          "author-avatar-restored",
          true,
          {
            src: back.avatarSrc,
            expectedSrc: initialAuthorAvatarSrc,
            complete: back.avatarComplete,
            naturalWidth: back.avatarNaturalWidth,
            naturalHeight: back.avatarNaturalHeight,
          },
        ]);
      }
      if (back.unlockedFaces !== 70)
        backFails.push(["author-open-faces-restored", 70, back.unlockedFaces]);
      for (const [check, expected, actual] of backFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "author-switch-back", { check, expected, actual }, consoleErrors)
        );
      }
      if (!backFails.length) {
        pushOk("author-switch-back", { cards: back.cards, unlockedFaces: back.unlockedFaces });
      }

      // refresh resets section (no storage)
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".card", { timeout: 30000 });
      await page.waitForTimeout(300);
      const afterReload = await page.evaluate(() => ({
        name: document.getElementById("authorName")?.textContent || "",
        cards: document.querySelectorAll(".card").length,
      }));
      if (afterReload.name !== "繁花·纷落" || afterReload.cards !== 70) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "author-refresh-default",
            {
              check: "author-refresh-default",
              expected: "繁花·纷落 with 70 cards",
              actual: afterReload,
            },
            consoleErrors
          )
        );
      } else {
        pushOk("author-refresh-default");
      }
    }

    // 2 open mode remains directly available after repeated section changes
    const openAfterSwitch = await page.evaluate(() => ({
      visibility: document.documentElement.dataset.cardVisibility || "",
      cards: document.querySelectorAll(".card").length,
      unlockAllHidden: document.getElementById("unlockAll")?.hidden ?? false,
      unlockChoiceHidden: document.getElementById("unlockChoice")?.hidden ?? false,
      actionModes: [...document.querySelectorAll(".card .privacy-unlock")]
        .slice(0, 6)
        .map((el) => el.dataset.mode || ""),
    }));
    const openAfterSwitchFailures = [];
    if (openAfterSwitch.visibility !== "open") openAfterSwitchFailures.push(["open-mode-after-switch", "open", openAfterSwitch.visibility]);
    if (openAfterSwitch.cards !== 70) openAfterSwitchFailures.push(["open-mode-after-switch-count", 70, openAfterSwitch.cards]);
    if (!openAfterSwitch.unlockAllHidden || !openAfterSwitch.unlockChoiceHidden) {
      openAfterSwitchFailures.push(["open-mode-controls-after-switch", { unlockAllHidden: true, unlockChoiceHidden: true }, openAfterSwitch]);
    }
    if (openAfterSwitch.actionModes.some((mode) => mode !== "save")) {
      openAfterSwitchFailures.push(["open-mode-actions-after-switch", "all save", openAfterSwitch.actionModes]);
    }
    for (const [check, expected, actual] of openAfterSwitchFailures) {
      rows.push(
        await captureFailure(page, browserName, viewport, "open-mode-after-switch", { check, expected, actual }, consoleErrors)
      );
    }
    if (!openAfterSwitchFailures.length) pushOk("open-mode-after-switch", { contract: openAfterSwitch });
    layout = await inspectLayout(page);
    for (const f of layout.failures) {
      rows.push(
        await captureFailure(page, browserName, viewport, "open-front-after-switch", f, consoleErrors)
      );
    }
    if (!layout.failures.length) pushOk("open-front-after-switch", { media: layout.media });

    // 3 loading simulate
    await page.evaluate(() => {
      const front = document.querySelector(".card .front");
      front?.classList.add("is-loading");
      front?.classList.remove("is-load-error", "is-locked");
    });
    await page.waitForTimeout(80);
    pushOk("loading-simulated");

    // 4 error / retry label
    await page.evaluate(() => {
      const card = document.querySelector(".card");
      const front = card?.querySelector(".front");
      front?.classList.remove("is-loading");
      front?.classList.add("is-load-error");
      const unlock = card?.querySelector(".privacy-unlock");
      if (unlock) {
        unlock.dataset.mode = "retry";
        unlock.textContent = "重试图片";
      }
    });
    const retryText = await page.locator(".card").first().locator(".privacy-unlock").textContent();
    if (!String(retryText || "").includes("重试")) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "retry-label",
          {
            check: "retry-button-label",
            expected: "重试图片",
            actual: retryText,
            selectors: [".privacy-unlock"],
          },
          consoleErrors
        )
      );
    } else {
      pushOk("retry-label");
    }

    // restore clean state
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".card", { timeout: 30000 });
    await page.waitForTimeout(350);
    await page.waitForTimeout(200);

    // 5 flip to back
    const card = page.locator(".card").first();
    const flipButton = card.locator(".card-flip");
    await softScrollIntoView(flipButton);
    await clickControl(flipButton, browserName);
    const flippedPoll = await pollUntil(
      () => card.evaluate((el) => el.classList.contains("flipped")),
      { timeout: 2500, interval: 50 }
    );
    if (flippedPoll.ok) await settleFlipTransition(card);
    const flipped = flippedPoll.ok;
    const frontPE = flipped
      ? await card.locator(".front").evaluate((el) => getComputedStyle(el).pointerEvents)
      : null;
    if (!flipped) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "flip-to-back",
          { check: "flip-to-back", expected: "card.flipped", actual: false },
          consoleErrors
        )
      );
    } else if (frontPE !== "none") {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "hidden-face-clickable",
          {
            check: "hidden-front-pointer-events",
            expected: "none",
            actual: frontPE,
            selectors: [".card.flipped .front"],
          },
          consoleErrors
        )
      );
    } else {
      pushOk("flip-to-back");
    }

    // 6 return to front — state-driven, no fixed 450ms assertion
    {
      const backReturn = card.locator(".back-return");
      const wasFlipped = await card.evaluate((el) => el.classList.contains("flipped"));
      if (!wasFlipped) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "flip-to-front",
            {
              check: "flip-to-front-precondition",
              expected: "flipped",
              actual: "not flipped",
            },
            consoleErrors
          )
        );
      } else {
        try {
          await settleFlipTransition(card);
          await backReturn.waitFor({ state: "visible", timeout: 5000 });
          await backReturn.evaluate((element) => {
            element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
          });
          await page.waitForTimeout(80);
          await clickControl(backReturn, browserName);
          const result = await pollUntil(
            () => card.evaluate((el) => !el.classList.contains("flipped")),
            { timeout: 2500, interval: 50 }
          );
          if (!result.ok) {
            const diagnostics = await card.evaluate((el) => {
              const returnButton = el.querySelector(".back-return");
              const rect = returnButton?.getBoundingClientRect();
              return {
                cardClass: el.className,
                ariaExpanded: el.querySelector(".card-flip")?.getAttribute("aria-expanded") || null,
                buttonClass: returnButton?.className || "",
                buttonDisabled: Boolean(returnButton?.disabled),
                buttonRect: rect
                  ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                  : null,
                buttonPointerEvents: returnButton
                  ? getComputedStyle(returnButton).pointerEvents
                  : null,
              };
            });
            rows.push(
              await captureFailure(
                page,
                browserName,
                viewport,
                "flip-to-front",
                {
                  check: "flip-to-front",
                  expected: "not flipped",
                  actual: "still flipped",
                  extra: { diagnostics },
                },
                consoleErrors
              )
            );
          } else {
            pushOk("flip-to-front");
          }
        } catch (flipFrontError) {
          if (isFatalRunnerError(flipFrontError) || page.isClosed()) {
            throw flipFrontError;
          }
          rows.push(
            await captureFailure(
              page,
              browserName,
              viewport,
              "flip-to-front",
              {
                check: "flip-to-front-click",
                expected: "successful .back-return click",
                actual: String(flipFrontError?.message || flipFrontError),
              },
              consoleErrors
            )
          );
        }
      }
    }

    await assertPageAlive(page);

    // action no misflip — click button only
    const before = await card.evaluate((el) => el.classList.contains("flipped"));
    await page.evaluate(() => {
      window.__galleryTestDownloadClicks = [];
      window.__galleryTestOriginalCreateElement = document.createElement;
      document.createElement = function (tagName, options) {
        const element = window.__galleryTestOriginalCreateElement.call(document, tagName, options);
        if (String(tagName).toLowerCase() === "a") {
          element.click = function () {
            window.__galleryTestDownloadClicks.push({
              href: this.href,
              download: this.download,
            });
          };
        }
        return element;
      };
    });
    await card.locator(".privacy-unlock").evaluate((element) => element.click());
    await page.evaluate(() => {
      const el = document.getElementById("unlockChoice");
      if (el) el.hidden = true;
    });
    const after = await card.evaluate((el) => el.classList.contains("flipped"));
    if (!before && after) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "action-misflip",
          {
            check: "privacy-unlock-misflip",
            expected: "clicking action does not flip card",
            actual: "card became flipped",
            selectors: [".privacy-unlock"],
          },
          consoleErrors
        )
      );
    } else {
      pushOk("action-no-misflip");
    }
    const downloadPoll = await pollUntil(
      () =>
        page.evaluate(() => {
          let click = window.__galleryTestDownloadClicks?.[0] || null;
          const saveLink = document.getElementById("saveSheetLink");
          if (!click && saveLink && !document.getElementById("saveSheet")?.hidden) {
            const href = saveLink.getAttribute("href") || "";
            if (href.startsWith("blob:") && saveLink.download) {
              click = { href: saveLink.href, download: saveLink.download };
            }
          }
          return click;
        }),
      { timeout: 15000, interval: 100 }
    );
    const downloadClick = downloadPoll.ok ? downloadPoll.lastValue : null;
    await page.evaluate(() => {
      if (window.__galleryTestOriginalCreateElement) {
        document.createElement = window.__galleryTestOriginalCreateElement;
      }
      delete window.__galleryTestOriginalCreateElement;
    });
    if (
      !downloadClick ||
      !downloadClick.href.startsWith("blob:") ||
      !downloadClick.download.endsWith("-角色卡.png")
    ) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "download-action",
          {
            check: "download-filename",
            expected: "anchor uses a blob URL and download ends with -角色卡.png",
            actual: downloadClick,
          },
          consoleErrors
        )
      );
    } else {
      pushOk("download-action", { href: downloadClick.href, download: downloadClick.download });
    }
    const saveSheet = page.locator("#saveSheet");
    if (await saveSheet.isVisible().catch(() => false)) {
      await page.locator("#saveSheetClose").click({ force: true }).catch(() => {});
      await pollUntil(
        () => page.evaluate(() => document.getElementById("saveSheet")?.hidden === true),
        { timeout: 2000, interval: 50 }
      );
    }

    // 7 archive — open via state poll, geometry with visualViewport + usability checks
    {
      const stillFlipped = await card.evaluate((el) => el.classList.contains("flipped"));
      if (!stillFlipped) {
        await softScrollIntoView(flipButton);
        await clickControl(flipButton, browserName);
      }
      const flippedForArchive = await pollUntil(
        () => card.evaluate((el) => el.classList.contains("flipped")),
        { timeout: 2500, interval: 50 }
      );
      if (flippedForArchive.ok) await settleFlipTransition(card);
      const expandButton = card.locator(".back-expand");
      const modalLocator = page.locator("#archiveModal");

      if (!flippedForArchive.ok) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "archive-open",
            {
              check: "archive-modal-precondition",
              expected: "card flipped",
              actual: "card not flipped",
            },
            consoleErrors
          )
        );
      } else {
        try {
          // Flip transform must finish before interacting with back-face controls.
          await settleFlipTransition(card);
          await expandButton.waitFor({ state: "visible", timeout: 5000 });
          await softScrollIntoView(expandButton);
          await clickControl(expandButton, browserName);
          const opened = await pollUntil(
            () =>
              modalLocator.evaluate((dialog) =>
                Boolean(dialog.open && dialog.hasAttribute("open"))
              ),
            { timeout: 2500, interval: 50 }
          );

          if (!opened.ok) {
            const diagnostics = await modalLocator.evaluate((dialog) => ({
              openProperty: Boolean(dialog.open),
              hasOpenAttribute: dialog.hasAttribute("open"),
              className: dialog.className,
              hidden: Boolean(dialog.hidden),
              ariaHidden: dialog.getAttribute("aria-hidden"),
              connected: dialog.isConnected,
            }));
            rows.push(
              await captureFailure(
                page,
                browserName,
                viewport,
                "archive-open",
                {
                  check: "archive-modal-open",
                  expected: true,
                  actual: false,
                  extra: { diagnostics },
                },
                consoleErrors
              )
            );
          } else {
            const geometry = await modalLocator.evaluate((dialog, tolerance) => {
              const rect = dialog.getBoundingClientRect();
              const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
              const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
              const closeBtn = dialog.querySelector("#archiveClose");
              const closeRect = closeBtn?.getBoundingClientRect();
              const content =
                dialog.querySelector(".archive-content") || dialog.querySelector(".archive-shell");
              const closeVisible =
                !!closeRect &&
                closeRect.width > 0 &&
                closeRect.height > 0 &&
                closeRect.bottom > 0 &&
                closeRect.right > 0 &&
                closeRect.top < viewportHeight &&
                closeRect.left < viewportWidth;
              return {
                rect: {
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                },
                viewportWidth,
                viewportHeight,
                outside:
                  rect.bottom > viewportHeight + tolerance ||
                  rect.right > viewportWidth + tolerance ||
                  rect.left < -tolerance ||
                  rect.top < -tolerance,
                bodyModalOpen: document.body.classList.contains("modal-open"),
                closeExists: Boolean(closeBtn),
                closeSize: closeRect
                  ? { width: closeRect.width, height: closeRect.height }
                  : null,
                closePartiallyVisible: closeVisible,
                canScroll: content
                  ? content.scrollHeight >= content.clientHeight - 2
                  : true,
                contentAccessible: Boolean(content && content.clientHeight > 0),
              };
            }, EDGE_TOLERANCE_PX);

            if (geometry.outside) {
              rows.push(
                await captureFailure(
                  page,
                  browserName,
                  viewport,
                  "archive-overflow",
                  {
                    check: "archive-outside-viewport",
                    expected: "modal within viewport",
                    actual: {
                      rect: geometry.rect,
                      viewportWidth: geometry.viewportWidth,
                      viewportHeight: geometry.viewportHeight,
                      tolerance: EDGE_TOLERANCE_PX,
                    },
                  },
                  consoleErrors
                )
              );
            } else if (
              !geometry.closeExists ||
              !geometry.closeSize ||
              geometry.closeSize.width <= 0 ||
              geometry.closeSize.height <= 0 ||
              !geometry.closePartiallyVisible ||
              !geometry.contentAccessible
            ) {
              rows.push(
                await captureFailure(
                  page,
                  browserName,
                  viewport,
                  "archive-open",
                  {
                    check: "archive-modal-usable",
                    expected: "close control and content accessible in viewport",
                    actual: {
                      closeExists: geometry.closeExists,
                      closeSize: geometry.closeSize,
                      closePartiallyVisible: geometry.closePartiallyVisible,
                      contentAccessible: geometry.contentAccessible,
                      canScroll: geometry.canScroll,
                    },
                  },
                  consoleErrors
                )
              );
            } else {
              pushOk("archive-open", {
                bodyModalOpen: geometry.bodyModalOpen,
                canScroll: geometry.canScroll,
              });
            }
          }
        } catch (archiveError) {
          if (isFatalRunnerError(archiveError) || page.isClosed()) {
            throw archiveError;
          }
          rows.push(
            await captureFailure(
              page,
              browserName,
              viewport,
              "archive-open",
              {
                check: "archive-modal-click",
                expected: "successful .back-expand click and open",
                actual: String(archiveError?.message || archiveError),
              },
              consoleErrors
            )
          );
          // Soft click failures sometimes leave WebKit unstable; probe before more steps.
          await assertPageAlive(page);
        }
      }

      try {
        if (!page.isClosed()) {
          const modalOpen = await page.evaluate(() => {
            const dialog = document.getElementById("archiveModal");
            return Boolean(dialog?.open);
          });
          if (modalOpen) {
            await page.locator("#archiveClose").click({ timeout: 3000 });
            await pollUntil(
              () =>
                page.evaluate(() => {
                  const dialog = document.getElementById("archiveModal");
                  return !dialog?.open;
                }),
              { timeout: 2000, interval: 50 }
            );
          }
        }
      } catch {
        await assertPageAlive(page);
      }
    }

    await assertPageAlive(page);

    // 8 reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".card", { timeout: 30000 });
    await page.waitForTimeout(250);
    await page.locator(".card").first().locator(".card-flip").click({ force: true });
    await page.waitForTimeout(200);
    const rmFlip = await page.locator(".card").first().evaluate((el) => el.classList.contains("flipped"));
    if (!rmFlip) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "reduced-motion-flip",
          { check: "reduced-motion-flip", expected: true, actual: false },
          consoleErrors
        )
      );
    } else {
      pushOk("reduced-motion-flip");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // 9–10 orientation / dynamic resize (disabled in STATIC_VIEWPORT_MODE)
    if (STATIC_VIEWPORT_MODE) {
      pushSkip(
        "orientation-switch",
        "static viewport isolation: dedicated portrait/landscape jobs cover orientation"
      );
      pushSkip("vv-height-change", "static viewport isolation mode");
    } else {
    // 9 orientation switch
    const mediaBefore = await page.evaluate((src) => {
      eval(src);
      return mediaState();
    }, PAGE_EVAL_HELPERS);

    if (mediaBefore.phonePortrait) {
      // portrait -> landscape-ish compact
      await page.setViewportSize({ width: Math.max(h, 568), height: Math.min(w, 500) });
      await page.waitForTimeout(600);
      const after = await page.evaluate((src) => {
        eval(src);
        const media = mediaState();
        const g = document.getElementById("gallery");
        const gs = getComputedStyle(g);
        const first = document.querySelector(".card");
        const firstVis = first ? visibleRect(first) : null;
        return {
          media,
          flow: gs.gridAutoFlow,
          snap: gs.scrollSnapType,
          rootOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          firstVisible: !!firstVis,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      }, PAGE_EVAL_HELPERS);

      const orientFails = [];
      if (after.media.phonePortrait) {
        orientFails.push({
          check: "orient-phone-portrait-should-close",
          expected: false,
          actual: true,
          media: after.media,
        });
      }
      if (!after.media.compactLandscape && after.media.narrowBottom === false) {
        // compact landscape only if height<=520
      }
      if (after.media.compactLandscape) {
        if (!String(after.flow).includes("column")) {
          orientFails.push({
            check: "orient-column-flow",
            expected: "column",
            actual: after.flow,
            media: after.media,
          });
        }
        if (!String(after.snap).includes("x")) {
          orientFails.push({
            check: "orient-scroll-snap-x",
            expected: "x mandatory",
            actual: after.snap,
            media: after.media,
          });
        }
        if (after.rootOverflow) {
          orientFails.push({
            check: "orient-root-overflow",
            expected: "no root horizontal overflow",
            actual: `${after.scrollWidth}>${after.clientWidth}`,
            media: after.media,
            scrollWidth: after.scrollWidth,
            clientWidth: after.clientWidth,
          });
        }
        if (!after.firstVisible) {
          orientFails.push({
            check: "orient-first-card-visible",
            expected: true,
            actual: false,
            media: after.media,
          });
        }
        // scroll gallery to see later cards
        await page.evaluate(() => {
          const g = document.getElementById("gallery");
          g.scrollLeft = Math.min(g.scrollWidth, 400);
        });
        await page.waitForTimeout(200);
        const laterVisible = await page.evaluate((src) => {
          eval(src);
          const cards = [...document.querySelectorAll(".card")];
          return cards.some((c, i) => i >= 2 && visibleRect(c));
        }, PAGE_EVAL_HELPERS);
        if (!laterVisible) {
          orientFails.push({
            check: "orient-scroll-later-cards",
            expected: "some later cards visible after scroll",
            actual: false,
            media: after.media,
          });
        }
        // flip still works
        await page.locator(".card").first().locator(".card-flip").click({ force: true });
        await page.waitForTimeout(400);
        const flipOk = await page.locator(".card").first().evaluate((el) => el.classList.contains("flipped"));
        if (!flipOk) {
          orientFails.push({
            check: "orient-flip-works",
            expected: true,
            actual: false,
            media: after.media,
          });
        }
      }

      for (const f of orientFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "orientation-portrait-to-landscape", f, consoleErrors)
        );
      }
      if (!orientFails.length) pushOk("orientation-portrait-to-landscape", { media: after.media });

      // back to portrait
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(600);
      const back = await page.evaluate((src) => {
        eval(src);
        const media = mediaState();
        const g = document.getElementById("gallery");
        const gs = getComputedStyle(g);
        const card = document.querySelector(".card");
        const cols = gs.gridTemplateColumns;
        const colCount = cols && cols !== "none" ? cols.trim().split(/\s+/).filter(Boolean).length : 0;
        return {
          media,
          colCount,
          aspect: card ? getComputedStyle(card).aspectRatio : null,
          rootOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          flow: gs.gridAutoFlow,
        };
      }, PAGE_EVAL_HELPERS);
      const backFails = [];
      if (!back.media.phonePortrait) {
        backFails.push({
          check: "orient-back-phone-portrait",
          expected: true,
          actual: false,
          media: back.media,
        });
      }
      if (back.media.compactLandscape) {
        backFails.push({
          check: "orient-back-compact-off",
          expected: false,
          actual: true,
          media: back.media,
        });
      }
      if (back.media.phonePortrait) {
        const expectCols = w >= 500 && w <= 620 ? 3 : 2;
        if (back.colCount !== expectCols) {
          backFails.push({
            check: "orient-back-columns",
            expected: expectCols,
            actual: back.colCount,
            media: back.media,
          });
        }
        const aspectOk =
          back.aspect &&
          (String(back.aspect).includes("18") ||
            Math.abs(parseFloat(back.aspect) - 18 / 25) < 0.02);
        if (!aspectOk) {
          backFails.push({
            check: "orient-back-aspect",
            expected: "18 / 25",
            actual: back.aspect,
            media: back.media,
          });
        }
      }
      if (back.rootOverflow) {
        backFails.push({
          check: "orient-back-root-overflow",
          expected: false,
          actual: true,
          media: back.media,
        });
      }
      for (const f of backFails) {
        rows.push(
          await captureFailure(page, browserName, viewport, "orientation-landscape-to-portrait", f, consoleErrors)
        );
      }
      if (!backFails.length) pushOk("orientation-landscape-to-portrait", { media: back.media });
    } else if (mediaBefore.compactLandscape) {
      // landscape -> taller portrait-like
      await page.setViewportSize({ width: Math.min(w, 430), height: Math.max(h * 2, 700) });
      await page.waitForTimeout(600);
      const after = await page.evaluate((src) => {
        eval(src);
        return mediaState();
      }, PAGE_EVAL_HELPERS);
      pushOk("orientation-landscape-to-taller", { media: after });
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
    } else {
      pushSkip("orientation-switch", "not phonePortrait or compactLandscape");
    }

    // 10 visual viewport height change — only relevant for phone portrait aspect stability
    const mediaNow = await page.evaluate((src) => {
      eval(src);
      return mediaState();
    }, PAGE_EVAL_HELPERS);
    if (mediaNow.phonePortrait) {
      const beforeH = await page.evaluate(() => getComputedStyle(document.querySelector(".card")).height);
      await page.setViewportSize({ width: w, height: Math.max(500, h - 120) });
      await page.waitForTimeout(400);
      const mid = await page.evaluate(() => ({
        aspect: getComputedStyle(document.querySelector(".card")).aspectRatio,
        height: getComputedStyle(document.querySelector(".card")).height,
        portraitVar:
          document.documentElement.style.getPropertyValue("--portrait-card-height") || "",
      }));
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      if (mid.portraitVar) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "vv-height-change",
            {
              check: "no-js-portrait-height",
              expected: "empty --portrait-card-height",
              actual: mid.portraitVar,
            },
            consoleErrors
          )
        );
      } else {
        pushOk("vv-height-change", { beforeH, mid });
      }
    } else {
      pushSkip("vv-height-change", "not phonePortrait");
    }
    } // end !STATIC_VIEWPORT_MODE

    // WebKit flip mode
    if (browserName === "webkit") {
      const mode = await page.evaluate(
        () =>
          document.documentElement.classList.contains("flip-compat")
            ? "compat"
            : document.documentElement.classList.contains("flip-3d")
              ? "3d"
              : "unknown"
      );
      pushOk("webkit-flip-mode", { mode });
      // ensure flip works in webkit
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".card");
      await page.waitForTimeout(300);
      await page.locator(".card").first().locator(".card-flip").click({ force: true });
      await page.waitForTimeout(500);
      const wkFlip = await page.locator(".card").first().evaluate((el) => el.classList.contains("flipped"));
      if (!wkFlip) {
        rows.push(
          await captureFailure(
            page,
            browserName,
            viewport,
            "webkit-flip",
            {
              check: "webkit-flip-or-compat",
              expected: "card flips (3d or compat)",
              actual: false,
              extra: { mode },
            },
            consoleErrors
          )
        );
      } else {
        pushOk("webkit-flip", { mode });
      }
    }
  } catch (err) {
    const message = String(err?.stack || err);
    const fatal = isFatalRunnerError(err) || page?.isClosed?.();
    const alreadyRecordedFatal = rows.some(
      (row) =>
        row.ok === false &&
        row.check === "runner-exception" &&
        isFatalRunnerError({ message: String(row.actual) })
    );
    // One fatal runner failure per viewport; do not stack cascading closed/crash errors.
    if (!(alreadyRecordedFatal && fatal)) {
      rows.push(
        await captureFailure(
          page,
          browserName,
          viewport,
          "exception",
          {
            check: "runner-exception",
            expected: "no exception",
            actual: message,
            extra: {
              pageClosed: Boolean(page?.isClosed?.() || isClosedTargetError(err)),
              pageCrashed: /Page crashed/i.test(message),
            },
          },
          consoleErrors
        )
      );
    }
    // Abort remaining work for this viewport (each viewport has its own page).
  }

  try {
    if (page && !page.isClosed()) await context.close();
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}

  const unitFailures = rows.filter((r) => r.ok === false);
  const unitSkips = rows.filter((r) => r.skipped);
  const unitPasses = rows.filter((r) => r.ok && !r.skipped);
  const unitReport = {
    target: TARGET,
    round: TEST_ROUND,
    browser: browserName,
    viewport: `${w}x${h}`,
    staticViewportMode: STATIC_VIEWPORT_MODE,
    testedAt: new Date().toISOString(),
    total: {
      pass: unitPasses.length,
      fail: unitFailures.length,
      skip: unitSkips.length,
    },
    failures: unitFailures,
    rows,
  };
  try {
    fs.mkdirSync(ACTIVE_OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(ACTIVE_OUT_DIR, "report.json"),
      `${JSON.stringify(unitReport, null, 2)}\n`,
      "utf8"
    );
  } catch {}
  return rows;
}

// ---- main ----
const selectedBrowsers = selectBrowsers();
const selectedViewports = selectViewports();

console.log("TARGET", TARGET);
console.log("TEST_BROWSER", TEST_BROWSER || "(all)");
console.log("TEST_VIEWPORT", TEST_VIEWPORT || "(all)");
console.log("TEST_ROUND", TEST_ROUND);
console.log("STATIC_VIEWPORT_MODE", STATIC_VIEWPORT_MODE);

const all = [];
for (const [browserName, launcher] of selectedBrowsers) {
  console.log(`\n=== ${browserName} ===`);
  for (const vp of selectedViewports) {
    process.stdout.write(`${browserName} ${vp[0]}x${vp[1]} ... `);
    const rows = await runViewport(launcher, browserName, vp);
    all.push(...rows);
    const fails = rows.filter((r) => r.ok === false).length;
    const skips = rows.filter((r) => r.skipped).length;
    const passesCount = rows.filter((r) => r.ok && !r.skipped).length;
    console.log(
      fails
        ? `FAIL(${fails}) pass=${passesCount} skip=${skips}`
        : `ok pass=${passesCount} skip=${skips}`
    );
    if (fails) {
      for (const f of rows.filter((r) => !r.ok)) {
        console.log(
          `  FAIL ${f.state}/${f.check}: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`
        );
      }
    }
  }
}

const failures = all.filter((r) => r.ok === false);
const skips = all.filter((r) => r.skipped);
const passes = all.filter((r) => r.ok && !r.skipped);

const summaryByBrowser = Object.fromEntries(
  selectedBrowsers.map(([n]) => {
    const rows = all.filter((r) => r.browser === n);
    return [
      n,
      {
        pass: rows.filter((r) => r.ok && !r.skipped).length,
        fail: rows.filter((r) => r.ok === false).length,
        skip: rows.filter((r) => r.skipped).length,
      },
    ];
  })
);

const report = {
  target: TARGET,
  round: TEST_ROUND,
  staticViewportMode: STATIC_VIEWPORT_MODE,
  testBrowser: TEST_BROWSER || null,
  testViewport: TEST_VIEWPORT || null,
  testedAt: new Date().toISOString(),
  summaryByBrowser,
  total: { pass: passes.length, fail: failures.length, skip: skips.length },
  failures,
};

const summaryDir =
  TEST_BROWSER && TEST_VIEWPORT
    ? outDirFor(TEST_BROWSER, parseViewportSpec(TEST_VIEWPORT))
    : path.join(process.cwd(), "test-artifacts", "final");
fs.mkdirSync(summaryDir, { recursive: true });
fs.writeFileSync(path.join(summaryDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("\n=== SUMMARY ===");
console.log("浏览器 | 通过 | 失败 | 跳过");
for (const [n, s] of Object.entries(summaryByBrowser)) {
  console.log(`${n} | ${s.pass} | ${s.fail} | ${s.skip}`);
}
console.log(`TOTAL pass=${passes.length} fail=${failures.length} skip=${skips.length}`);
console.log("Report:", path.join(summaryDir, "report.json"));
if (failures.length) process.exitCode = 1;
else console.log("ALL CHECKS PASSED (no real failures under corrected assertions)");
