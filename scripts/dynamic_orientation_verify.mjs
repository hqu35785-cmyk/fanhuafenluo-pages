import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";

const TARGET = process.env.TEST_URL || "http://127.0.0.1:4173/index.html";
const BROWSER_NAME = (process.env.TEST_BROWSER || "chromium").trim().toLowerCase();
const LAUNCHERS = { chromium, firefox, webkit };
const launcher = LAUNCHERS[BROWSER_NAME];
if (!launcher) throw new Error(`Unknown TEST_BROWSER=${BROWSER_NAME}`);

const ARTIFACT_DIR = path.join(process.cwd(), "artifacts", "dynamic", BROWSER_NAME);
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function inspect(page) {
  return page.evaluate(() => {
    const gallery = document.getElementById("gallery");
    const style = gallery ? getComputedStyle(gallery) : null;
    const card = document.querySelector(".card");
    const cardRect = card?.getBoundingClientRect();
    const doc = document.documentElement;
    return {
      width: innerWidth,
      height: innerHeight,
      visibility: doc.dataset.cardVisibility || "",
      cards: document.querySelectorAll(".card").length,
      phonePortrait: matchMedia("(max-width:620px) and (orientation:portrait)").matches,
      compactLandscape: matchMedia("(max-height:520px) and (orientation:landscape)").matches,
      flow: style?.gridAutoFlow || "",
      snap: style?.scrollSnapType || "",
      rootOverflow: doc.scrollWidth > doc.clientWidth + 1,
      galleryScrollLeft: gallery?.scrollLeft || 0,
      cardAspect: cardRect && cardRect.height ? cardRect.width / cardRect.height : 0,
      flipped: Boolean(card?.classList.contains("flipped")),
      firstVisible: Boolean(cardRect && cardRect.right > 0 && cardRect.left < innerWidth && cardRect.bottom > 0),
    };
  });
}

function failuresFor(state, value) {
  const failures = [];
  if (value.visibility !== "open") failures.push({ check: `${state}-open-mode`, expected: "open", actual: value.visibility });
  if (value.cards !== 72) failures.push({ check: `${state}-count`, expected: 72, actual: value.cards });
  if (value.rootOverflow) failures.push({ check: `${state}-root-overflow`, expected: false, actual: true });
  if (!value.firstVisible) failures.push({ check: `${state}-first-card-visible`, expected: true, actual: false });
  return failures;
}

async function main() {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".card", { timeout: 30000 });
    await page.waitForTimeout(500);
    const portraitBefore = await inspect(page);
    const failures = [...failuresFor("portrait-before", portraitBefore)];
    if (!portraitBefore.phonePortrait) failures.push({ check: "portrait-before-breakpoint", expected: true, actual: false });
    if (Math.abs(portraitBefore.cardAspect - 18 / 25) > 0.04) failures.push({ check: "portrait-before-aspect", expected: 18 / 25, actual: portraitBefore.cardAspect });

    await page.locator(".card").first().locator(".card-flip").evaluate((element) => element.click());
    await page.waitForTimeout(650);
    const flippedPortrait = await inspect(page);
    if (!flippedPortrait.flipped) failures.push({ check: "portrait-flip", expected: true, actual: false });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(650);
    const landscape = await inspect(page);
    failures.push(...failuresFor("landscape", landscape));
    if (!landscape.compactLandscape) failures.push({ check: "landscape-breakpoint", expected: true, actual: false });
    if (!String(landscape.flow).includes("column")) failures.push({ check: "landscape-column-flow", expected: "column", actual: landscape.flow });
    if (!String(landscape.snap).includes("x")) failures.push({ check: "landscape-scroll-snap", expected: "x mandatory", actual: landscape.snap });
    if (!landscape.flipped) failures.push({ check: "landscape-flip-preserved", expected: true, actual: false });

    await page.evaluate(() => { document.getElementById("gallery").scrollLeft = 360; });
    await page.waitForTimeout(150);
    const scrolledLandscape = await inspect(page);
    if (scrolledLandscape.galleryScrollLeft <= 0) failures.push({ check: "landscape-scroll", expected: ">0", actual: scrolledLandscape.galleryScrollLeft });

    await page.locator(".card").first().locator(".back-return").evaluate((element) => element.click());
    await page.waitForTimeout(650);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(650);
    const portraitAfter = await inspect(page);
    failures.push(...failuresFor("portrait-after", portraitAfter));
    if (!portraitAfter.phonePortrait) failures.push({ check: "portrait-after-breakpoint", expected: true, actual: false });
    if (Math.abs(portraitAfter.cardAspect - 18 / 25) > 0.04) failures.push({ check: "portrait-after-aspect", expected: 18 / 25, actual: portraitAfter.cardAspect });
    if (portraitAfter.flipped) failures.push({ check: "portrait-after-flip-reset", expected: false, actual: true });
    if (consoleErrors.length) failures.push({ check: "console-errors", expected: [], actual: consoleErrors });

    const report = { ok: failures.length === 0, target: TARGET, browser: BROWSER_NAME, portraitBefore, flippedPortrait, landscape, scrolledLandscape, portraitAfter, consoleErrors, failures };
    fs.writeFileSync(path.join(ARTIFACT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (failures.length) {
      await page.screenshot({ path: path.join(ARTIFACT_DIR, "failure.png"), fullPage: false }).catch(() => {});
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
