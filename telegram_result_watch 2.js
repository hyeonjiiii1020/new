#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const APP_URL = process.env.KAAF_RESULT_CARD_URL || "https://kaaf-result-card-maker.onrender.com";
const DEFAULT_STATE_PATH = path.join(
  process.env.HOME || "/tmp",
  ".hermes",
  "state",
  "kaaf-result-watch-state.json"
);
const STATE_PATH_CONFIGURED = Boolean(process.env.KAAF_WATCH_STATE_PATH);
const LEGACY_STATE_PATH = path.resolve(
  process.env.KAAF_WATCH_LEGACY_STATE_PATH || path.join(__dirname, "telegram-result-watch-state.json")
);
const STATE_PATH = path.resolve(process.env.KAAF_WATCH_STATE_PATH || DEFAULT_STATE_PATH);
const LOCK_PATH = path.resolve(process.env.KAAF_WATCH_LOCK_PATH || `${STATE_PATH}.lock`);
const CAPTURE_SCRIPT = process.env.KAAF_CAPTURE_SCRIPT || "/Users/ahnhyeonji/.hermes/scripts/kaaf_capture_result_card.js";
const OUT_ROOT = process.env.KAAF_RESULT_CARD_OUT_DIR || path.join(process.env.HOME || ".", ".hermes", "image_cache", "kaaf-result-cards");
const MAX_SENDS_PER_RUN = Number(process.env.KAAF_WATCH_MAX_SENDS || 1);
const ACTIVE_WINDOW_DAYS = Number(process.env.KAAF_WATCH_ACTIVE_WINDOW_DAYS || 2);
const FETCH_TIMEOUT_MS = Number(process.env.KAAF_WATCH_FETCH_TIMEOUT_MS || 30000);
const LOCK_STALE_MS = Number(process.env.KAAF_WATCH_LOCK_STALE_MS || 15 * 60 * 1000);
const DIRECT_SEND = process.env.KAAF_WATCH_DIRECT_SEND === "1";
const DIRECT_SEND_TARGET = process.env.KAAF_WATCH_SEND_TARGET || "telegram";
const NODE_BIN = process.execPath;

function randomToken() {
  return randomBytes(12).toString("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error) {
  return String(error?.message || error || "unknown error").trim().slice(0, 500);
}

function firstOutputLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 240) || "";
}

function processFailure(label, result) {
  const status = result?.status == null
    ? (result?.error?.code || "spawn-error")
    : `exit ${result.status}`;
  const detail = firstOutputLine(result?.stderr) || firstOutputLine(result?.stdout);
  return `${label} failed (${status}${detail ? `: ${detail}` : ""})`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function defaultState() {
  return { version: 2, events: {}, pending: {} };
}

function readState(filePath) {
  let state;
  try {
    state = readJsonFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (!STATE_PATH_CONFIGURED && STATE_PATH === path.resolve(DEFAULT_STATE_PATH) && fs.existsSync(LEGACY_STATE_PATH)) {
        throw new Error("external watch state is missing while legacy checkout state exists; migrate state before enabling the watcher");
      }
      return defaultState();
    }
    if (error instanceof SyntaxError) {
      throw new Error(`watch state is invalid JSON; refusing to reset it: ${filePath}`);
    }
    throw new Error(`watch state could not be read: ${errorMessage(error)}`);
  }

  if (!isRecord(state) || !isRecord(state.events)) {
    throw new Error(`watch state has an invalid events object; refusing to reset it: ${filePath}`);
  }
  if (state.pending == null) state.pending = {};
  if (!isRecord(state.pending)) {
    throw new Error(`watch state has an invalid pending object; refusing to reset it: ${filePath}`);
  }
  for (const [key, value] of Object.entries(state.events)) {
    if (!isRecord(value)) throw new Error(`watch state event is invalid: ${key}`);
  }
  for (const [key, value] of Object.entries(state.pending)) {
    if (!isRecord(value)) throw new Error(`watch state pending record is invalid: ${key}`);
  }
  return { ...state, version: Number(state.version) || 2 };
}

function writeJson(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomToken()}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, filePath);

    try {
      const dirFd = fs.openSync(parent, "r");
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {
    }
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
    }
    throw error;
  }
}

function processIsAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLockOwner(lockPath) {
  try {
    const owner = readJsonFile(path.join(lockPath, "owner.json"));
    return isRecord(owner) ? owner : null;
  } catch {
    return null;
  }
}

function staleLock(lockPath) {
  let stat;
  try {
    stat = fs.statSync(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) return false;
  const owner = readLockOwner(lockPath);
  if (owner?.pid && processIsAlive(owner.pid)) return false;
  return true;
}

function acquireRunLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true, mode: 0o700 });
  const token = randomToken();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      fs.mkdirSync(LOCK_PATH, { recursive: false, mode: 0o700 });
      const owner = {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        token
      };
      fs.writeFileSync(path.join(LOCK_PATH, "owner.json"), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      return {
        release() {
          const current = readLockOwner(LOCK_PATH);
          if (current?.token !== token) return;
          fs.rmSync(LOCK_PATH, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!staleLock(LOCK_PATH)) {
        throw new Error("another telegram watcher run holds the state lock");
      }

      const quarantine = `${LOCK_PATH}.stale-${process.pid}-${token}-${attempt}`;
      try {
        fs.renameSync(LOCK_PATH, quarantine);
        fs.rmSync(quarantine, { recursive: true, force: true });
      } catch (renameError) {
        if (renameError?.code !== "ENOENT") throw renameError;
      }
    }
  }

  throw new Error("could not acquire the telegram watcher state lock");
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
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
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

function resultMeta(resultPayload) {
  return isRecord(resultPayload?.meta) ? resultPayload.meta : {};
}

function provisionalStatus(meta) {
  if (!Object.prototype.hasOwnProperty.call(meta, "provisional")) {
    return { valid: true, provisional: false, present: false };
  }
  const value = meta.provisional;
  if (typeof value === "boolean") {
    return { valid: true, provisional: value, present: true };
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      return { valid: true, provisional: normalized === "true", present: true };
    }
  }
  return {
    valid: false,
    provisional: true,
    present: true,
    error: "result meta.provisional is unsupported; expected boolean or string 'true'/'false'"
  };
}

function resultMetaSnapshot(meta, provisional = provisionalStatus(meta)) {
  const snapshot = {};
  if (Object.prototype.hasOwnProperty.call(meta, "provisional")) {
    snapshot.provisional = provisional.valid ? provisional.provisional : "[invalid]";
    if (!provisional.valid) snapshot.provisionalType = typeof meta.provisional;
  }
  if (Object.prototype.hasOwnProperty.call(meta, "completeness")) {
    const value = meta.completeness;
    snapshot.completeness = value == null
      ? null
      : (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        ? String(value).slice(0, 120)
        : "[structured]";
  }
  return snapshot;
}

function resultLooksSendable(event, resultPayload, fp) {
  if (!fp) return false;
  const meta = resultMeta(resultPayload);
  const provisional = provisionalStatus(meta);
  if (!provisional.valid || provisional.provisional) return false;
  if (statusLooksReady(event.status)) return true;

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
  const outDir = path.join(
    OUT_ROOT,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${randomToken()}`
  );
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
    throw new Error(processFailure("card capture", result));
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("card capture returned invalid JSON");
  }
  if (!payload.ok || !Array.isArray(payload.files) || payload.files.length === 0) {
    throw new Error("card capture returned no files");
  }
  const files = payload.files.filter((file) => typeof file === "string" && file.length > 0);
  if (files.length !== payload.files.length) throw new Error("card capture returned an invalid file list");
  return files;
}

function resolveHermesExecutable() {
  const configured = process.env.KAAF_HERMES_BIN || "";
  if (!configured) {
    throw new Error("KAAF_HERMES_BIN must be configured for direct send");
  }
  if (!path.isAbsolute(configured)) {
    throw new Error("KAAF_HERMES_BIN must be an absolute executable path");
  }
  try {
    fs.accessSync(configured, fs.constants.X_OK);
  } catch {
    throw new Error(`KAAF_HERMES_BIN is not executable: ${configured}`);
  }
  return configured;
}

function warningStatus(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, "warnings")) {
    return { valid: true, acknowledged: true };
  }
  if (Array.isArray(payload.warnings)) {
    return payload.warnings.length === 0
      ? { valid: true, acknowledged: true }
      : { valid: true, acknowledged: false, error: "non-empty warnings array" };
  }
  return { valid: false, acknowledged: false, error: "warnings has unsupported shape" };
}

function sendCardDirectly(tournament, event, file, includeHeader) {
  const body = includeHeader
    ? [`${tournament.name}`, `${event.label} 결과 카드`, `MEDIA:${file}`].join("\n")
    : `MEDIA:${file}`;

  const result = spawnSync(resolveHermesExecutable(), ["send", "--to", DIRECT_SEND_TARGET, "--file", "-", "--json"], {
    input: body,
    encoding: "utf8",
    env: process.env,
    timeout: 90000
  });

  if (result.status !== 0) {
    throw new Error(processFailure("Hermes direct send", result));
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("Hermes direct send returned invalid JSON");
  }
  if (!isRecord(payload) || payload.success !== true) {
    const detail = typeof payload?.error === "string" ? `: ${payload.error.slice(0, 240)}` : "";
    throw new Error(`Hermes direct send was not successful${detail}`);
  }
  const warnings = warningStatus(payload);
  if (!warnings.acknowledged) {
    throw new Error(`Hermes direct send acknowledgement is not clear: ${warnings.error}`);
  }
  const messageId = String(payload.message_id || "").trim();
  if (!messageId) throw new Error("Hermes direct send acknowledgement has no message_id");
  return { messageId };
}

function isSent(record) {
  return Boolean(record?.sentAt || record?.sentFingerprint || record?.sentMediaFingerprint);
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function pageHashMatches(page) {
  if (typeof page?.path !== "string" || !page.sha256 || !fs.existsSync(page.path)) return false;
  try {
    return sha256File(page.path) === page.sha256;
  } catch {
    return false;
  }
}

function pageAcknowledged(page) {
  return Boolean(page?.acknowledgedAt && page?.messageId);
}

function reusablePendingFiles(state, key, fp) {
  const pending = state.pending[key];
  if (!isRecord(pending) || pending.fingerprint !== fp || !Array.isArray(pending.pages)) return null;
  if (!pending.pages.every(pageHashMatches)) return null;
  return pending.pages.map((page) => page.path);
}

function persistPending(state, key, tournament, event, fp, files, now) {
  const previous = state.pending[key];
  const sameFingerprint = isRecord(previous) && previous.fingerprint === fp;
  const previousPages = sameFingerprint && Array.isArray(previous.pages) ? previous.pages : [];
  const pages = files.map((file, index) => {
    const previousPage = previousPages[index];
    return {
      ...(isRecord(previousPage) ? previousPage : {}),
      index,
      path: file,
      sha256: sha256File(file)
    };
  });
  const pending = {
    ...(sameFingerprint ? previous : {}),
    key,
    tournamentId: tournament.id,
    eventId: event.id,
    label: event.label,
    fingerprint: fp,
    files,
    pages,
    pageCount: pages.length,
    capturedAt: sameFingerprint ? (previous.capturedAt || now) : now,
    deliveryMode: DIRECT_SEND ? "direct" : "stdout"
  };
  state.pending[key] = pending;
  state.events[key] = {
    ...state.events[key],
    pendingAt: state.events[key].pendingAt || now
  };
  writeJson(STATE_PATH, state);
  return pending;
}

function mediaFingerprint(files) {
  return files.join("\n");
}

function acknowledgedPageCount(pending) {
  return pending.pages.filter(pageAcknowledged).length;
}

function messageIds(pending) {
  return pending.pages.filter(pageAcknowledged).map((page) => page.messageId);
}

function markEventSent(state, key, fp, pending) {
  const ids = messageIds(pending);
  const sentRecord = {
    ...state.events[key],
    sentAt: Date.now(),
    sentFingerprint: fp,
    sentMediaFingerprint: mediaFingerprint(pending.files),
    hermesMessageId: ids[ids.length - 1],
    hermesMessageIds: ids,
    sentPageCount: pending.pages.length
  };
  delete sentRecord.lastError;
  state.events[key] = sentRecord;
  delete state.pending[key];
  writeJson(STATE_PATH, state);
}

async function main() {
  let state = null;
  let lock = null;
  let hadFailure = false;
  let fatalError = null;
  const mediaLines = [];
  let attemptedCount = 0;

  try {
    lock = acquireRunLock();
    state = readState(STATE_PATH);

    for (const key of Object.keys(state.pending)) {
      if (isSent(state.events[key])) delete state.pending[key];
    }

    const tournamentsPayload = await fetchJson(apiUrl("/api/tournaments"));
    const tournaments = (tournamentsPayload.tournaments || []).filter(activeTournament);

    for (const tournament of tournaments) {
      if (attemptedCount >= MAX_SENDS_PER_RUN) break;

      const eventsPayload = await fetchJson(apiUrl("/api/events", { tournament_id: tournament.id }));
      const events = (eventsPayload.events || []).slice().sort((left, right) => {
        const leftPending = state.pending[eventKey(left)] ? 1 : 0;
        const rightPending = state.pending[eventKey(right)] ? 1 : 0;
        return rightPending - leftPending;
      });

      for (const event of events) {
        if (attemptedCount >= MAX_SENDS_PER_RUN) break;
        if (!statusMayHaveCompletePaceResults(event.status)) continue;

        const key = eventKey(event);
        const record = state.events[key] || {};
        let resultPayload;
        try {
          resultPayload = await fetchJson(apiUrl("/api/result", eventParams(tournament, event)));
        } catch (error) {
          state.events[key] = {
            ...record,
            lastError: `result fetch failed: ${errorMessage(error)}`,
            lastTriedAt: Date.now()
          };
          hadFailure = true;
          continue;
        }

        const rows = Array.isArray(resultPayload.rows) ? resultPayload.rows : [];
        const fp = fingerprint(rows);
        const now = Date.now();
        const meta = resultMeta(resultPayload);
        const provisional = provisionalStatus(meta);
        state.events[key] = {
          ...record,
          tournamentId: tournament.id,
          eventId: event.id,
          label: event.label,
          status: event.status,
          rowCount: rows.length,
          firstSeenAt: record.firstSeenAt || now,
          lastSeenAt: now,
          latestFingerprint: fp,
          resultMeta: resultMetaSnapshot(meta, provisional)
        };

        if (!provisional.valid) {
          state.events[key] = {
            ...state.events[key],
            lastError: provisional.error,
            lastTriedAt: now
          };
          hadFailure = true;
          continue;
        }
        if (!resultLooksSendable(event, resultPayload, fp)) continue;
        if (isSent(record)) {
          if (state.pending[key]) delete state.pending[key];
          continue;
        }

        attemptedCount += 1;
        try {
          let files = reusablePendingFiles(state, key, fp);
          if (!files) files = captureCards(tournament, event);

          persistPending(state, key, tournament, event, fp, files, now);
          const pending = state.pending[key];

          if (DIRECT_SEND) {
            for (const page of pending.pages) {
              if (pageAcknowledged(page)) continue;
              if (!pageHashMatches(page)) throw new Error("pending page hash changed before direct send; retry will recapture it");
              const attemptAt = Date.now();
              page.attempts = Number(page.attempts || 0) + 1;
              page.lastAttemptAt = attemptAt;
              state.events[key] = {
                ...state.events[key],
                lastTriedAt: attemptAt,
                attemptCount: pending.pages.reduce((total, item) => total + Number(item.attempts || 0), 0)
              };
              writeJson(STATE_PATH, state);

              try {
                const acknowledgement = sendCardDirectly(tournament, event, page.path, page.index === 0);
                page.acknowledgedAt = Date.now();
                page.messageId = acknowledgement.messageId;
                delete page.lastError;
                state.events[key] = {
                  ...state.events[key],
                  acknowledgedPageCount: acknowledgedPageCount(pending),
                  lastTriedAt: page.acknowledgedAt
                };
                writeJson(STATE_PATH, state);
              } catch (error) {
                page.lastError = errorMessage(error);
                state.events[key] = {
                  ...state.events[key],
                  lastError: page.lastError,
                  lastTriedAt: Date.now()
                };
                writeJson(STATE_PATH, state);
                throw error;
              }
            }

            if (pending.pages.every(pageAcknowledged)) {
              markEventSent(state, key, fp, pending);
            }
          } else {
            const unacknowledgedPages = pending.pages.filter((page) => !pageAcknowledged(page));
            const handoffAt = Date.now();
            for (const page of unacknowledgedPages) {
              if (!pageHashMatches(page)) throw new Error("pending page hash changed before stdout handoff; retry will recapture it");
              page.attempts = Number(page.attempts || 0) + 1;
              page.lastAttemptAt = handoffAt;
              mediaLines.push(`MEDIA:${page.path}`);
            }
            state.events[key] = {
              ...state.events[key],
              stdoutHandoffAt: handoffAt,
              stdoutHandoffFileCount: unacknowledgedPages.length,
              lastTriedAt: handoffAt,
              attemptCount: pending.pages.reduce((total, item) => total + Number(item.attempts || 0), 0),
              lastError: "stdout handoff has no downstream acknowledgement; direct mode required"
            };
            writeJson(STATE_PATH, state);
            process.stderr.write("telegram watcher: stdout handoff is pending acknowledgement; direct mode is required for sent state\n");
          }
        } catch (error) {
          state.events[key] = {
            ...state.events[key],
            lastError: errorMessage(error),
            lastTriedAt: Date.now()
          };
          hadFailure = true;
        }
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    if (state) {
      state.updatedAt = new Date().toISOString();
      try {
        writeJson(STATE_PATH, state);
      } catch (error) {
        fatalError = fatalError || error;
      }
    }
    if (lock) {
      try {
        lock.release();
      } catch (error) {
        fatalError = fatalError || error;
      }
    }
  }

  if (mediaLines.length) process.stdout.write(`${mediaLines.join("\n")}\n`);
  if (fatalError) throw fatalError;
  if (hadFailure) throw new Error("telegram watcher completed with retryable failures; state persisted");
}

function reportFailure(error) {
  process.stderr.write(`${error?.stack || errorMessage(error)}\n`);
  process.exitCode = 1;
}

if (require.main === module) main().catch(reportFailure);

module.exports = {
  LOCK_PATH,
  STATE_PATH,
  acquireRunLock,
  defaultState,
  main,
  readState,
  resultLooksSendable,
  sendCardDirectly,
  writeJson
};
