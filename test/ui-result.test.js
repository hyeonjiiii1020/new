const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("playwright/test");

const BASE_URL = process.env.KAAF_UI_BASE_URL || "http://127.0.0.1:5517";
const EVIDENCE_DIR = path.resolve(".omo/evidence/frontend-qa");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const payload = (eventName, provisional = true) => ({
  tournament: { name: "UI 검증 대회", place: "서울" },
  meta: {
    tournament: "UI 검증 대회",
    place: "서울",
    eventName,
    division: "여자부",
    round: "결승",
    date: "2026-09-14",
    rosterAvailable: false,
    provisional,
    completeness: {
      expected: 3,
      loaded: 2,
      missingEvents: ["4x400mR"],
      source: "derived"
    }
  },
  rows: [{ rank: "1", name: "A B C D", team: "서울시청", record: "50.03", wind: 0 }]
});

async function waitForResult(page) {
  await page.locator("#eventSelect option").first().waitFor({ state: "attached", timeout: 60000 });
  await page.locator("#statusText").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const row = document.querySelector("#cardRows tr");
    return row && !row.textContent.includes("불러오는 중") && !row.textContent.includes("표시할 결과가 없습니다.");
  }, null, { timeout: 60000 });
}

test("result metadata, stale-load clearing, token guard, and mobile export", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    window.__uiDraws = [];
    CanvasRenderingContext2D.prototype.fillText = function capture(text, x, y, maxWidth) {
      window.__uiDraws.push(String(text));
      return originalFillText.call(this, text, x, y, maxWidth);
    };
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitForResult(page);

  await page.route("**/api/result?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload("4x100mR", true))
    });
  });
  await page.locator("#loadBtn").click();
  await expectResult(page, "4x100mR");

  const rowText = await page.locator("#cardRows tr").first().innerText();
  assert.match(rowText, /50\.03/);
  assert.match(rowText, /바람 \+0\.0/);
  assert.match(rowText, /A B C D/);
  assert.match(rowText, /명단 미제공/);
  assert.match(await page.locator("#resultMetaNotice").innerText(), /잠정 집계/);
  assert.equal(await page.locator("#resultMetaNotice").isVisible(), true);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "result-provisional.png"), fullPage: true });

  await page.evaluate(() => { window.__uiDraws = []; });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#downloadCurrent").click();
  await (await downloadEvent).path();
  const drawTexts = await page.evaluate(() => window.__uiDraws);
  assert.ok(drawTexts.some((text) => text.includes("바람 +0.0")), "canvas must include zero wind");
  assert.ok(drawTexts.some((text) => text.includes("잠정 집계")), "canvas must mark provisional output");

  const pending = [];
  await page.unroute("**/api/result?*");
  await page.route("**/api/result?*", async (route) => {
    const index = pending.length;
    await new Promise((resolve) => pending.push(resolve));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload(`EVENT_${index + 1}`, false))
    });
  });

  await page.locator("#loadBtn").click();
  await page.waitForFunction(() => document.querySelector("#statusText")?.textContent.includes("불러오는 중"));
  assert.match(await page.locator("#cardRows").innerText(), /결과를 불러오는 중입니다/);
  assert.equal(await page.locator("#downloadCurrent").isDisabled(), true);
  assert.equal(await page.locator("#downloadAll").isDisabled(), true);

  await page.evaluate(() => {
    const button = document.querySelector("#loadBtn");
    button.disabled = false;
    button.click();
  });
  for (let attempt = 0; attempt < 40 && pending.length < 2; attempt += 1) {
    await page.waitForTimeout(25);
  }
  assert.equal(pending.length, 2, "two overlapping result requests are required for token coverage");
  pending[1]();
  await expectResult(page, "EVENT_2");
  pending[0]();
  await page.waitForTimeout(100);
  assert.match(await page.locator("#cardTitle").innerText(), /EVENT_2/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector("#cardPreview")?.getBoundingClientRect().width < 540, null, { timeout: 5000 });
  const previewBox = await page.locator("#cardPreview").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const wrap = document.querySelector(".preview-wrap").getBoundingClientRect();
    return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), wrapLeft: Math.round(wrap.left), wrapWidth: Math.round(wrap.width) };
  });
  assert.ok(previewBox.width < 540 && previewBox.width <= 390, `preview should scale below 540px, got ${JSON.stringify(previewBox)}`);
  assert.ok(previewBox.left >= 0 && previewBox.right <= 390, `scaled preview must remain visible, got ${JSON.stringify(previewBox)}`);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "result-mobile-390.png"), fullPage: true });
});

async function expectResult(page, title) {
  await page.waitForFunction((expected) => document.querySelector("#cardTitle")?.innerText.includes(expected), title, { timeout: 10000 });
}
