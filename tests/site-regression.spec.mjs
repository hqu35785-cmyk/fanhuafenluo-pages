import { test, expect } from "@playwright/test";

async function load(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".card").first()).toBeVisible();
}

function displayedInteger(text) {
  const match = String(text || "").match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

async function currentSection(page) {
  const cards = page.locator(".card");
  const count = await cards.count();
  const name =
    (await page.locator("#authorName").textContent().catch(() => ""))?.trim() ||
    (await page.locator(".brand-name").textContent().catch(() => ""))?.trim() ||
    "unknown";
  const workCount = displayedInteger(await page.locator("#workCount").textContent());
  const workTotal = displayedInteger(await page.locator("#workTotal").textContent());
  return { name, count, workCount, workTotal };
}

async function cycleSections(page, visitor) {
  const switcher = page.locator("#authorSwitch");
  const hasSwitcher = await switcher.count();
  const seen = new Set();

  for (let step = 0; step < 12; step += 1) {
    const section = await currentSection(page);
    if (seen.has(section.name)) break;
    seen.add(section.name);
    await visitor(section, step);

    if (!hasSwitcher) break;
    await switcher.click();
    await expect(page.locator(".card").first()).toBeVisible();
  }
  return seen;
}

test("open visibility mode renders the approved sections and latest-first order", async ({ page }) => {
  await load(page);

  await expect(page.locator("html")).toHaveAttribute("data-card-visibility", "open");
  await expect(page.locator("#unlockAll")).toBeHidden();
  await expect(page.locator("#unlockChoice")).toBeHidden();

  const firstCard = page.locator(".card").first();
  await expect(firstCard.locator(".front img")).toBeVisible();
  await expect(firstCard.locator(".privacy-veil")).toBeHidden();
  await expect(firstCard.locator(".privacy-unlock")).toHaveAttribute("data-mode", "save");

  const expected = [
    { name: "繁花·纷落", count: 70, first: ["刻律德菈", "云璃", "雾矢葵", "许知予", "八尺大姐姐", "康娜"] },
    { name: "公开", count: 31, first: ["调月莉音", "认知修改·后宫性生活", "星野", "星熊", "星熊", "黑川澪"] },
  ];
  const switcher = page.locator("#authorSwitch");
  for (let round = 0; round < 2; round += 1) {
    for (const section of expected) {
      await expect(page.locator("#authorName")).toHaveText(section.name);
      await expect(page.locator(".card")).toHaveCount(section.count);
      await expect(page.locator("#workCount")).toHaveText(String(section.count).padStart(2, "0"));
      await expect(page.locator("#workTotal")).toHaveText(`/ ${section.count}`);
      if (section.first) {
        const names = await page.locator(".card .card-name b").evaluateAll(elements =>
          elements.slice(0, 6).map(element => element.textContent?.trim() || "")
        );
        expect(names).toEqual(section.first);
      }
      await switcher.click();
      await expect(page.locator(".card").first()).toBeVisible();
    }
  }
});

test("open cards keep detail content and archive controls directly accessible", async ({ page }) => {
  await load(page);
  const candidate = page.locator(".card").first();

  await candidate.locator(".card-flip").evaluate(element => element.click());
  await expect(candidate).toHaveClass(/flipped/);
  // Firefox/WebKit do not reliably hit-test the back face during the 3D flip.
  await page.waitForTimeout(550);
  await expect(candidate.locator(".back-expand")).toBeVisible();
  await expect(candidate.locator(".back-setting-content")).toBeVisible();
  await expect(candidate.locator(".back-setting-content")).not.toHaveText("");
  await expect(candidate.locator(".back-setting-privacy")).toBeHidden();

  await candidate.locator(".back-expand").click();
  await expect(page.locator("#archiveModal")).toHaveJSProperty("open", true);
  await expect(page.locator("#archiveOpening")).not.toHaveText("");
  await expect(page.locator("#archivePersonality")).not.toHaveText("");
  await expect(page.locator("#archiveSetting")).not.toHaveText("");
  await expect(page.locator("#archiveSettingPrivacy")).toBeHidden();
  await expect(page.locator("#downloadCard")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#archiveModal")).toHaveJSProperty("open", false);
});

test("saving an original PNG uses a file download instead of cross-origin navigation", async ({ page }) => {
  await load(page);

  await page.evaluate(() => {
    window.__galleryDownloadCapture = [];
    window.__galleryOriginalCreateElement = document.createElement;
    document.createElement = function (tagName, options) {
      const element = window.__galleryOriginalCreateElement.call(document, tagName, options);
      if (String(tagName).toLowerCase() === "a") {
        element.click = function () {
          window.__galleryDownloadCapture.push({
            href: this.href,
            download: this.download,
          });
        };
      }
      return element;
    };
  });

  try {
    await page.locator(".card").first().locator(".privacy-unlock").click();
    await expect
      .poll(
        () => page.evaluate(() => window.__galleryDownloadCapture?.[0]?.href || ""),
        { timeout: 15000, intervals: [100, 250, 500] }
      )
      .toMatch(/^blob:/);

    const download = await page.evaluate(() => window.__galleryDownloadCapture?.[0] || null);
    expect(download?.href).toMatch(/^blob:/);
    expect(download?.download).toMatch(/-角色卡\.png$/);
  } finally {
    await page.evaluate(() => {
      if (window.__galleryOriginalCreateElement) {
        document.createElement = window.__galleryOriginalCreateElement;
      }
      delete window.__galleryOriginalCreateElement;
      delete window.__galleryDownloadCapture;
    });
  }
});

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
]) {
  test(`no root overflow or card overlap at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await load(page);

    await cycleSections(page, async () => {
      const result = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".card-item:not([hidden])")];
        const rects = cards.map(card => card.getBoundingClientRect());
        const overlaps = [];
        for (let left = 0; left < rects.length; left += 1) {
          for (let right = left + 1; right < rects.length; right += 1) {
            const a = rects[left];
            const b = rects[right];
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 1 && overlapY > 1) {
              overlaps.push([left, right, overlapX, overlapY]);
            }
          }
        }
        const arrowGeometry = [...document.querySelectorAll(".card")].slice(0, 6).map(card => {
          const front = card.querySelector(".front");
          const arrow = card.querySelector(".card-open");
          if (!front || !arrow) return null;
          const frontRect = front.getBoundingClientRect();
          const arrowRect = arrow.getBoundingClientRect();
          const edge = Number.parseFloat(getComputedStyle(front).getPropertyValue("--badge-inset")) || 0;
          return {
            topOffset: arrowRect.top - frontRect.top,
            rightOffset: frontRect.right - arrowRect.right,
            edge,
          };
        }).filter(Boolean);
        return {
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overlaps,
          arrowGeometry,
        };
      });
      expect(result.scrollWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
      expect(result.overlaps).toEqual([]);
      expect(result.arrowGeometry.length).toBeGreaterThan(0);
      for (const geometry of result.arrowGeometry) {
        expect(Math.abs(geometry.topOffset - geometry.edge)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(geometry.rightOffset - geometry.edge)).toBeLessThanOrEqual(1.5);
      }
    });
  });
}

test("archive dialog closes with Escape", async ({ page }) => {
  await load(page);
  const card = page.locator(".card").first();
  await card.locator(".card-flip").evaluate(element => element.click());
  await page.waitForTimeout(550);
  await expect(card.locator(".back-expand")).toBeVisible();
  await card.locator(".back-expand").click();
  await expect(page.locator("#archiveModal")).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#archiveModal")).toHaveJSProperty("open", false);
  await expect(page.locator("body")).not.toHaveClass(/modal-open/);
});

test("external resources load without runtime or CSP errors", async ({ page }) => {
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  await load(page);
  await page.waitForTimeout(400);

  expect(
    errors.filter(message =>
      /Content Security Policy|Refused to|ReferenceError|SyntaxError|Failed to load resource/i.test(message)
    )
  ).toEqual([]);
});
