"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const WATCHER_WRAPPER = path.join(REPO_ROOT, "telegram_result_watch.js");
const NODE_BIN = process.execPath;

function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function sendJson(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function createFixture({ eventIds = ["e1"], resultMeta = {}, capturePages = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kaaf-watcher-test-"));
  const captureLog = path.join(root, "capture.log");
  const hermesAttempts = path.join(root, "hermes-attempts.txt");
  const statePath = path.join(root, "state", "watch.json");
  const defaultStatePath = path.join(root, ".hermes", "state", "kaaf-result-watch-state.json");
  const legacyStatePath = path.join(root, "legacy-watch.json");
  const outRoot = path.join(root, "cards");
  const captureScript = path.join(root, "capture.js");
  const hermesScript = path.join(root, "hermes");

  writeExecutable(captureScript, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const outDir = args[args.indexOf("--out-dir") + 1];
const logPath = process.env.FAKE_CAPTURE_LOG;
const delay = Number(process.env.FAKE_CAPTURE_DELAY_MS || 0);
const pages = Number(process.env.FAKE_CAPTURE_PAGES || 1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  if (delay > 0) await sleep(delay);
  if (logPath) fs.appendFileSync(logPath, JSON.stringify({ eventId: args[args.indexOf("--event-id") + 1] }) + "\\n");
  if (process.env.FAKE_CAPTURE_FAIL === "1") {
    process.stderr.write("synthetic capture failure\\n");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (let index = 1; index <= pages; index += 1) {
    const file = path.join(outDir, "page-" + index + ".png");
    fs.writeFileSync(file, "synthetic-page-" + index + "\\n");
    files.push(file);
  }
  process.stdout.write(JSON.stringify({ ok: true, files }));
})().catch((error) => {
  process.stderr.write(String(error) + "\\n");
  process.exit(1);
});
`);

  writeExecutable(hermesScript, `#!/usr/bin/env node
const fs = require("node:fs");
const delay = Number(process.env.FAKE_HERMES_DELAY_MS || 0);
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", async () => {
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  const attemptFile = process.env.FAKE_HERMES_ATTEMPTS;
  const prior = attemptFile && fs.existsSync(attemptFile) ? Number(fs.readFileSync(attemptFile, "utf8")) : 0;
  const attempt = prior + 1;
  if (attemptFile) fs.writeFileSync(attemptFile, String(attempt));
  if (process.env.FAKE_HERMES_LOG) {
    fs.appendFileSync(process.env.FAKE_HERMES_LOG, JSON.stringify({ attempt, mediaCount: body.split(/\\r?\\n/).filter((line) => line.startsWith("MEDIA:")).length }) + "\\n");
  }
  if (process.env.FAKE_HERMES_FAIL_FIRST === "1" && attempt === 1) {
    process.stderr.write("synthetic sender failure\\n");
    process.exit(1);
  }
  if (process.env.FAKE_HERMES_FAIL_ALWAYS === "1") {
    process.stderr.write("synthetic sender failure\\n");
    process.exit(1);
  }
  const payload = { success: true, message_id: "synthetic-" + attempt };
  if (process.env.FAKE_HERMES_WARNINGS_OBJECT === "1" && attempt === 1) payload.warnings = { page: "failed" };
  if (process.env.FAKE_HERMES_WARNINGS_EMPTY === "1") payload.warnings = [];
  if (process.env.FAKE_HERMES_PARTIAL === "1" || process.env.FAKE_HERMES_PARTIAL_AT === String(attempt)) payload.warnings = ["one media page failed"];
  process.stdout.write(JSON.stringify(payload));
});
`);

  const events = eventIds.map((id) => ({
    tournament_id: "t1",
    id,
    label: `Event ${id}`,
    status: "completed",
    params: { source: "pace", event_id: id }
  }));
  const apiState = {
    results: Object.fromEntries(eventIds.map((id) => [id, {
      rows: [{ rank: 1, name: "Runner", record: "10.00" }],
      meta: { ...resultMeta }
    }]))
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/tournaments") {
      sendJson(response, { tournaments: [{ id: "t1", name: "Synthetic Meet" }] });
      return;
    }
    if (url.pathname === "/api/events") {
      sendJson(response, { events });
      return;
    }
    if (url.pathname === "/api/result") {
      const eventId = url.searchParams.get("event_id") || eventIds[0];
      sendJson(response, apiState.results[eventId] || apiState.results[eventIds[0]]);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const apiUrl = `http://127.0.0.1:${address.port}`;

  const fixture = {
    root,
    apiUrl,
    statePath,
    defaultStatePath,
    legacyStatePath,
    lockPath: `${statePath}.lock`,
    outRoot,
    captureLog,
    hermesAttempts,
    hermesLog: path.join(root, "hermes.log"),
    captureScript,
    hermesScript,
    eventIds,
    setResult(eventId, payload) {
      apiState.results[eventId] = payload;
    },
    env(overrides = {}) {
      const environment = {
        ...process.env,
        KAAF_RESULT_CARD_URL: apiUrl,
        KAAF_WATCH_STATE_PATH: statePath,
        KAAF_WATCH_LOCK_STALE_MS: "100",
        KAAF_CAPTURE_SCRIPT: captureScript,
        KAAF_RESULT_CARD_OUT_DIR: outRoot,
        KAAF_WATCH_MAX_SENDS: "1",
        KAAF_WATCH_FETCH_TIMEOUT_MS: "5000",
        KAAF_WATCH_DIRECT_SEND: "1",
        KAAF_HERMES_BIN: hermesScript,
        FAKE_CAPTURE_LOG: captureLog,
        FAKE_CAPTURE_PAGES: String(capturePages),
        FAKE_HERMES_ATTEMPTS: hermesAttempts,
        FAKE_HERMES_LOG: path.join(root, "hermes.log"),
        ...overrides
      };
      if (overrides.UNSET_STATE_PATH === "1") {
        delete environment.KAAF_WATCH_STATE_PATH;
        environment.HOME = root;
        environment.KAAF_WATCH_LEGACY_STATE_PATH = legacyStatePath;
        delete environment.UNSET_STATE_PATH;
      }
      return environment;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  return fixture;
}

function startWatcher(fixture, overrides = {}) {
  const child = spawn(NODE_BIN, [WATCHER_WRAPPER], {
    cwd: REPO_ROOT,
    env: fixture.env(overrides),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("watcher test process timed out"));
    }, 8000);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, result };
}

async function runWatcher(fixture, overrides = {}) {
  return (await startWatcher(fixture, overrides).result);
}

function readState(fixture) {
  return JSON.parse(fs.readFileSync(fixture.statePath, "utf8"));
}

function lineCount(filePath) {
  return fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean).length
    : 0;
}

async function waitForPath(filePath) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function testSenderFailureThenSuccessAndNoDuplicate() {
  const fixture = await createFixture();
  try {
    let result = await runWatcher(fixture, { FAKE_HERMES_FAIL_FIRST: "1" });
    assert.equal(result.code, 1);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.equal(state.pending["t1:e1"].pages[0].attempts, 1);
    assert.equal(lineCount(fixture.captureLog), 1);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 1);

    result = await runWatcher(fixture, { FAKE_HERMES_FAIL_FIRST: "1" });
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
    assert.equal(state.events["t1:e1"].hermesMessageId, "synthetic-2");
    assert.equal(state.pending["t1:e1"], undefined);
    assert.equal(lineCount(fixture.captureLog), 1);

    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 2);
  } finally {
    await fixture.close();
  }
}

async function testOneEventLimitAfterFailure() {
  const fixture = await createFixture({ eventIds: ["e1", "e2"] });
  try {
    const result = await runWatcher(fixture, { FAKE_HERMES_FAIL_ALWAYS: "1" });
    assert.equal(result.code, 1);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 1);
    const state = readState(fixture);
    assert.ok(state.events["t1:e1"]);
    assert.equal(state.events["t1:e2"], undefined);
  } finally {
    await fixture.close();
  }
}

async function testMultiPagePartialAcknowledgementChangedPage() {
  const fixture = await createFixture({ capturePages: 2 });
  try {
    let result = await runWatcher(fixture, { FAKE_HERMES_PARTIAL_AT: "2" });
    assert.equal(result.code, 1);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.equal(state.pending["t1:e1"].files.length, 2);
    assert.equal(state.pending["t1:e1"].pages[0].messageId, "synthetic-1");
    assert.equal(state.pending["t1:e1"].pages[1].messageId, undefined);
    assert.equal(lineCount(fixture.captureLog), 1);
    fs.writeFileSync(state.pending["t1:e1"].pages[1].path, "changed-page-by-qa\n");

    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
    assert.equal(state.pending["t1:e1"], undefined);
    assert.equal(lineCount(fixture.captureLog), 2);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 3);
    assert.deepEqual(state.events["t1:e1"].hermesMessageIds, ["synthetic-1", "synthetic-3"]);
    assert.deepEqual(
      fs.readFileSync(fixture.hermesLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line).mediaCount),
      [1, 1, 1]
    );
  } finally {
    await fixture.close();
  }
}

async function testMultiPagePartialAcknowledgementMissingPage() {
  const fixture = await createFixture({ capturePages: 2 });
  try {
    let result = await runWatcher(fixture, { FAKE_HERMES_PARTIAL_AT: "2" });
    assert.equal(result.code, 1);
    const firstState = readState(fixture);
    fs.unlinkSync(firstState.pending["t1:e1"].pages[1].path);

    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    const state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
    assert.deepEqual(state.events["t1:e1"].hermesMessageIds, ["synthetic-1", "synthetic-3"]);
    assert.equal(lineCount(fixture.captureLog), 2);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 3);
  } finally {
    await fixture.close();
  }
}

async function testOverlappingInvocation() {
  const fixture = await createFixture();
  try {
    const first = startWatcher(fixture, { FAKE_CAPTURE_DELAY_MS: "500" });
    await waitForPath(fixture.lockPath);
    const second = await runWatcher(fixture);
    const firstResult = await first.result;
    assert.equal(firstResult.code, 0);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /state lock/);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 1);
    assert.ok(readState(fixture).events["t1:e1"].sentAt);
  } finally {
    await fixture.close();
  }
}

async function testStaleLockAndMissingState() {
  const fixture = await createFixture();
  try {
    fs.mkdirSync(fixture.lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(fixture.lockPath, "owner.json"),
      JSON.stringify({ pid: 99999999, hostname: "dead-test-owner", startedAt: "2000-01-01T00:00:00.000Z", token: "old" })
    );
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(fixture.lockPath, old, old);
    const result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    assert.equal(fs.existsSync(fixture.lockPath), false);
    assert.ok(readState(fixture).events["t1:e1"].sentAt);
  } finally {
    await fixture.close();
  }
}

async function testCaptureFailureIsNonzeroAndRetryable() {
  const fixture = await createFixture();
  try {
    let result = await runWatcher(fixture, { FAKE_CAPTURE_FAIL: "1" });
    assert.equal(result.code, 1);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.match(state.events["t1:e1"].lastError, /capture/);
    assert.equal(fs.existsSync(fixture.hermesAttempts), false);

    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
  } finally {
    await fixture.close();
  }
}

async function testProvisionalResultIsSkipped() {
  const fixture = await createFixture({ resultMeta: { provisional: true, completeness: "incomplete" } });
  try {
    let result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.deepEqual(state.events["t1:e1"].resultMeta, { provisional: true, completeness: "incomplete" });
    assert.equal(fs.existsSync(fixture.captureLog), false);
    assert.equal(fs.existsSync(fixture.hermesAttempts), false);

    fixture.setResult("e1", {
      rows: [{ rank: 1, name: "Runner", record: "10.00" }],
      meta: { provisional: false, completeness: "complete" }
    });
    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
    assert.equal(lineCount(fixture.captureLog), 1);
  } finally {
    await fixture.close();
  }
}

async function testInvalidProvisionalTypeFailsClosed() {
  const fixture = await createFixture({ resultMeta: { provisional: 1, completeness: "incomplete" } });
  try {
    let result = await runWatcher(fixture);
    assert.equal(result.code, 1);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.equal(state.events["t1:e1"].resultMeta.provisional, "[invalid]");
    assert.equal(state.events["t1:e1"].resultMeta.provisionalType, "number");
    assert.match(state.events["t1:e1"].lastError, /expected boolean/);
    assert.equal(fs.existsSync(fixture.captureLog), false);
    assert.equal(fs.existsSync(fixture.hermesAttempts), false);

    fixture.setResult("e1", {
      rows: [{ rank: 1, name: "Runner", record: "10.00" }],
      meta: { provisional: false, completeness: "complete" }
    });
    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
  } finally {
    await fixture.close();
  }
}

async function testProvisionalStringCompatibility() {
  const fixture = await createFixture({ resultMeta: { provisional: "true", completeness: "incomplete" } });
  try {
    let result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    assert.equal(fs.existsSync(fixture.captureLog), false);

    fixture.setResult("e1", {
      rows: [{ rank: 1, name: "Runner", record: "10.00" }],
      meta: { provisional: "false", completeness: "complete" }
    });
    result = await runWatcher(fixture);
    assert.equal(result.code, 0);
    assert.ok(readState(fixture).events["t1:e1"].sentAt);
  } finally {
    await fixture.close();
  }
}

async function testWarningShapeFailsClosedAndEmptyIsValid() {
  const fixture = await createFixture();
  try {
    let result = await runWatcher(fixture, { FAKE_HERMES_WARNINGS_OBJECT: "1" });
    assert.equal(result.code, 1);
    let state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.equal(state.pending["t1:e1"].pages[0].messageId, undefined);
    assert.match(state.events["t1:e1"].lastError, /unsupported shape/);

    result = await runWatcher(fixture, { FAKE_HERMES_WARNINGS_EMPTY: "1" });
    assert.equal(result.code, 0);
    state = readState(fixture);
    assert.ok(state.events["t1:e1"].sentAt);
    assert.equal(Number(fs.readFileSync(fixture.hermesAttempts, "utf8")), 2);
  } finally {
    await fixture.close();
  }
}

async function testStdoutHandoffDoesNotClaimSent() {
  const fixture = await createFixture();
  try {
    const result = await runWatcher(fixture, { KAAF_WATCH_DIRECT_SEND: "0" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^MEDIA:/m);
    const state = readState(fixture);
    assert.equal(state.events["t1:e1"].sentAt, undefined);
    assert.ok(state.pending["t1:e1"]);
    assert.match(state.events["t1:e1"].lastError, /direct mode required/);
  } finally {
    await fixture.close();
  }
}

async function testMalformedStateIsNotReset() {
  const fixture = await createFixture();
  try {
    fs.mkdirSync(path.dirname(fixture.statePath), { recursive: true });
    fs.writeFileSync(fixture.statePath, "not-json\n");
    const result = await runWatcher(fixture);
    assert.equal(result.code, 1);
    assert.equal(fs.readFileSync(fixture.statePath, "utf8"), "not-json\n");
  } finally {
    await fixture.close();
  }
}

async function testMissingExternalStateRefusesLegacyReplay() {
  const fixture = await createFixture();
  try {
    fs.writeFileSync(fixture.legacyStatePath, JSON.stringify({ events: { "t1:e1": { sentAt: 1 } } }) + "\n");
    const result = await runWatcher(fixture, { UNSET_STATE_PATH: "1" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /migrate state/);
    assert.equal(fs.existsSync(fixture.defaultStatePath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.legacyStatePath, "utf8")).events["t1:e1"], { sentAt: 1 });
  } finally {
    await fixture.close();
  }
}

const tests = [
  ["sender failure then success with no duplicate", testSenderFailureThenSuccessAndNoDuplicate],
  ["one-event limit survives failure", testOneEventLimitAfterFailure],
  ["multi-page partial acknowledgement with changed page", testMultiPagePartialAcknowledgementChangedPage],
  ["multi-page partial acknowledgement with missing page", testMultiPagePartialAcknowledgementMissingPage],
  ["overlapping invocation", testOverlappingInvocation],
  ["stale lock and missing state", testStaleLockAndMissingState],
  ["capture failure is nonzero and retryable", testCaptureFailureIsNonzeroAndRetryable],
  ["provisional result is skipped", testProvisionalResultIsSkipped],
  ["invalid provisional type fails closed", testInvalidProvisionalTypeFailsClosed],
  ["provisional string compatibility", testProvisionalStringCompatibility],
  ["warning shape fails closed and empty is valid", testWarningShapeFailsClosedAndEmptyIsValid],
  ["stdout handoff does not claim sent", testStdoutHandoffDoesNotClaimSent],
  ["malformed state is not reset", testMalformedStateIsNotReset],
  ["missing external state refuses legacy replay", testMissingExternalStateRefusesLegacyReplay]
];

(async () => {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`watcher-telegram: ${tests.length} passed\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
