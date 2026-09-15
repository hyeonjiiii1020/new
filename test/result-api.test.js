const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const APP_SERVER = path.join(ROOT, "server.js");

const DECATHLON_DEFINITIONS = [
  { key: "M_100m", name: "100m", category: "track", value: 11 },
  { key: "M_long_jump", name: "멀리뛰기", category: "field_distance", value: 7 },
  { key: "M_shot_put", name: "포환던지기", category: "field_distance", value: 14 },
  { key: "M_high_jump", name: "높이뛰기", category: "field_height", value: 1.8 },
  { key: "M_400m", name: "400m", category: "track", value: 55 },
  { key: "M_110m_hurdles", name: "110mH", category: "track", value: 17 },
  { key: "M_discus", name: "원반던지기", category: "field_distance", value: 45 },
  { key: "M_pole_vault", name: "장대높이뛰기", category: "field_height", value: 3.6 },
  { key: "M_javelin", name: "창던지기", category: "field_distance", value: 50 },
  { key: "M_1500m", name: "1500m", category: "track", value: 300 }
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function makeFixtureStore() {
  return {
    live: new Map(),
    eventLists: new Map(),
    entries: new Map(),
    subEvents: new Map(),
    subLive: new Map(),
    requests: []
  };
}

function makeParentEntries(extra = []) {
  return [
    { event_entry_id: 101, name: "김하늘", team: "서울시청", bib_number: "101" },
    { event_entry_id: 102, name: "이바다", team: "부산시청", bib_number: "102" },
    ...extra
  ];
}

function makePaceEvent(id, competitionId, name, category, gender = "M", roundType = "final") {
  return {
    id,
    competition_id: competitionId,
    name,
    category,
    gender,
    round_type: roundType
  };
}

function makeHeat(entries, results, extra = {}) {
  return { heat_number: 1, entries, results, ...extra };
}

function makeRelayFixture(id, name, team, competitionId = "55") {
  const entry = { event_entry_id: id + "-entry", name, team };
  return {
    event: makePaceEvent(id, competitionId, "4x100mR", "relay", "F"),
    heats: [makeHeat([entry], [{ event_entry_id: entry.event_entry_id, time_seconds: 50.03 }], { wind: "0.0 m/s" })]
  };
}

function makeDerivedSubEvent(definition, subId, parentEntries, missingName = "") {
  const entries = parentEntries.map((entry, index) => ({
    event_entry_id: subId + "-entry-" + index,
    name: entry.name,
    team: entry.team,
    bib_number: entry.bib_number
  }));
  const included = entries.filter((entry) => entry.name !== missingName);
  const event = makePaceEvent(subId, "56", definition.name, definition.category);
  const heat = { heat_number: 1, entries };

  if (definition.category === "field_height") {
    heat.height_attempts = included.map((entry) => ({
      event_entry_id: entry.event_entry_id,
      attempt_number: 1,
      result_mark: "O",
      bar_height: definition.value
    }));
  } else if (definition.category === "field_distance") {
    heat.results = included.map((entry) => ({
      event_entry_id: entry.event_entry_id,
      attempt_number: 1,
      distance_meters: definition.value
    }));
  } else {
    heat.results = included.map((entry) => ({
      event_entry_id: entry.event_entry_id,
      time_seconds: definition.value
    }));
  }

  return { event, heats: [heat] };
}

function addDerivedFixture(store, id, options = {}) {
  const parentEntries = makeParentEntries(options.extraEntries || []);
  const parentEvent = {
    ...makePaceEvent(id, "56", "10종경기", "combined"),
    ...(options.eventOverrides || {})
  };
  store.live.set(id, {
    event: parentEvent,
    heats: [makeHeat(parentEntries, options.parentResults || [])]
  });
  store.entries.set(id, parentEntries);

  const missingDefinitionKey = options.missingDefinitionKey || "";
  const subEvents = [];
  for (const definition of DECATHLON_DEFINITIONS) {
    if (definition.key === missingDefinitionKey) continue;
    const subId = id + "-" + definition.key;
    subEvents.push({ id: subId, name: definition.name });
    store.subLive.set(
      subId,
      makeDerivedSubEvent(definition, subId, parentEntries, options.missingAthleteName || "")
    );
  }
  store.subEvents.set(id, subEvents);
}

function addFixtures(store) {
  store.live.set("mismatch", {
    event: makePaceEvent("mismatch", "58", "100m", "track", "F"),
    heats: []
  });

  store.live.set("body-id-mismatch", {
    event: makePaceEvent("different-upstream-id", "51", "100m", "track", "F"),
    heats: [
      makeHeat(
        [{ event_entry_id: "body-id-entry", name: "응답선수", team: "응답팀" }],
        [{ event_entry_id: "body-id-entry", time_seconds: 11.1 }]
      )
    ]
  });

  store.live.set("final-tie", {
    event: makePaceEvent("final-tie", "51", "100m", "track", "F"),
    heats: [
      makeHeat(
        [
          { event_entry_id: "tie-1", name: "김첫째", team: "정선군청" },
          { event_entry_id: "tie-2", name: "김둘째", team: "가평군청" }
        ],
        [
          { event_entry_id: "tie-1", time_seconds: 10.1 },
          { event_entry_id: "tie-2", time_seconds: 10.1 }
        ],
        { wind: 0 }
      ),
      makeHeat(
        [{ event_entry_id: "tie-3", name: "김셋째", team: "안동시청" }],
        [{ event_entry_id: "tie-3", time_seconds: 10.2 }]
      )
    ]
  });

  store.live.set("relay-no-roster", makeRelayFixture("relay-no-roster", "인하대학교", "인하대학교"));
  store.live.set(
    "relay-real-roster",
    makeRelayFixture("relay-real-roster", "박민수 심재원 정지훈 조경환", "서울특별시청")
  );

  store.live.set("combined-authoritative", {
    event: {
      ...makePaceEvent("combined-authoritative", "56", "10종경기", "combined"),
      round_status: "completed"
    },
    heats: [
      makeHeat(
        [
          { event_entry_id: "auth-1", name: "김하늘", team: "서울시청" },
          { event_entry_id: "auth-2", name: "이바다", team: "부산시청" }
        ],
        [
          { event_entry_id: "auth-1", total_points: 5263 },
          { event_entry_id: "auth-2", total_points: 4502 }
        ]
      )
    ]
  });

  store.live.set("combined-octathlon-authoritative", {
    event: {
      ...makePaceEvent("combined-octathlon-authoritative", "56", "8종경기", "combined"),
      round_status: "completed"
    },
    heats: [
      makeHeat(
        [
          { event_entry_id: "oct-auth-1", name: "팔종첫째", team: "서울시청" },
          { event_entry_id: "oct-auth-2", name: "팔종둘째", team: "부산시청" }
        ],
        [
          { event_entry_id: "oct-auth-1", total_points: 8123 },
          { event_entry_id: "oct-auth-2", total_score: 7999 }
        ]
      )
    ]
  });

  store.live.set("combined-authoritative-partial", {
    event: {
      ...makePaceEvent("combined-authoritative-partial", "56", "10종경기", "combined"),
      round_status: "completed"
    },
    heats: [
      makeHeat(
        [
          { event_entry_id: "partial-auth-1", name: "부분권위첫째", team: "서울시청" },
          { event_entry_id: "partial-auth-2", name: "부분권위둘째", team: "부산시청" }
        ],
        [
          { event_entry_id: "partial-auth-1", total_points: 5263 },
          { event_entry_id: "partial-auth-2", score: 9999 }
        ]
      )
    ]
  });

  const missingCompetitionEvent = makePaceEvent("missing-comp", "51", "100m", "track", "F");
  delete missingCompetitionEvent.competition_id;
  store.live.set("missing-comp", {
    event: missingCompetitionEvent,
    heats: [
      makeHeat(
        [{ event_entry_id: "missing-comp-entry", name: "검증선수", team: "정선군청" }],
        [{ event_entry_id: "missing-comp-entry", time_seconds: 11.2 }]
      )
    ]
  });
  store.eventLists.set("51", [
    makePaceEvent("missing-comp", "51", "100m", "track", "F")
  ]);

  addDerivedFixture(store, "combined-missing-event", {
    missingDefinitionKey: "M_1500m"
  });
  addDerivedFixture(store, "combined-missing-athlete", {
    missingAthleteName: "누락선수",
    extraEntries: [{ event_entry_id: 103, name: "누락선수", team: "대구시청", bib_number: "103" }]
  });
  addDerivedFixture(store, "combined-complete");
  addDerivedFixture(store, "combined-ongoing-score", {
    eventOverrides: { round_status: "in_progress" },
    missingDefinitionKey: "M_1500m",
    parentResults: [
      { event_entry_id: 101, score: 9999 },
      { event_entry_id: 102, score: 8888 }
    ]
  });
  store.live.set("combined-unsupported", {
    event: {
      ...makePaceEvent("combined-unsupported", "56", "8종경기", "combined"),
      round_status: "completed"
    },
    heats: [
      makeHeat(
        [{ event_entry_id: "unsupported-1", name: "김하늘", team: "서울시청" }],
        []
      )
    ]
  });
}

function startUpstream(store) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    store.requests.push(url.pathname + url.search);

    if (url.pathname === "/api/combined-sub-events") {
      const parentId = url.searchParams.get("parent_event_id");
      const payload = store.subEvents.get(parentId);
      if (!payload) return jsonResponse(res, 404, { error: "fixture not found" });
      return jsonResponse(res, 200, payload);
    }

    if (url.pathname === "/api/events") {
      const payload = store.eventLists.get(url.searchParams.get("competition_id"));
      if (!payload) return jsonResponse(res, 404, { error: "fixture not found" });
      return jsonResponse(res, 200, payload);
    }

    const liveMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/live-results$/);
    if (liveMatch) {
      const id = decodeURIComponent(liveMatch[1]);
      const payload = store.live.get(id) || store.subLive.get(id);
      if (!payload) return jsonResponse(res, 404, { error: "fixture not found" });
      return jsonResponse(res, 200, payload);
    }

    const entriesMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/entries$/);
    if (entriesMatch) {
      const id = decodeURIComponent(entriesMatch[1]);
      const payload = store.entries.get(id);
      if (!payload) return jsonResponse(res, 404, { error: "fixture not found" });
      return jsonResponse(res, 200, payload);
    }

    if (url.pathname === "/tourInfo/resultInfo.do") {
      return textResponse(res, 200, "<html><body></body></html>");
    }

    if (url.pathname === "/tourInfo/info_command.do") {
      return textResponse(res, 200, "<html><body></body></html>");
    }

    return jsonResponse(res, 404, { error: "fixture not found" });
  });
  return listen(server).then((port) => ({ server, port }));
}

async function waitForApp(baseUrl, child) {
  let lastError = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error("application exited before readiness: " + lastError);
    }
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
      lastError = "health " + response.status;
    } catch (error) {
      lastError = error.message;
    }
    await wait(50);
  }
  throw new Error("application did not become ready: " + lastError);
}

async function startApp(upstreamPort) {
  const appPort = await new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
  const baseUrl = "http://127.0.0.1:" + appPort;
  let stderr = "";
  const child = spawn(process.execPath, [APP_SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(appPort),
      PACE_ORIGIN: "http://127.0.0.1:" + upstreamPort,
      RESULT_ORIGIN: "http://127.0.0.1:" + upstreamPort,
      RENDER_GIT_COMMIT: "test-commit"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForApp(baseUrl, child);
    return { child, baseUrl, stderr: () => stderr };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function stopApp(child) {
  if (!child || child.exitCode != null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(baseUrl + pathname);
  return { status: response.status, body: await response.json() };
}

function resultPath(tournamentId, eventId) {
  const params = new URLSearchParams({
    tournament_id: tournamentId,
    source: "pace"
  });
  if (eventId) params.set("event_id", eventId);
  return "/api/result?" + params.toString();
}

async function main() {
  const store = makeFixtureStore();
  addFixtures(store);
  const upstream = await startUpstream(store);
  let app;
  try {
    app = await startApp(upstream.port);

    const health = await requestJson(app.baseUrl, "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true, buildCommit: "test-commit" });

    const missingTournament = await requestJson(
      app.baseUrl,
      resultPath("", "final-tie")
    );
    assert.equal(missingTournament.status, 400);
    assert.equal(missingTournament.body.detail, "tournament_id is missing");

    const unknownTournament = await requestJson(
      app.baseUrl,
      resultPath("not-a-real-tournament", "final-tie")
    );
    assert.ok(unknownTournament.status >= 400 && unknownTournament.status < 500);
    assert.equal(unknownTournament.body.detail, "tournament not found");

    const missingId = await requestJson(
      app.baseUrl,
      resultPath("jeongseon-distance-masters-2026", "")
    );
    assert.equal(missingId.status, 400);
    assert.equal(missingId.body.detail, "PACE event_id is missing");

    const mismatch = await requestJson(
      app.baseUrl,
      resultPath("jeongseon-distance-masters-2026", "mismatch")
    );
    assert.equal(mismatch.status, 409);
    assert.match(mismatch.body.detail, /does not belong/);

    const bodyIdMismatch = await requestJson(
      app.baseUrl,
      resultPath("jeongseon-distance-masters-2026", "body-id-mismatch")
    );
    assert.equal(bodyIdMismatch.status, 409);
    assert.match(bodyIdMismatch.body.detail, /event ID does not match/);

    const missingCompetition = await requestJson(
      app.baseUrl,
      resultPath("jeongseon-distance-masters-2026", "missing-comp")
    );
    assert.equal(missingCompetition.status, 200);
    assert.equal(missingCompetition.body.rows[0].name, "검증선수");
    assert.ok(
      store.requests.some((request) => request === "/api/events?competition_id=51")
    );

    const noRoster = await requestJson(
      app.baseUrl,
      resultPath("kuaf-university-2026", "relay-no-roster")
    );
    assert.equal(noRoster.status, 200);
    assert.equal(noRoster.body.rows[0].name, "");
    assert.equal(noRoster.body.rows[0].rosterAvailable, false);

    const realRoster = await requestJson(
      app.baseUrl,
      resultPath("kuaf-university-2026", "relay-real-roster")
    );
    assert.equal(realRoster.status, 200);
    assert.equal(realRoster.body.rows[0].name, "박민수 심재원 정지훈 조경환");
    assert.equal(realRoster.body.rows[0].rosterAvailable, true);

    const authoritativeRequestStart = store.requests.length;
    const authoritative = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-authoritative")
    );
    assert.equal(authoritative.status, 200);
    assert.deepEqual(
      authoritative.body.rows.map((row) => row.record),
      ["5263", "4502"]
    );
    assert.equal(authoritative.body.meta.provisional, false);
    assert.equal(authoritative.body.meta.completeness.source, "authoritative");
    assert.equal(
      store.requests.slice(authoritativeRequestStart).some((request) =>
        request.startsWith("/api/combined-sub-events")
      ),
      false
    );

    const octathlonAuthoritativeRequestStart = store.requests.length;
    const octathlonAuthoritative = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-octathlon-authoritative")
    );
    assert.equal(octathlonAuthoritative.status, 200);
    assert.deepEqual(
      octathlonAuthoritative.body.rows.map((row) => row.record),
      ["8123", "7999"]
    );
    assert.equal(octathlonAuthoritative.body.meta.provisional, false);
    assert.equal(octathlonAuthoritative.body.meta.completeness.source, "authoritative");
    assert.equal(
      store.requests.slice(octathlonAuthoritativeRequestStart).some((request) =>
        request.startsWith("/api/combined-sub-events")
      ),
      false
    );

    const partialAuthoritativeRequestStart = store.requests.length;
    const partialAuthoritative = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-authoritative-partial")
    );
    assert.equal(partialAuthoritative.status, 200);
    assert.deepEqual(
      partialAuthoritative.body.rows.map((row) => row.record),
      ["5263"]
    );
    assert.equal(partialAuthoritative.body.meta.provisional, true);
    assert.equal(partialAuthoritative.body.meta.completeness.source, "authoritative");
    assert.equal(partialAuthoritative.body.meta.completeness.expected, 2);
    assert.equal(partialAuthoritative.body.meta.completeness.loaded, 1);
    assert.equal(
      partialAuthoritative.body.meta.completeness.missingEvents[0].missingAthletes[0].name,
      "부분권위둘째"
    );
    assert.equal(
      store.requests.slice(partialAuthoritativeRequestStart).some((request) =>
        request.startsWith("/api/combined-sub-events")
      ),
      false
    );

    const ongoingScore = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-ongoing-score")
    );
    assert.equal(ongoingScore.status, 200);
    assert.equal(ongoingScore.body.meta.completeness.source, "derived");
    assert.equal(ongoingScore.body.meta.provisional, true);
    assert.ok(ongoingScore.body.rows.every((row) => !["9999", "8888"].includes(row.record)));

    const unsupportedRequestStart = store.requests.length;
    const unsupportedProgram = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-unsupported")
    );
    assert.equal(unsupportedProgram.status, 200);
    assert.equal(unsupportedProgram.body.meta.provisional, true);
    assert.equal(unsupportedProgram.body.meta.supportedProgram, false);
    assert.equal(
      unsupportedProgram.body.meta.completeness.missingEvents[0].reason,
      "unsupported_program"
    );
    assert.deepEqual(unsupportedProgram.body.rows, []);
    assert.equal(
      store.requests.slice(unsupportedRequestStart).some((request) =>
        request.startsWith("/api/combined-sub-events")
      ),
      false
    );

    const missingEvent = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-missing-event")
    );
    assert.equal(missingEvent.status, 200);
    assert.equal(missingEvent.body.meta.provisional, true);
    assert.equal(missingEvent.body.meta.completeness.source, "derived");
    assert.equal(missingEvent.body.meta.completeness.expected, 10);
    assert.equal(missingEvent.body.meta.completeness.loaded, 9);
    assert.ok(
      missingEvent.body.meta.completeness.missingEvents.some(
        (item) => item.reason === "missing_event" && item.key === "M_1500m"
      )
    );

    const missingAthlete = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-missing-athlete")
    );
    assert.equal(missingAthlete.status, 200);
    assert.equal(missingAthlete.body.meta.provisional, true);
    assert.equal(missingAthlete.body.meta.completeness.expected, 10);
    assert.equal(missingAthlete.body.meta.completeness.loaded, 10);
    assert.ok(
      missingAthlete.body.meta.completeness.missingEvents.some(
        (item) =>
          item.reason === "missing_athlete_results" &&
          item.missingAthletes.some((athlete) => athlete.name === "누락선수")
      )
    );
    assert.equal(
      missingAthlete.body.rows.some((row) => row.name === "누락선수"),
      false
    );

    const complete = await requestJson(
      app.baseUrl,
      resultPath("ktfl-president-cup-2026", "combined-complete")
    );
    assert.equal(complete.status, 200);
    assert.equal(complete.body.meta.provisional, false);
    assert.deepEqual(complete.body.meta.completeness, {
      expected: 10,
      loaded: 10,
      missingEvents: [],
      source: "derived"
    });
    assert.equal(complete.body.rows.length, 2);
    assert.ok(complete.body.rows.every((row) => row.resultKind === "points"));

    const finalTie = await requestJson(
      app.baseUrl,
      resultPath("jeongseon-distance-masters-2026", "final-tie")
    );
    assert.equal(finalTie.status, 200);
    assert.deepEqual(
      finalTie.body.rows.map((row) => row.rank),
      ["1", "1", "3"]
    );
    assert.equal(finalTie.body.rows[0].wind, 0);
    assert.equal(finalTie.body.meta.provisional, false);

    const legacyToCdOnly = await requestJson(
      app.baseUrl,
      "/api/result?to_cd=E016370011&reg_year=2026&kind_cd=25&detail_class_cd=11&round=4&gday=all&resultType=TRM"
    );
    assert.equal(legacyToCdOnly.status, 200);
    assert.equal(legacyToCdOnly.body.tournament.id, "miryang-2026");

    assert.equal(
      fs.readFileSync(path.join(ROOT, "server.js"), "utf8"),
      fs.readFileSync(path.join(ROOT, "server 3.js"), "utf8")
    );

    console.log(JSON.stringify({
      ok: true,
      httpProof: {
        unknownTournament: {
          status: unknownTournament.status,
          detail: unknownTournament.body.detail
        },
        bodyIdMismatch: {
          status: bodyIdMismatch.status,
          detail: bodyIdMismatch.body.detail
        },
        octathlonAuthoritative: {
          status: octathlonAuthoritative.status,
          provisional: octathlonAuthoritative.body.meta.provisional,
          source: octathlonAuthoritative.body.meta.completeness.source
        }
      },
      checks: [
        "health-build-identity",
        "missing-tournament-id-400",
        "unknown-tournament-4xx",
        "missing-event-id-400",
        "cross-tournament-409",
        "upstream-event-id-mismatch-409",
        "missing-competition-list-fallback",
        "relay-no-roster",
        "relay-real-roster",
        "authoritative-combined",
        "octathlon-authoritative-combined",
        "partial-authoritative-combined",
        "ongoing-generic-score-not-authoritative",
        "unsupported-combined-program",
        "derived-missing-event",
        "derived-missing-athlete",
        "derived-complete",
        "final-ranking-ties",
        "numeric-zero-wind",
        "legacy-to-cd-only",
        "server-pair-identical"
      ]
    }));
  } catch (error) {
    if (app?.stderr) {
      error.message += "\napp stderr: " + app.stderr();
    }
    throw error;
  } finally {
    await stopApp(app?.child);
    await closeServer(upstream.server);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
