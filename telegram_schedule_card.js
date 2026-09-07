#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("/Users/ahnhyeonji/.hermes/scripts/node_modules/playwright");

const DEFAULT_APP_URL = "https://kaaf-result-card-maker.onrender.com/";
const DEFAULT_DRAFT_DIR = "/Users/ahnhyeonji/.hermes/image_cache/schedule-ai-drafts";
const DEFAULT_OUTPUT_DIR = "/Users/ahnhyeonji/.hermes/image_cache/schedule-cards";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return [
    ...(Array.isArray(value.left) ? value.left.map((row) => ({ ...row, column: row.column || "left" })) : []),
    ...(Array.isArray(value.right) ? value.right.map((row) => ({ ...row, column: row.column || "right" })) : [])
  ];
}

function normalizeRow(row) {
  const value = row && typeof row === "object" ? row : {};
  return {
    time: clean(value.time || value.시간),
    event: clean(value.eventName || value.event || value.종목),
    division: clean(value.division || value.category || value.class || value.종별 || value.부별),
    round: clean(value.round || value.라운드),
    p: clean(value.p || value.P),
    column: clean(value.column || value.side || value.열 || value.구역)
  };
}

function normalizeDraft(draft, index) {
  const source = draft && typeof draft === "object" ? draft : {};
  const track = rows(source.track || source.tracks).map(normalizeRow);
  const field = rows(source.field || source.fields).map(normalizeRow);
  return {
    title: clean(source.title || source.competition_name || source.competition || "경기시간표"),
    day: clean(source.day || source.day_label || source.일차),
    date: clean(source.date || source.date_label || source.날짜),
    track,
    field,
    uncertain: Array.isArray(source.uncertain) ? source.uncertain : [],
    sourceIndex: index + 1
  };
}

function normalizeDrafts(value) {
  const source = value && typeof value === "object" ? value : {};
  if (Array.isArray(source.drafts)) return source.drafts.map(normalizeDraft);
  if (Array.isArray(source.days)) return source.days.map(normalizeDraft);
  if (source.track || source.tracks || source.field || source.fields) return [normalizeDraft(source, 0)];
  return [];
}

function listJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== "cards") found.push(...listJsonFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".json")) found.push(fullPath);
  }
  return found;
}

function findLatestDraftPath(root = DEFAULT_DRAFT_DIR) {
  const files = listJsonFiles(root);
  if (!files.length) throw new Error(`AI 초안 JSON을 찾지 못했습니다: ${root}`);
  return files.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
}

function pngSize(filePath) {
  const header = fs.readFileSync(filePath);
  if (header.length < 24 || header.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function safeName(value) {
  return clean(value).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "시간표";
}

function parseArgs(argv) {
  const args = { appUrl: process.env.KAAF_RESULT_CARD_URL || DEFAULT_APP_URL, outDir: process.env.KAAF_SCHEDULE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.jsonPath = argv[++index];
    else if (token === "--latest-file") args.latest = true;
    else if (token === "--app-url") args.appUrl = argv[++index];
    else if (token === "--out-dir") args.outDir = argv[++index];
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help") args.help = true;
  }
  return args;
}

async function buildCards(args) {
  const jsonPath = args.jsonPath || (args.latest ? findLatestDraftPath() : "");
  if (!jsonPath) throw new Error("--json <JSON_PATH> 또는 --latest-file을 지정해주세요.");
  const drafts = normalizeDrafts(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
  if (!drafts.length) throw new Error("시간표 행이 있는 drafts/track/field JSON을 찾지 못했습니다.");

  fs.mkdirSync(args.outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const files = [];
  const invalid = [];
  try {
    for (const draft of drafts) {
      const rowsToCheck = [...draft.track, ...draft.field];
      invalid.push(...rowsToCheck.filter((row) => !/^\d{1,2}:\d{2}$/.test(row.time) || !row.event || !row.division).map((row) => ({ sourceIndex: draft.sourceIndex, row })));
      await page.goto(args.appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator("#scheduleModeBtn").click();
      await page.locator("#scheduleSourceMode").selectOption("table");
      await page.locator("#scheduleTitleInput").fill(draft.title);
      await page.locator("#scheduleDayInput").fill(draft.day);
      await page.locator("#scheduleDateInput").fill(draft.date);
      await page.locator("#scheduleDraftInput").fill(JSON.stringify(draft));
      await page.locator("#reviewScheduleDraftBtn").click();
      const review = page.locator("#scheduleDraftReview");
      if (await review.evaluate((node) => node.classList.contains("is-error"))) {
        throw new Error(`초안 검토 실패 (${draft.sourceIndex}번째): ${await review.innerText()}`);
      }
      await page.locator("#applyScheduleDraftBtn").click();
      const cover = page.locator("#scheduleCoverInput");
      if (await cover.isChecked()) await cover.uncheck();
      await page.waitForFunction(() => document.querySelector("#pageInfo")?.textContent !== "0 / 0");
      const pageCount = Number((await page.locator("#pageInfo").innerText()).split("/")[1]?.trim());
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
        await page.locator("#downloadCurrent").click();
        const download = await downloadPromise;
        const outputPath = path.join(args.outDir, `${String(files.length + 1).padStart(2, "0")}_${safeName(draft.day || `일정_${draft.sourceIndex}`)}_${pageIndex + 1}.png`);
        await download.saveAs(outputPath);
        files.push({ path: outputPath, size: pngSize(outputPath), sourceIndex: draft.sourceIndex, page: pageIndex + 1 });
        if (pageIndex < pageCount - 1) {
          await page.locator("#nextPage").click();
          const expectedPageInfo = `${pageIndex + 2} / ${pageCount}`;
          await page.waitForFunction(
            (expected) => document.querySelector("#pageInfo")?.textContent === expected,
            expectedPageInfo
          );
        }
      }
    }
  } finally {
    await browser.close();
  }

  const verification = {
    ok: files.length > 0 && files.every((file) => file.size?.width === 1080 && file.size?.height === 1350) && invalid.length === 0,
    source: path.resolve(jsonPath),
    appUrl: args.appUrl,
    files,
    uncertain: drafts.flatMap((draft) => draft.uncertain.map((item) => ({ sourceIndex: draft.sourceIndex, item }))),
    invalid
  };
  const verificationPath = path.join(args.outDir, "verification.json");
  fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.ok) throw new Error(`시간표 검증 실패: ${verificationPath}`);
  for (const file of files) console.log(`MEDIA:${path.resolve(file.path)}`);
  console.log(JSON.stringify({ ok: true, cards: files.length, verification: verificationPath }));
}

function selfTest() {
  const drafts = normalizeDrafts({ drafts: [{ day: "제3일 경기", track: [{ time: "08:00", event: "100m", division: "남고", round: "결승" }], field: [] }] });
  if (drafts.length !== 1 || drafts[0].track[0].event !== "100m") throw new Error("normalizeDrafts self-test failed");
  console.log(JSON.stringify({ ok: true, checks: ["drafts-shape", "track-row-normalization"] }));
}

function printHelp() {
  console.log("사용법: telegram_schedule_card.js --json <JSON_PATH> | --latest-file [--app-url URL] [--out-dir DIR]");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) printHelp();
else if (args.selfTest) selfTest();
else buildCards(args).catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { findLatestDraftPath, normalizeDrafts, pngSize };
