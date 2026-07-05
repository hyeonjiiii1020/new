#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const LOCAL_APP_URL = "file:///Users/ahnhyeonji/Documents/Codex/2026-05-11/files-mentioned-by-the-user-img/upload-to-github-new/index.html";
const APP_URL = LOCAL_APP_URL;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const DEFAULT_BURST_WINDOW_MS = 15 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    json: null,
    files: [],
    latestFile: false,
    outDir: "",
    appUrl: APP_URL,
    title: "",
    day: "",
    date: "",
    cover: true,
    photoCard: false,
    ocrFallback: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = argv[++i];
    } else if (token === "--file" || token === "--image" || token === "--pdf") {
      args.files.push(argv[++i]);
    } else if (token === "--latest-file") {
      args.latestFile = true;
    } else if (token === "--photo-card") {
      args.photoCard = true;
    } else if (token === "--ocr-fallback") {
      args.ocrFallback = true;
    } else if (token === "--out-dir") {
      args.outDir = argv[++i];
    } else if (token === "--app-url") {
      args.appUrl = argv[++i];
    } else if (token === "--title") {
      args.title = argv[++i];
    } else if (token === "--day") {
      args.day = argv[++i];
    } else if (token === "--date") {
      args.date = argv[++i];
    } else if (token === "--no-cover") {
      args.cover = false;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      args.files.push(token);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node telegram_schedule_card.js --json schedule.json [--out-dir DIR]
  node telegram_schedule_card.js --file original.jpg --ocr-fallback [--out-dir DIR]
  node telegram_schedule_card.js --latest-file --ocr-fallback
  node telegram_schedule_card.js --file original.jpg --photo-card

Outputs:
  - PNG files sized 1080x1350
  - verification.json
  - MEDIA:/absolute/path.png lines for Telegram/Hermes
`);
}

function requirePlaywright() {
  const candidates = [
    "playwright",
    "/Users/ahnhyeonji/.hermes/scripts/node_modules/playwright",
    "/Users/ahnhyeonji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node_modules/playwright",
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== "MODULE_NOT_FOUND") {
        throw error;
      }
    }
  }

  throw new Error("Playwright를 찾지 못했습니다. Hermes 스크립트용 node_modules에 playwright가 필요합니다.");
}

function sanitizeName(value) {
  return String(value || "schedule")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "schedule";
}

async function ensureOutDir(requested) {
  const dir = requested
    ? path.resolve(requested)
    : path.join(os.homedir(), ".hermes", "image_cache", "schedule-cards", new Date().toISOString().replace(/[:.]/g, "-"));
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function listFiles(dir, depth = 2) {
  const output = [];
  async function walk(current, level) {
    if (level > depth) return;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, level + 1);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }
  await walk(dir, 0);
  return output;
}

async function findLatestInputFile() {
  const roots = [
    path.join(os.homedir(), ".hermes", "cache"),
    path.join(os.homedir(), ".hermes", "image_cache"),
    path.join(os.homedir(), ".hermes", "images"),
    path.join(os.homedir(), "Downloads"),
    process.cwd(),
  ];
  const now = Date.now();
  const candidates = [];

  for (const root of roots) {
    const files = await listFiles(root, root.includes(".hermes") ? 4 : 1);
    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext)) continue;
      if (filePath.includes(`${path.sep}image_cache${path.sep}kaaf-result-cards${path.sep}`)) continue;
      if (filePath.includes(`${path.sep}image_cache${path.sep}schedule-cards${path.sep}`)) continue;
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > RECENT_WINDOW_MS) continue;
      candidates.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  if (!candidates[0]) {
    throw new Error("최근 48시간 안의 시간표 이미지/PDF를 찾지 못했습니다. --file 또는 --json 경로를 직접 넣어주세요.");
  }
  return candidates[0].filePath;
}

async function findLatestInputFiles() {
  const roots = [
    path.join(os.homedir(), ".hermes", "cache"),
    path.join(os.homedir(), ".hermes", "image_cache"),
    path.join(os.homedir(), ".hermes", "images"),
    path.join(os.homedir(), "Downloads"),
    process.cwd(),
  ];
  const now = Date.now();
  const candidates = [];

  for (const root of roots) {
    const files = await listFiles(root, root.includes(".hermes") ? 4 : 1);
    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext)) continue;
      if (filePath.includes(`${path.sep}image_cache${path.sep}kaaf-result-cards${path.sep}`)) continue;
      if (filePath.includes(`${path.sep}image_cache${path.sep}schedule-cards${path.sep}`)) continue;
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > RECENT_WINDOW_MS) continue;
      candidates.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  if (!candidates[0]) {
    throw new Error("최근 48시간 안의 시간표 이미지/PDF를 찾지 못했습니다. --file 또는 --json 경로를 직접 넣어주세요.");
  }

  const newest = candidates[0].mtimeMs;
  const burstWindow = Number(process.env.KAAF_SCHEDULE_BURST_MINUTES || 15) * 60 * 1000 || DEFAULT_BURST_WINDOW_MS;
  const cachePreferred = candidates.filter((candidate) =>
    candidate.filePath.includes(`${path.sep}.hermes${path.sep}image_cache${path.sep}`) &&
    newest - candidate.mtimeMs <= burstWindow
  );
  const burst = (cachePreferred.length ? cachePreferred : candidates.filter((candidate) => newest - candidate.mtimeMs <= burstWindow))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath))
    .map((candidate) => candidate.filePath);

  return [...new Set(burst)];
}

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function saveDataUrl(dataUrl, filePath) {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    throw new Error("미리보기 이미지 데이터가 PNG 형식이 아닙니다.");
  }
  const buffer = Buffer.from(match[1], "base64");
  await fsp.writeFile(filePath, buffer);
  return pngSize(buffer);
}

async function convertPdfToImages(pdfPath, outDir) {
  const pdftoppm = "/Users/ahnhyeonji/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm";
  if (!(await fileExists(pdftoppm))) {
    throw new Error("PDF 변환 도구 pdftoppm을 찾지 못했습니다.");
  }

  const baseName = path.join(outDir, `${sanitizeName(path.basename(pdfPath, path.extname(pdfPath)))}_page`);
  execFileSync(pdftoppm, ["-png", "-r", "180", pdfPath, baseName], { stdio: "pipe" });
  const dirFiles = await fsp.readdir(outDir);
  return dirFiles
    .filter((name) => name.startsWith(path.basename(baseName)) && name.endsWith(".png"))
    .sort()
    .map((name) => path.join(outDir, name));
}

async function normalizeInputFiles(files, outDir) {
  const normalized = [];
  for (const raw of files) {
    const filePath = path.resolve(raw);
    if (!(await fileExists(filePath))) {
      throw new Error(`파일을 찾지 못했습니다: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      normalized.push(filePath);
    } else if (PDF_EXTENSIONS.has(ext)) {
      const converted = await convertPdfToImages(filePath, outDir);
      normalized.push(...converted);
    } else {
      throw new Error(`지원하지 않는 파일 형식입니다: ${filePath}`);
    }
  }
  return normalized;
}

async function loadJsonDrafts(jsonPath) {
  const text = await fsp.readFile(path.resolve(jsonPath), "utf8");
  const payload = JSON.parse(text);
  const drafts = Array.isArray(payload) ? payload : Array.isArray(payload?.drafts) ? payload.drafts : [payload];
  if (!drafts.length || drafts.some((draft) => !draft || typeof draft !== "object" || Array.isArray(draft))) {
    throw new Error("JSON 초안은 객체 또는 drafts 배열 형식이어야 합니다.");
  }
  return drafts;
}

function rowsFromDraft(draft, key) {
  const direct = Array.isArray(draft[key]) ? draft[key] : [];
  const am = Array.isArray(draft[`${key}_am`]) ? draft[`${key}_am`] : [];
  const pm = Array.isArray(draft[`${key}_pm`]) ? draft[`${key}_pm`] : [];
  return [...direct, ...am, ...pm]
    .map((row) => ({
      time: row.time || "",
      eventName: row.eventName || row.event || row.name || "",
      division: row.division || row.category || row.gender || row.group || "",
      round: row.round || row.stage || row.phase || "",
      side: row.side || row._side || "",
      y: Number(row.y || row._y || 0),
    }))
    .filter((row) => row.time || row.eventName || row.division || row.round)
    .sort((a, b) => {
      const sideRank = (side) => side === "right" ? 1 : 0;
      return sideRank(a.side) - sideRank(b.side) || a.y - b.y || a.time.localeCompare(b.time);
    });
}

function inferDayFromJsonPath(jsonPath, index, total) {
  const fileName = path.basename(String(jsonPath || "")).normalize("NFC");
  const match =
    fileName.match(/day[_\-\s]*(\d{1,2})/i) ||
    fileName.match(/제\s*(\d{1,2})\s*일/) ||
    fileName.match(/(\d{1,2})\s*일차/);
  if (match) {
    return `제${Number(match[1])}일 경기`;
  }
  return total > 1 ? `제${index + 1}일 경기` : "";
}

function inferDayFromText(value) {
  const text = String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const match =
    text.match(/제\s*(\d{1,2})\s*일\s*경기/) ||
    text.match(/제\s*(\d{1,2})\s*일차/) ||
    text.match(/(^|[^0-9])(\d{1,2})\s*일차/);
  if (!match) return "";
  const dayNumber = Number(match[2] || match[1]);
  return Number.isFinite(dayNumber) && dayNumber > 0 ? `제${dayNumber}일 경기` : "";
}

function inferDayFromDraft(draft, jsonPath, index, total) {
  return (
    inferDayFromText(draft?.title) ||
    inferDayFromText(draft?.day) ||
    String(draft?.day || "").trim() ||
    inferDayFromJsonPath(jsonPath, index, total)
  );
}

function draftTitleForInput(draft) {
  const title = String(draft?.meetName || draft?.title || "").trim();
  return inferDayFromText(title) ? String(draft?.meetName || "").trim() : title;
}

function rowToScheduleInput(row) {
  return [row.time, row.eventName, row.division, row.round]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .join(" | ");
}

function normalizeOcrText(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[“”〃]/g, '"')
    .replace(/[：]/g, ":")
    .replace(/[|｜│]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOcrTime(value) {
  const raw = normalizeOcrText(value)
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/S/g, "5");
  const separated = raw.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  let hour = "";
  let minute = "";

  if (separated) {
    hour = separated[1];
    minute = separated[2];
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 3) {
      hour = digits.slice(0, 1);
      minute = digits.slice(1);
    } else if (digits.length === 4) {
      hour = digits.slice(0, 2);
      minute = digits.slice(2);
    } else if (digits.length === 5) {
      hour = digits.slice(0, 2);
      minute = digits.slice(-2);
    }
  }

  if (!hour || !minute) return "";
  let numericHour = Number(hour);
  const numericMinute = Number(minute);
  if (numericHour > 23 && hour.startsWith("7")) {
    numericHour = Number(`1${hour.slice(1)}`);
  }
  if (!Number.isFinite(numericHour) || !Number.isFinite(numericMinute)) return "";
  if (numericHour < 0 || numericHour > 23 || numericMinute < 0 || numericMinute > 59) return "";
  return `${String(numericHour).padStart(2, "0")}:${String(numericMinute).padStart(2, "0")}`;
}

function normalizeOcrEvent(value) {
  let text = normalizeOcrText(value);
  if (!text || /^["']+$/.test(text)) return "";
  text = text
    .replace(/[Oo]/g, "0")
    .replace(/[ＡA](?=00m)/g, "4")
    .replace(/[ＤD]/g, "0")
    .replace(/rn/g, "m")
    .replace(/ｍ/g, "m")
    .replace(/10[0o]rH/i, "100mH")
    .replace(/100rH/i, "100mH")
    .replace(/4\s*[x×]\s*100\s*m?\s*R/i, "4x100mR")
    .replace(/4\s*[x×]\s*10\s*0mR/i, "4x100mR")
    .replace(/^4U0m$/i, "400m")
    .replace(/mn$/i, "m")
    .replace(/\s+/g, "");
  return text;
}

function adjustTimeForSide(time, side) {
  const match = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!match) return time;
  let hour = Number(match[1]);
  if (side === "right" && hour > 0 && hour < 8) {
    hour += 10;
  }
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function normalizeOcrRound(value) {
  let text = normalizeOcrText(value);
  if (!text || /^["']+$/.test(text)) return "";
  text = text
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/기\)/g, "1)")
    .replace(/\s+/g, "");
  const compactHeat = text.match(/^(\d)(\d)\+(\d)$/);
  if (compactHeat) return `${compactHeat[1]}-${compactHeat[2]}+${compactHeat[3]}`;
  return text;
}

function normalizeOcrDivision(value) {
  return normalizeOcrText(value)
    .replace(/^[-–—,.:;]+|[-–—,.:;]+$/g, "")
    .replace(/\s+/g, "");
}

function textLooksHeader(value) {
  return /경기시간표|시간|종목|종별|부별|라운드|트\s*랙|필\s*드|^\s*P\s*$/i.test(normalizeOcrText(value));
}

function joinColumnTexts(items, normalizer = normalizeOcrText) {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => normalizer(item.text))
    .filter(Boolean)
    .join("");
}

function sectionForY(y, sectionMarks) {
  if (sectionMarks.fieldY && y > sectionMarks.fieldY) return "field";
  return "track";
}

function draftFromOcrPage(page) {
  const width = page.width || 1;
  const height = page.height || 1;
  const items = (page.items || [])
    .map((item) => ({ ...item, text: normalizeOcrText(item.text) }))
    .filter((item) => item.text && item.confidence >= 0.12);

  const sectionMarks = {
    trackY: 0,
    fieldY: 0,
  };
  for (const item of items) {
    if (/트\s*랙|트.*경.*기/.test(item.text)) sectionMarks.trackY = sectionMarks.trackY || item.y;
    if (/필\s*드|필.*경.*기/.test(item.text)) sectionMarks.fieldY = sectionMarks.fieldY || item.y;
  }

  const draft = {
    title: "경기시간표",
    day: "",
    date: "",
    track: [],
    field: [],
    uncertain: [],
    source: page.path,
  };

  const topItems = items.filter((item) => item.y < height * 0.16);
  const dayCandidate = topItems.find((item) => /제.*일.*경기/.test(item.text));
  if (dayCandidate) draft.day = normalizeOcrText(dayCandidate.text).replace(/제기일/, "제1일");
  const dateParts = topItems
    .map((item) => item.text)
    .filter((text) => /\d{4}|\d{1,2}\s*[.]\s*\d{1,2}|[월화수목금토일]\)/.test(text));
  if (dateParts.length) draft.date = normalizeOcrText(dateParts.join(" "));

  const timeCandidates = items
    .map((item) => ({ ...item, time: normalizeOcrTime(item.text) }))
    .filter((item) => {
      if (!item.time) return false;
      const sideStart = item.x < width / 2 ? 0 : width / 2;
      const relativeX = (item.x - sideStart) / (width / 2);
      return relativeX >= 0 && relativeX < 0.2 && item.y > height * 0.12;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const carry = {
    track: { eventName: "", division: "", round: "" },
    field: { eventName: "", division: "", round: "" },
  };
  const seen = new Set();
  const parsedRows = {
    track: [],
    field: [],
  };

  for (const timeItem of timeCandidates) {
    const sideStart = timeItem.x < width / 2 ? 0 : width / 2;
    const sideEnd = sideStart + width / 2;
    const yTolerance = Math.max(15, height * 0.014);
    const rowItems = items.filter((item) =>
      Math.abs(item.y - timeItem.y) <= yTolerance &&
      item.x >= sideStart &&
      item.x < sideEnd &&
      !textLooksHeader(item.text)
    );
    const cols = [[], [], [], []];
    for (const item of rowItems) {
      const relativeX = (item.x - sideStart) / (width / 2);
      const col = relativeX < 0.18 ? 0 : relativeX < 0.39 ? 1 : relativeX < 0.66 ? 2 : 3;
      cols[col].push(item);
    }

    const side = timeItem.x < width / 2 ? "left" : "right";
    const section = sectionForY(timeItem.y, sectionMarks);
    const time = adjustTimeForSide(timeItem.time, side);
    const eventName = joinColumnTexts(cols[1], normalizeOcrEvent) || carry[section].eventName;
    const division = joinColumnTexts(cols[2], normalizeOcrDivision) || carry[section].division;
    const round = joinColumnTexts(cols[3], normalizeOcrRound) || carry[section].round;
    const key = `${section}:${side}:${time}:${eventName}:${division}:${round}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!eventName && !division && !round) continue;

    const row = {
      time,
      eventName,
      division,
      round,
      side,
      y: timeItem.y,
    };
    parsedRows[section].push(row);
    carry[section] = {
      eventName: row.eventName || carry[section].eventName,
      division: row.division || carry[section].division,
      round: row.round || carry[section].round,
    };
  }

  for (const section of ["track", "field"]) {
    draft[section] = parsedRows[section].sort((a, b) => {
      const sideRank = (side) => side === "right" ? 1 : 0;
      return sideRank(a.side) - sideRank(b.side) || a.y - b.y || a.time.localeCompare(b.time);
    });
  }

  if (!draft.track.length && !draft.field.length) {
    draft.uncertain.push({
      field: "rows",
      note: "OCR에서 시간표 행을 안정적으로 찾지 못했습니다.",
    });
  }

  return draft;
}

function extractOcrPages(files) {
  const script = String.raw`
import json
import sys
from PIL import Image
import easyocr

reader = easyocr.Reader(['ko', 'en'], gpu=False, verbose=False)
payload = []
for path in sys.argv[1:]:
    image = Image.open(path)
    width, height = image.size
    results = reader.readtext(path, detail=1, paragraph=False)
    items = []
    for bbox, text, confidence in results:
        xs = [point[0] for point in bbox]
        ys = [point[1] for point in bbox]
        items.append({
            "x": float(min(xs)),
            "y": float(sum(ys) / len(ys)),
            "w": float(max(xs) - min(xs)),
            "h": float(max(ys) - min(ys)),
            "text": str(text),
            "confidence": float(confidence),
        })
    payload.append({"path": path, "width": width, "height": height, "items": items})
print(json.dumps(payload, ensure_ascii=False))
`;

  const output = execFileSync("python3", ["-c", script, ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONWARNINGS: "ignore",
    },
  });
  return JSON.parse(output);
}

async function draftsFromFiles(files, outDir, args) {
  const ocrPages = extractOcrPages(files);
  const drafts = ocrPages.map((page) => {
    const draft = draftFromOcrPage(page);
    if (args.title) draft.title = args.title;
    if (args.day) draft.day = args.day;
    if (args.date) draft.date = args.date;
    return draft;
  });
  const draftPath = path.join(outDir, "ocr-drafts.json");
  await fsp.writeFile(draftPath, `${JSON.stringify({ drafts }, null, 2)}\n`, "utf8");
  return { drafts, draftPath };
}

async function openSchedulePage(page, appUrl) {
  await page.goto(appUrl, { waitUntil: "networkidle", timeout: 90_000 });
  const modeButton = page.locator("#scheduleModeBtn");
  await modeButton.waitFor({ state: "visible", timeout: 30_000 });
  await modeButton.click();
  await page.locator("#buildScheduleBtn").waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForPreview(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector("#schedulePreviewImage");
    const info = document.querySelector("#pageInfo");
    return Boolean(image && image.src && image.src.startsWith("data:image/png") && info && /\d+\s*\/\s*\d+/.test(info.textContent || ""));
  }, null, { timeout: 60_000 });
}

async function setTextIfPresent(page, selector, value) {
  if (!value) return;
  const input = page.locator(selector);
  if (await input.count()) {
    await input.fill(value);
  }
}

async function fillTextIfPresent(page, selector, value) {
  const input = page.locator(selector);
  if (await input.count()) {
    await input.fill(String(value || ""));
  }
}

async function buildFromJson(page, draft, args) {
  const trackText = rowsFromDraft(draft, "track").map(rowToScheduleInput).join("\n");
  const fieldText = rowsFromDraft(draft, "field").map(rowToScheduleInput).join("\n");
  if (!trackText && !fieldText) {
    throw new Error(`시간표 행을 추출하지 못했습니다: ${draft.source || "JSON 초안"}`);
  }

  await fillTextIfPresent(page, "#scheduleTitleInput", args.title || draft.meetName || draft.title || "");
  await fillTextIfPresent(page, "#scheduleDayInput", args.day || draft.day || "");
  await fillTextIfPresent(page, "#scheduleDateInput", args.date || draft.date || "");
  await page.locator("#scheduleSourceMode").selectOption("table");
  await page.locator("#scheduleCoverInput").setChecked(Boolean(args.cover));
  await page.locator("#scheduleTrackInput").fill(trackText);
  await page.locator("#scheduleFieldInput").fill(fieldText);
  await page.locator("#buildScheduleBtn").click();
  await waitForPreview(page);
}

async function buildPhotoCardsFromFiles(page, files, args) {
  await setTextIfPresent(page, "#scheduleTitleInput", args.title);
  await setTextIfPresent(page, "#scheduleDayInput", args.day);
  await setTextIfPresent(page, "#scheduleDateInput", args.date);
  await page.locator("#scheduleSourceMode").selectOption("photo");
  await page.locator("#schedulePhotoInput").setInputFiles(files);
  await page.locator("#scheduleCoverInput").setChecked(args.cover);
  await page.locator("#buildScheduleBtn").click();
  await waitForPreview(page);
}

async function extractPreviewPages(page, outDir, prefix = "") {
  const files = [];
  const invalid = [];
  const infoText = await page.locator("#pageInfo").textContent();
  const totalMatch = /\/\s*(\d+)/.exec(infoText || "");
  const total = totalMatch ? Number(totalMatch[1]) : 1;

  const prevButton = page.locator("#prevPage");
  for (let i = 0; i < 10; i += 1) {
    if (!(await prevButton.isEnabled())) break;
    await prevButton.click();
    await waitForPreview(page);
  }

  for (let index = 0; index < total; index += 1) {
    const dataUrl = await page.locator("#schedulePreviewImage").getAttribute("src");
    const fileName = `${prefix}${String(index + 1).padStart(2, "0")}_schedule_card.png`;
    const filePath = path.join(outDir, fileName);
    const size = await saveDataUrl(dataUrl, filePath);
    const record = {
      path: filePath,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
    };
    if (!size || size.width !== 1080 || size.height !== 1350) {
      invalid.push({ file: filePath, reason: `PNG size is ${record.width}x${record.height}` });
    }
    files.push(record);

    if (index < total - 1) {
      const nextButton = page.locator("#nextPage");
      await nextButton.click();
      await waitForPreview(page);
    }
  }

  return { files, invalid };
}

async function writeVerification(outDir, payload) {
  const verificationPath = path.join(outDir, "verification.json");
  const verification = {
    ok: payload.invalid.length === 0 && payload.files.length > 0,
    generatedAt: new Date().toISOString(),
    ...payload,
  };
  await fsp.writeFile(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  return { verification, verificationPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = await ensureOutDir(args.outDir);

  if (args.latestFile) {
    args.files.push(...(await findLatestInputFiles()));
  }

  if (!args.json && args.files.length === 0) {
    throw new Error("--json 또는 --file/--latest-file 중 하나가 필요합니다.");
  }

  if (!args.json && !args.photoCard && !args.ocrFallback) {
    throw new Error("정확한 시간표 제작은 AI 추출 JSON이 필요합니다. --json을 사용하거나, 임시 OCR 생성을 원할 때만 --ocr-fallback을 붙여주세요.");
  }

  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => {
    console.error(`[browser pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      console.error(`[browser ${message.type()}] ${message.text()}`);
    }
  });

  try {
    await openSchedulePage(page, args.appUrl);
    let mode = "json";
    let sourceFiles = [];
    let allFiles = [];
    let invalid = [];
    let draftPath = "";
    if (args.json) {
      const drafts = await loadJsonDrafts(args.json);
      draftPath = path.resolve(args.json);
      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        const draftArgs = {
          ...args,
          cover: args.cover && index === 0,
          title: args.title || draftTitleForInput(draft),
          day: args.day || inferDayFromDraft(draft, args.json, index, drafts.length),
          date: args.date || draft.date,
        };
        await buildFromJson(page, draft, draftArgs);
        const prefix = drafts.length > 1 ? `${String(index + 1).padStart(2, "0")}_` : "";
        const extracted = await extractPreviewPages(page, outDir, prefix);
        allFiles.push(...extracted.files);
        invalid.push(...extracted.invalid);
      }
    } else {
      mode = "file";
      sourceFiles = await normalizeInputFiles(args.files, outDir);
      if (args.photoCard) {
        await buildPhotoCardsFromFiles(page, sourceFiles, args);
        const extracted = await extractPreviewPages(page, outDir);
        allFiles = extracted.files;
        invalid = extracted.invalid;
      } else {
        const ocr = await draftsFromFiles(sourceFiles, outDir, args);
        draftPath = ocr.draftPath;
        for (let index = 0; index < ocr.drafts.length; index += 1) {
          const draft = ocr.drafts[index];
          const draftArgs = {
            ...args,
            cover: args.cover && index === 0,
            title: args.title || draftTitleForInput(draft),
            day: args.day || inferDayFromDraft(draft, "", index, ocr.drafts.length),
            date: args.date || draft.date,
          };
          await buildFromJson(page, draft, draftArgs);
          const prefix = ocr.drafts.length > 1 ? `${String(index + 1).padStart(2, "0")}_` : "";
          const extracted = await extractPreviewPages(page, outDir, prefix);
          allFiles.push(...extracted.files);
          invalid.push(...extracted.invalid);
        }
      }
    }

    const { verification, verificationPath } = await writeVerification(outDir, {
      mode,
      appUrl: args.appUrl,
      sourceFiles,
      draftPath,
      verificationPath: path.join(outDir, "verification.json"),
      files: allFiles,
      invalid,
    });

    const summary = verification.ok
      ? `시간표 카드 생성 완료: ${verification.files.length}장`
      : `시간표 카드 생성 검증 실패: ${verification.invalid.length}건`;
    console.log(summary);
    console.log(`verification:${verificationPath}`);
    for (const file of verification.files) {
      console.log(`MEDIA:${file.path}`);
    }
    if (!verification.ok) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`시간표 카드 생성 실패: ${error.message}`);
  process.exit(1);
});
