const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("playwright/test");

const BASE_URL = process.env.KAAF_TIMETABLE_UI_BASE_URL || "http://127.0.0.1:5173";
const EVIDENCE_DIR = path.resolve(".omo/evidence/frontend-qa");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function dataUrlBuffer(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

function makePdf(labels) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${labels.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${labels.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  labels.forEach((label, index) => {
    const pageNumber = 4 + index * 2;
    const streamNumber = pageNumber + 1;
    const escaped = String(label).replace(/[\\()]/g, "\\$&");
    const stream = `BT /F1 22 Tf 72 720 Td (${escaped}) Tj 0 -42 Td (08:00 FIELD FINAL) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamNumber} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`
    );
  });
  let body = "%PDF-1.4\n%\xff\xff\xff\xff\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "binary");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

async function makeRasterFiles(page) {
  const values = await page.evaluate(() => {
    const make = (label, type) => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1400;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#082d63";
      ctx.font = "bold 42px Arial";
      ctx.fillText(label, 60, 105);
      return canvas.toDataURL(type, 0.92);
    };
    return {
      day1Track: make("DAY 1 TRACK", "image/png"),
      day1Field: make("DAY 1 FIELD", "image/jpeg"),
      day2Track: make("DAY 2 TRACK", "image/png")
    };
  });
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, dataUrlBuffer(value)]));
}

test("five-file timetable, OCR acknowledgement, full text, and local PDF renderer", async ({ page }) => {
  const pdfRequests = [];
  await page.addInitScript(() => {
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    window.__captureTimetableDraws = false;
    window.__timetableDraws = [];
    CanvasRenderingContext2D.prototype.fillText = function capture(text, x, y, maxWidth) {
      if (window.__captureTimetableDraws) window.__timetableDraws.push(String(text));
      return originalFillText.call(this, text, x, y, maxWidth);
    };
  });
  page.on("response", (response) => {
    if (/pdf\.js/i.test(response.url())) pdfRequests.push({ url: response.url(), status: response.status() });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator("#scheduleModeBtn").click();
  await page.locator("#scheduleTitleInput").fill("2026 전국육상선수권 경기시간표");
  const rasters = await makeRasterFiles(page);
  await page.locator("#schedulePhotoInput").setInputFiles([
    { name: "제1일_2026-06-29_트랙.png", mimeType: "image/png", buffer: rasters.day1Track },
    { name: "제1일_2026-06-29_필드.jpg", mimeType: "image/jpeg", buffer: rasters.day1Field },
    { name: "제2일_2026-06-30_공지.png", mimeType: "image/png", buffer: rasters.day2Track },
    { name: "제2일_2026-06-30_필드.pdf", mimeType: "application/pdf", buffer: makePdf(["DAY 2 FIELD"]) },
    { name: "제3일_2026-07-01_트랙.pdf", mimeType: "application/pdf", buffer: makePdf(["DAY 3 TRACK 1", "DAY 3 TRACK 2"]) }
  ]);
  await page.evaluate(() => {
    window.__timetableDraws = [];
    window.__captureTimetableDraws = true;
  });
  await page.locator("#buildScheduleBtn").click();
  await page.waitForFunction(() => document.querySelector("#statusText")?.textContent.includes("원본 보존 카드로 만들었습니다"), null, { timeout: 30000 });
  assert.equal(await page.locator("#pageInfo").innerText(), "1 / 7");
  assert.equal(await page.locator("#scheduleProgress").isHidden(), true);
  const pdfRuntime = await page.evaluate(() => ({
    loaded: Boolean(window.pdfjsLib),
    scripts: [...document.scripts].map((script) => script.src).filter((src) => /pdf/i.test(src)),
    workerSrc: window.pdfjsLib?.GlobalWorkerOptions?.workerSrc || ""
  }));
  assert.equal(pdfRuntime.loaded, true);
  assert.ok(pdfRuntime.scripts.some((url) => url.includes("vendor/pdfjs/pdf.min.js")));
  assert.ok(pdfRuntime.workerSrc.includes("vendor/pdfjs/pdf.worker.min.js"));
  assert.equal(pdfRequests.some((item) => item.url.includes("cdnjs.cloudflare.com")), false);

  const coverTexts = await page.evaluate(() => window.__timetableDraws);
  assert.ok(coverTexts.includes("포함 일차: 제1일 경기 · 제2일 경기 · 제3일 경기"));
  assert.ok(coverTexts.includes("포함 날짜: 2026. 6. 29. · 2026. 6. 30. · 2026. 7. 1."));
  assert.ok(coverTexts.some((text) => text.includes("시간표")));
  assert.equal(coverTexts.includes("TRACK"), false);
  assert.equal(coverTexts.includes("FIELD"), false);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "timetable-cover.png"), fullPage: true });

  const currentDownload = page.waitForEvent("download");
  await page.locator("#downloadCurrent").click();
  const currentPath = await (await currentDownload).path();
  const currentBytes = fs.readFileSync(currentPath);
  assert.equal(currentBytes.readUInt32BE(16), 1080);
  assert.equal(currentBytes.readUInt32BE(20), 1350);

  const zipDownload = page.waitForEvent("download");
  await page.locator("#downloadAll").click();
  const zipPath = await (await zipDownload).path();
  const zipBytes = fs.readFileSync(zipPath);
  assert.equal((zipBytes.toString("binary").match(/PK\x03\x04/g) || []).length, 7);

  await page.locator("#scheduleSourceMode").selectOption("table");
  const longTitle = `제80회 전국육상경기선수권대회 공식 경기 일정 및 세부 종목 안내 ${"초장문 제목 ".repeat(10)}`;
  await page.locator("#scheduleTitleInput").fill(longTitle);
  await page.locator("#scheduleDayInput").fill("제3일 경기");
  await page.locator("#scheduleDateInput").fill("2026. 6. 29.(월)");
  await page.locator("#scheduleTrackInput").fill("08:00 | UNIQUE_TRACK_ROW_03 | 남고 | 결승\n08:10 | 긴 경기명 전체 보존 확인용 종목 | 남고 | 결승");
  await page.locator("#scheduleFieldInput").fill("10:00 | UNIQUE_FIELD_ROW_01 | 여고 | 결승");
  const draft = JSON.stringify({
    title: longTitle,
    day: "제3일 경기",
    date: "2026. 6. 29.(월)",
    track: [{ time: "08:00", event: "UNIQUE_TRACK_ROW_01", division: "남고", round: "결승" }],
    field: [{ time: "10:00", event: "UNIQUE_FIELD_ROW_01", division: "여고", round: "결승" }],
    uncertain: [{ field: "date", value: "2026. 6. 29.", note: "OCR uncertain" }]
  });
  await page.locator("#scheduleDraftInput").fill(draft);
  await page.locator("#reviewScheduleDraftBtn").click();
  await page.locator("#applyScheduleDraftBtn").click();
  assert.match(await page.locator("#statusText").innerText(), /확인란/);
  assert.equal(await page.locator("#scheduleDraftAcknowledge").isChecked(), false);

  await page.locator("#scheduleDraftAcknowledge").check();
  await page.evaluate(() => { window.__timetableDraws = []; });
  await page.locator("#applyScheduleDraftBtn").click();
  await page.waitForFunction(() => document.querySelector("#pageInfo")?.textContent === "1 / 3", null, { timeout: 10000 });
  const tableTexts = await page.evaluate(() => window.__timetableDraws);
  assert.ok(tableTexts.some((text) => text.includes("OCR 확인 완료")));
  assert.equal(tableTexts.some((text) => text.endsWith("…")), false);
  assert.ok(tableTexts.join(" ").includes("2026. 6. 29.(월)"));
  assert.ok(tableTexts.join("").replace(/\s+/g, "").includes(longTitle.replace(/\s+/g, "")));
  assert.equal(await page.locator("#downloadAll").isDisabled(), false);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "timetable-table-acknowledged.png"), fullPage: true });

  await page.locator("#nextPage").click();
  await page.waitForFunction(() => document.querySelector("#pageInfo")?.textContent === "2 / 3");
  const trackTexts = await page.evaluate(() => window.__timetableDraws);
  assert.ok(trackTexts.join("").replace(/\s+/g, "").includes("UNIQUE_TRACK_ROW_01"));
  await page.locator("#nextPage").click();
  await page.waitForFunction(() => document.querySelector("#pageInfo")?.textContent === "3 / 3");
  const fieldTexts = await page.evaluate(() => window.__timetableDraws);
  assert.ok(fieldTexts.join("").replace(/\s+/g, "").includes("UNIQUE_FIELD_ROW_01"));

  await page.locator("#scheduleDateInput").fill("2026. 6. 30.(화)");
  assert.equal(await page.locator("#scheduleDraftAcknowledge").isChecked(), false);
  assert.equal(await page.locator("#downloadAll").isDisabled(), true);

  await page.locator("#scheduleTitleInput").fill("불가능할 정도로 긴 제목 ".repeat(80));
  await page.locator("#buildScheduleBtn").click();
  await page.waitForFunction(() => document.querySelector("#statusText")?.textContent.includes("너무 깁니다"), null, { timeout: 10000 });
  assert.equal(await page.locator("#downloadAll").isDisabled(), true);
});
