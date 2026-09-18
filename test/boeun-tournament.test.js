const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const APP_SERVER = path.join(ROOT, "server.js");
const TARGETS = [
  {
    id: "boeun-grade-2026",
    name: "2026 제7회 전국초.중.고 학년별 육상경기대회",
    to_cd: "E01595008E"
  },
  {
    id: "boeun-grade-combined-2026",
    name: "2026 제7회 전국초.중.고 학년별 육상경기대회(통합경기)",
    to_cd: "E015960081"
  }
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function emptyResultPage() {
  return `<!doctype html>
<div id="html_kor">
  <input class="input_base" value="" />
  <input class="input_base" value="" />
  <input class="input_base" value="" />
  <input class="input_base" value="" />
  <table class="team_table">
    <thead><tr><th>순위</th><th>성명</th><th>소속</th><th>기록</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<div id="html_eng"></div>`;
}

async function startFixture() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      method: req.method,
      url: req.url,
      body: Buffer.concat(chunks).toString("utf8")
    });

    if (req.url.startsWith("/tourInfo/resultInfo.do") || req.url.startsWith("/tourInfo/info_command.do")) {
      const body = emptyResultPage();
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("fixture not found");
  });
  const port = await listen(server);
  return { server, port, requests };
}

async function getFreePort() {
  const server = http.createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
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

async function startApp(resultOrigin) {
  const port = await getFreePort();
  const baseUrl = "http://127.0.0.1:" + port;
  let stderr = "";
  const child = spawn(process.execPath, [APP_SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      RESULT_ORIGIN: resultOrigin
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

async function main() {
  const fixture = await startFixture();
  let app;
  try {
    app = await startApp("http://127.0.0.1:" + fixture.port);

    const tournamentsResponse = await requestJson(app.baseUrl, "/api/tournaments");
    assert.equal(tournamentsResponse.status, 200);
    for (const target of TARGETS) {
      const tournament = tournamentsResponse.body.tournaments.find((item) => item.id === target.id);
      assert.ok(tournament, target.id + " is registered");
      assert.equal(tournament.name, target.name);
      assert.equal(tournament.to_cd, target.to_cd);
      assert.equal(tournament.reg_year, "2026");
      assert.equal(tournament.gubun, "E");
      assert.equal(tournament.domestic, "0");
      assert.equal(tournament.resultType, "TRM");
      assert.equal(tournament.tabs_id, "toKor");
      assert.equal(tournament.period, "2026-09-18 ~ 2026-09-22");
      assert.equal(tournament.place, "보은");

      const events = await requestJson(
        app.baseUrl,
        "/api/events?tournament_id=" + encodeURIComponent(target.id)
      );
      assert.equal(events.status, 200);
      assert.equal(events.body.tournament.id, target.id);
      assert.deepEqual(events.body.events, []);

      const result = await requestJson(
        app.baseUrl,
        "/api/result?tournament_id=" + encodeURIComponent(target.id)
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.tournament.id, target.id);
      assert.deepEqual(result.body.rows, []);
    }

    const resultInfoRequests = fixture.requests.filter((request) => request.url.startsWith("/tourInfo/resultInfo.do"));
    assert.equal(resultInfoRequests.length, TARGETS.length * 2);
    for (const target of TARGETS) {
      const request = resultInfoRequests.find((item) => new URL(item.url, "http://fixture").searchParams.get("to_cd") === target.to_cd);
      assert.ok(request, target.to_cd + " resultInfo request");
      const params = new URL(request.url, "http://fixture").searchParams;
      assert.equal(params.get("reg_year"), "2026");
      assert.equal(params.get("gubun"), "E");
      assert.equal(params.get("domestic"), "0");
      assert.equal(params.get("resultType"), "TRM");
      assert.equal(params.get("tabs_id"), "toKor");
    }

    const resultPosts = fixture.requests.filter((request) =>
      request.method === "POST" && request.url.startsWith("/tourInfo/info_command.do")
    );
    assert.equal(resultPosts.length, TARGETS.length);
    for (const target of TARGETS) {
      const request = resultPosts.find((item) => new URLSearchParams(item.body).get("to_cd") === target.to_cd);
      assert.ok(request, target.to_cd + " result POST");
      const params = new URLSearchParams(request.body);
      assert.equal(params.get("reg_year"), "2026");
      assert.equal(params.get("gubun"), "E");
      assert.equal(params.get("domestic"), "0");
      assert.equal(params.get("resultType"), "TRM");
      assert.equal(params.get("tabs_id"), "toKor");
      assert.equal(params.get("command"), "RESULT_LIST");
    }

    assert.equal(
      require("node:fs").readFileSync(path.join(ROOT, "server.js"), "utf8"),
      require("node:fs").readFileSync(path.join(ROOT, "server 3.js"), "utf8")
    );
    console.log(JSON.stringify({
      ok: true,
      registrations: TARGETS.map((target) => target.to_cd),
      events: "empty official-shaped resultInfo tbody preserved",
      results: "empty official-shaped result rows preserved"
    }));
  } catch (error) {
    if (app?.stderr()) error.message += "\napp stderr: " + app.stderr();
    throw error;
  } finally {
    await stopApp(app?.child);
    await closeServer(fixture.server);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
