#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP_URL = process.env.KAAF_RESULT_CARD_URL || "https://kaaf-result-card-maker.onrender.com";
const STATE_PATH = path.join(__dirname, "telegram-result-watch-state.json");
const CAPTURE_SCRIPT = process.env.KAAF_CAPTURE_SCRIPT || "/Users/ahnhyeonji/.hermes/scripts/kaaf_capture_result_card.js";
const OUT_ROOT = process.env.KAAF_RESULT_CARD_OUT_DIR || path.join(process.env.HOME || ".", ".hermes", "image_cache", "kaaf-result-cards");
const MAX_SENDS_PER_RUN = Number(process.env.KAAF_WATCH_MAX_SENDS || 1);
const ACTIVE_WINDOW_DAYS = Number(process.env.KAAF_WATCH_ACTIVE_WINDOW_DAYS || 2);
const FETCH_TIMEOUT_MS = Number(process.env.KAAF_WATCH_FETCH_TIMEOUT_MS || 30000);
const DIRECT_SEND = process.env.KAAF_WATCH_DIRECT_SEND === "1";
const DIRECT_SEND_TARGET = process.env.KAAF_WATCH_SEND_TARGET || "telegram";
const NODE_BIN = process.execPath;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function apiUrl(pathname, params = {}) {
  const url = new URL(pathname, APP_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

function activeTournament(tournament) {
  const forced = (process.env.KAAF_WATCH_TOURNAMENTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (forced.length) return forced.includes(tournament.id);

  const [startRaw, endRaw] = String(tournament.period || "").split("~").map((item) => item.trim());
  const start = parseDate(startRaw);
  const end = parseDate(endRaw || startRaw);
  if (!start || !end) return true;

  const now = new Date();
  const padMs = ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() >= start.getTime() - padMs && now.getTime() <= end.getTime() + padMs;
}

function statusLooksReady(status) {
  return /완료|순위|completed|final/i.test(String(status || ""));
}

function statusMayHaveCompletePaceResults(status) {
  return statusLooksReady(status) || /진행중|in_progress/i.test(String(status || ""));
}

function resultLooksSendable(event, resultPayload, fp) {
  if (!fp) return false;
  if (statusLooksReady(event.status)) return true;

  const meta = resultPayload?.meta || {};
  const rawEntryCount = Number(meta.rawEntryCount || 0);
  const rawResultCount = Number(meta.rawResultCount || 0);
  return (
    event.params?.source === "pace" &&
    /진행중|in_progress/i.test(String(event.status || "")) &&
    rawEntryCount > 0 &&
    rawResultCount >= rawEntryCount
  );
}

function rowIdentity(row) {
  return [
    row.rank || "",
    row.team || "",
    row.name || "",
    row.record || "",
    row.wind || "",
    row.heat || "",
    row.remark || ""
  ].join("|");
}

function fingerprint(rows) {
  return rows
    .filter((row) => String(row.record || "").trim())
    .map(rowIdentity)
    .join("\n");
}

function eventKey(event) {
  return `${event.tournament_id}:${event.id}`;
}

function eventParams(tournament, event) {
  return {
    tournament_id: tournament.id,
    ...(event.params || {})
  };
}

function safeName(value) {
  return String(value || "result")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "result";
}

function captureCards(tournament, event) {
  const outDir = path.join(OUT_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });

  const args = [
    CAPTURE_SCRIPT,
    "--tournament-id",
    tournament.id,
    "--event-id",
    String(event.params?.event_id || event.id).replace(/^pace-\d+-/, ""),
    "--event-label",
    event.label,
    "--event-value",
    event.id,
    "--out-dir",
    outDir
  ];

  const result = spawnSync(NODE_BIN, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      KAAF_RESULT_CARD_URL: APP_URL,
      KAAF_RESULT_CARD_OUT_DIR: OUT_ROOT
    },
    timeout: 90000
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "카드 캡처 실패").trim());
  }

  const payload = JSON.parse(result.stdout || "{}");
  if (!payload.ok || !Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error(`카드 캡처 결과가 비어 있습니다: ${result.stdout}`);
  }
  return payload.files;
}

function sendCardsDirectly(tournament, event, files) {
  const body = [
    `${tournament.name}`,
    `${event.label} 결과 카드`,
    ...files.map((file) => `MEDIA:${file}`)
  ].join("\n");

  const result = spawnSync("hermes", ["send", "--to", DIRECT_SEND_TARGET, "--file", "-", "--json"], {
    input: body,
    encoding: "utf8",
    env: process.env,
    timeout: 90000
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "텔레그램 직접 전송 실패").trim());
  }

  const payload = JSON.parse(result.stdout || "{}");
  if (!payload.success) {
    throw new Error(payload.error || result.stdout || "텔레그램 직접 전송 실패");
  }
}

async function main() {
  const state = readJson(STATE_PATH, { events: {} });
  if (!state.events || typeof state.events !== "object") state.events = {};

  const tournamentsPayload = await fetchJson(apiUrl("/api/tournaments"));
  const tournaments = (tournamentsPayload.tournaments || []).filter(activeTournament);
  const mediaLines = [];
  let sentCount = 0;

  for (const tournament of tournaments) {
    if (sentCount >= MAX_SENDS_PER_RUN) break;

    const eventsPayload = await fetchJson(apiUrl("/api/events", { tournament_id: tournament.id }));
    const events = eventsPayload.events || [];

    for (const event of events) {
      if (sentCount >= MAX_SENDS_PER_RUN) break;
      if (!statusMayHaveCompletePaceResults(event.status)) continue;

      const key = eventKey(event);
      const record = state.events[key] || {};
      let resultPayload;
      try {
        resultPayload = await fetchJson(apiUrl("/api/result", eventParams(tournament, event)));
      } catch (error) {
        record.lastError = error.message;
        record.lastTriedAt = Date.now();
        state.events[key] = record;
        continue;
      }

      const rows = Array.isArray(resultPayload.rows) ? resultPayload.rows : [];
      const fp = fingerprint(rows);
      const now = Date.now();
      state.events[key] = {
        ...record,
        tournamentId: tournament.id,
        eventId: event.id,
        label: event.label,
        status: event.status,
        rowCount: rows.length,
        firstSeenAt: record.firstSeenAt || now,
        lastSeenAt: now,
        latestFingerprint: fp
      };

      if (!resultLooksSendable(event, resultPayload, fp)) continue;
      if (record.sentAt || record.sentFingerprint || record.sentMediaFingerprint) continue;

      try {
        const files = captureCards(tournament, event);
        if (DIRECT_SEND) {
          sendCardsDirectly(tournament, event, files);
        } else {
          for (const file of files) {
            mediaLines.push(`MEDIA:${file}`);
          }
        }
        state.events[key] = {
          ...state.events[key],
          sentAt: now,
          sentFingerprint: fp,
          sentMediaFingerprint: fp
        };
        sentCount += 1;
      } catch (error) {
        state.events[key] = {
          ...state.events[key],
          lastError: error.message,
          lastTriedAt: now
        };
      }
    }
  }

  state.updatedAt = new Date().toISOString();
  writeJson(STATE_PATH, state);

  if (!mediaLines.length) return;
  process.stdout.write(mediaLines.join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
