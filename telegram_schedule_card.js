#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const PLAYWRIGHT_MODULE = "/Users/ahnhyeonji/.hermes/scripts/node_modules/playwright";
const {
  BROWSER_CONTRACT,
  ContractError,
  buildVerification,
  normalizeDrafts,
  parseArgs,
  reviewResponse,
  validateDraftPackage
} = require("./telegram_schedule_contract");

const DEFAULT_DRAFT_DIR = "/Users/ahnhyeonji/.hermes/image_cache/schedule-ai-drafts";

function loadChromium() {
  return require(PLAYWRIGHT_MODULE).chromium;
}

function prepareOutputDir(args) {
  const baseDir = path.resolve(args.outDir);
  fs.mkdirSync(baseDir, { recursive: true });
  if (args.outDirExplicit) return baseDir;
  return fs.mkdtempSync(path.join(baseDir, "run-"));
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
  return String(value || "").replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "시간표";
}

async function readDraftAcknowledgement(page) {
  const review = page.locator(BROWSER_CONTRACT.reviewSelector);
  if (!(await review.count())) return { ok: false, reason: "missing_review_selector", message: "초안 검토 결과 영역이 없습니다." };
  const state = await review.evaluate((node, attribute) => ({
    error: node.classList.contains("is-error"),
    text: node.textContent || "",
    acknowledgement: node.getAttribute(attribute) || ""
  }), BROWSER_CONTRACT.acknowledgementAttribute);
  if (state.error) return { ok: false, reason: "review_error", message: state.text.trim() };
  if (state.acknowledgement && state.acknowledgement !== "accepted") return { ok: false, reason: "review_not_accepted", message: state.text.trim() };
  if (!state.text.includes(BROWSER_CONTRACT.acceptedReviewText)) return { ok: false, reason: "review_not_acknowledged", message: state.text.trim() };
  return { ok: true, message: state.text.trim() };
}

async function renderDraft(page, draft, args, files) {
  await page.goto(args.appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#scheduleModeBtn").click();
  await page.locator("#scheduleSourceMode").selectOption("table");
  await page.locator("#scheduleTitleInput").fill(draft.title);
  await page.locator("#scheduleDayInput").fill(draft.day);
  await page.locator("#scheduleDateInput").fill(draft.date);
  await page.locator("#scheduleDraftInput").fill(JSON.stringify(draft));
  await page.locator("#reviewScheduleDraftBtn").click();
  const review = await readDraftAcknowledgement(page);
  if (!review.ok) throw new ContractError("BROWSER_REVIEW_REJECTED", "초안 검토가 승인되지 않았습니다 (" + draft.identity + "): " + review.message, review);
  const acknowledgement = page.locator(BROWSER_CONTRACT.acknowledgementSelector);
  if (!(await acknowledgement.count())) throw new ContractError("MISSING_BROWSER_ACK", "초안 확인란이 없어 반영할 수 없습니다.");
  if (draft.uncertain.length) throw new ContractError("NEEDS_HUMAN_REVIEW", "불확실 데이터는 자동 확인하지 않습니다 (" + draft.identity + ").", reviewResponse([{ code: "uncertain_data", path: draft.identity, message: "확인 필요" }]));
  await acknowledgement.check();
  const cover = page.locator("#scheduleCoverInput");
  if (!(await cover.isChecked())) await cover.check();
  await page.locator("#applyScheduleDraftBtn").click();
  await page.waitForFunction(() => {
    const info = document.querySelector("#pageInfo")?.textContent || "";
    const status = document.querySelector("#statusText")?.textContent || "";
    return /\d+\s*\/\s*[1-9]\d*/.test(info) && /반영했습니다|만들었습니다/.test(status);
  }, undefined, { timeout: 30000 });
  const pageInfo = await page.locator(BROWSER_CONTRACT.pageInfoSelector).innerText();
  const pageMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(pageInfo.trim());
  const pageCount = pageMatch ? Number(pageMatch[2]) : 0;
  if (pageCount < 2) throw new ContractError("MISSING_COVER_PAGE", "커버와 본문 카드가 모두 생성되지 않았습니다 (" + draft.identity + ").");
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.locator("#downloadCurrent").click();
    const download = await downloadPromise;
    const outputPath = path.join(args.outDir, String(files.length + 1).padStart(2, "0") + "_" + safeName(draft.day) + "_" + (pageIndex + 1) + ".png");
    await download.saveAs(outputPath);
    files.push({
      path: outputPath,
      size: pngSize(outputPath),
      kind: pageIndex === 0 ? "cover" : "content",
      draftIndex: draft.draftIndex,
      sourceId: draft.sourceId,
      sourceName: draft.sourceName,
      sourceIndex: draft.sourceIndex,
      sourceCount: draft.sourceCount,
      sourcePageIndex: draft.pageIndex,
      sourcePageCount: draft.pageCount,
      identity: draft.identity,
      outputPageIndex: pageIndex + 1,
      outputPageCount: pageCount
    });
    if (pageIndex < pageCount - 1) {
      await page.locator("#nextPage").click();
      const expectedPageInfo = (pageIndex + 2) + " / " + pageCount;
      await page.waitForFunction((expected) => document.querySelector("#pageInfo")?.textContent?.trim() === expected, expectedPageInfo, { timeout: 30000 });
    }
  }
  return { draftIndex: draft.draftIndex, identity: draft.identity, pageCount };
}

async function buildCards(args) {
  const jsonPath = args.jsonPath || (args.latest ? findLatestDraftPath() : "");
  if (!jsonPath) throw new ContractError("MISSING_INPUT", "--json <JSON_PATH> 또는 --latest-file을 지정해주세요.");
  const validation = validateDraftPackage(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
  if (!validation.ok) throw new ContractError("NEEDS_HUMAN_REVIEW", validation.response.message, validation.response);
  const drafts = validation.drafts;
  const runDir = prepareOutputDir(args);
  const runArgs = { ...args, outDir: runDir };
  const browser = await loadChromium().launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const files = [];
  const renderedDrafts = [];
  try {
    for (const draft of drafts) renderedDrafts.push(await renderDraft(page, draft, runArgs, files));
  } finally {
    await browser.close();
  }
  const verification = buildVerification({ sourcePath: jsonPath, appUrl: args.appUrl, runDir, drafts, files, renderedDrafts });
  const verificationPath = path.join(runDir, "verification.json");
  fs.writeFileSync(verificationPath, JSON.stringify(verification, null, 2) + "\n");
  if (!verification.ok) throw new Error("시간표 검증 실패: " + verificationPath);
  for (const file of files) console.log("MEDIA:" + path.resolve(file.path));
  console.log(JSON.stringify({ ok: true, cards: files.length, runDir, verification: verificationPath }));
}

function selfTest() {
  const result = validateDraftPackage({ drafts: [{ sourceId: "self-test", title: "테스트 대회", day: "제1일 경기", date: "2026. 9. 14.", track: [{ time: "08:00", event: "100m", division: "남고", round: "결승" }], field: [] }] });
  if (!result.ok || result.drafts[0].track[0].event !== "100m") throw new Error("normalizeDrafts self-test failed");
  console.log(JSON.stringify({ ok: true, checks: ["drafts-shape", "track-row-normalization", "metadata-review"] }));
}

function printHelp() {
  console.log("사용법: telegram_schedule_card.js --json <AI_JSON_PATH> | --latest-file [--app-url URL] [--out-dir DIR]");
  console.log("AI/vision 구조화 JSON만 입력합니다. 커버와 트랙/필드 카드를 함께 렌더링합니다.");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) printHelp();
    else if (args.selfTest) selfTest();
    else await buildCards(args);
  } catch (error) {
    const response = error instanceof ContractError && error.response ? error.response : { status: "error", action: "inspect_logs_and_retry", message: error.message };
    console.error(JSON.stringify({ ok: false, code: error.code || "RUNTIME_ERROR", ...response }));
    process.exitCode = error.code === "NEEDS_HUMAN_REVIEW" ? 2 : 1;
  }
}

if (require.main === module) main();

module.exports = { BROWSER_CONTRACT, buildVerification, findLatestDraftPath, normalizeDrafts, parseArgs, pngSize, prepareOutputDir, validateDraftPackage };
