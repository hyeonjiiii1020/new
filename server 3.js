const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const RESULT_ORIGIN = "https://result.kaaf.or.kr";

const TOURNAMENTS = [
  {
    id: "championship",
    name: "제80회 전국육상경기선수권대회",
    period: "2026-05-11 ~ 2026-05-15",
    place: "정선",
    reg_year: "2026",
    to_cd: "E010020803",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  },
  {
    id: "u20",
    name: "제26회 한국 U20육상경기선수권대회",
    period: "2026-05-11 ~ 2026-05-15",
    place: "정선",
    reg_year: "2026",
    to_cd: "E01242024C",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  },
  {
    id: "u18",
    name: "제17회 한국 U18육상경기대회",
    period: "2026-05-11 ~ 2026-05-15",
    place: "정선",
    reg_year: "2026",
    to_cd: "E01510015D",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  },
  {
    id: "youth",
    name: "제28회 전국꿈나무선수선발육상경기대회",
    period: "2026-05-11 ~ 2026-05-15",
    place: "정선",
    reg_year: "2026",
    to_cd: "E016350011",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  }
];

const DEFAULT_TOURNAMENT = TOURNAMENTS[0];
const eventCache = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const ROOT_STATIC_FILES = new Set(["/index.html", "/styles.css", "/app.js"]);

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2));
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function cleanText(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKorSection(html) {
  const start = html.search(/<div[^>]+id=['"]html_kor['"][^>]*>/i);
  const end = html.search(/<div[^>]+id=['"]html_eng['"][^>]*>/i);
  if (start >= 0 && end > start) {
    return html.slice(start, end);
  }
  return html;
}

function extractCells(rowHtml, tagName) {
  const cells = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  for (const match of rowHtml.matchAll(re)) {
    cells.push(cleanText(match[1]));
  }
  return cells;
}

function extractCellObjects(rowHtml, tagName) {
  const cells = [];
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  for (const match of rowHtml.matchAll(re)) {
    cells.push({
      attrs: match[1] || "",
      text: cleanText(match[2])
    });
  }
  return cells;
}

function extractInputValues(sectionHtml) {
  const values = [];
  const re = /<input\b[^>]*class=["'][^"']*input_base[^"']*["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  for (const match of sectionHtml.matchAll(re)) {
    values.push(cleanText(match[1]));
  }
  return values;
}

function valueAt(headers, cells, names) {
  const wanted = names.map((name) => name.toLowerCase());
  const index = headers.findIndex((header) =>
    wanted.some((name) => header.toLowerCase().includes(name))
  );
  return index >= 0 ? cells[index] || "" : "";
}

function parseGoResult(onclick) {
  const match = onclick.match(/go_result\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\)/i);
  if (!match) return null;
  const [, to_cd, reg_year, kind_cd, detail_class_cd, round, gday, resultType] = match;
  return { to_cd, reg_year, kind_cd, detail_class_cd, round, gday, resultType };
}

function findTournament(idOrCode) {
  return (
    TOURNAMENTS.find((item) => item.id === idOrCode || item.to_cd === idOrCode) ||
    DEFAULT_TOURNAMENT
  );
}

function parseEventList(html, tournament) {
  const section = extractKorSection(html);
  const tbodyMatch = section.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];

  const events = [];
  for (const rowMatch of tbodyMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const cells = extractCells(rowHtml, "td");
    const onclick =
      (rowHtml.match(/onclick\s*=\s*"([^"]*go_result[^"]*)"/i) || [])[1] ||
      (rowHtml.match(/onclick\s*=\s*'([^']*go_result[^']*)'/i) || [])[1] ||
      "";
    const params = parseGoResult(onclick);
    if (!params || cells.length < 4) continue;

    const [eventName, division, roundLabel, status] = cells;
    if (!division.endsWith("부")) continue;

    const id = [
      params.kind_cd,
      params.detail_class_cd,
      params.round,
      params.gday || "all",
      params.resultType
    ].join("-");

    events.push({
      id,
      tournament_id: tournament.id,
      eventName,
      division,
      round: roundLabel,
      status,
      label: `${eventName} ${division} ${roundLabel}`,
      params
    });
  }

  return events;
}

function parseResultPage(html, tournament) {
  const section = extractKorSection(html);
  const inputValues = extractInputValues(section);
  const meta = {
    tournament: tournament.name,
    period: tournament.period,
    place: tournament.place,
    eventName: inputValues[0] || "",
    division: inputValues[1] || "",
    round: inputValues[2] || "",
    date: inputValues[3] || "",
    fetchedAt: new Date().toISOString()
  };

  const rows = [];
  for (const combinedRow of parseNestedCombinedRows(section)) {
    rows.push(combinedRow);
  }

  for (const fieldRow of parseNestedFieldRows(section)) {
    rows.push(fieldRow);
  }

  const tableRe = /<table\b[^>]*class=["'][^"']*team_table[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;
  for (const tableMatch of section.matchAll(tableRe)) {
    const table = tableMatch[1];
    if (/twotable/i.test(table)) continue;
    if (!/순위/.test(table) || !/성명/.test(table) || !/기록/.test(table)) continue;

    const heat = cleanText((table.match(/<th\b[^>]*class=["'][^"']*sm_th_title[^"']*["'][^>]*>([\s\S]*?)<\/th>/i) || [])[1] || "");
    const thead = (table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i) || [])[1] || "";
    const headerRows = [...thead.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => extractCells(match[1], "th"));
    const headers = headerRows.reverse().find((list) => list.includes("순위") && list.includes("성명")) || [];
    const tbody = (table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i) || [])[1] || "";

    for (const trMatch of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = extractCells(trMatch[1], "td");
      if (cells.length < 5) continue;

      let rank = valueAt(headers, cells, ["순위"]);
      let name = valueAt(headers, cells, ["성명"]);
      let team = valueAt(headers, cells, ["소속"]);
      let record = valueAt(headers, cells, ["기록"]);
      let wind = valueAt(headers, cells, ["풍속"]);
      let remark = valueAt(headers, cells, ["비고"]);

      if (!headers.length) {
        rank = cells[0] || "";
        name = cells[3] || "";
        team = cells[4] || "";
        record = cells[5] || "";
        wind = cells[6] || "";
        remark = cells[7] || "";
      }

      const statusText = `${record} ${remark}`.toUpperCase();
      if (!rank || !record) continue;
      if (/\b(DNS|DNF)\b|기권|실격/.test(statusText)) continue;

      rows.push({
        rank,
        name,
        team,
        record,
        wind,
        heat,
        remark
      });
    }
  }

  return { tournament, meta, rows };
}

function parseNestedCombinedRows(section) {
  const rows = [];
  const tableRe = /<table\b[^>]*class=["'][^"']*twotable\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;

  for (const tableMatch of section.matchAll(tableRe)) {
    const trMatches = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (trMatches.length < 3) continue;

    const top = extractCellObjects(trMatches[0][1], "td");
    const middle = extractCellObjects(trMatches[1][1], "td");
    if (top.length < 5 || middle.length < 1) continue;
    if (!/rowspan\s*=\s*["']?3/i.test(top[0]?.attrs || "")) continue;

    const rank = top[0]?.text || "";
    const name = top[2]?.text || "";
    const team = middle[0]?.text || "";
    const total = top[3]?.text || "";
    const remark = top[4]?.text || "";
    const statusText = `${total} ${remark}`.toUpperCase();

    if (!name || !total) continue;
    if (/\b(DNS|DNF)\b|기권|실격/.test(statusText)) continue;

    rows.push({
      rank,
      name,
      team,
      record: total,
      wind: "",
      heat: "",
      remark,
      resultKind: "points"
    });
  }

  return rows
    .sort((a, b) => Number(b.record) - Number(a.record))
    .map((row, index, rankedRows) => {
      const previous = rankedRows[index - 1];
      const rank = previous && previous.record === row.record ? previous.rank : String(index + 1);
      return { ...row, rank };
    });
}

function parseNestedFieldRows(section) {
  const rows = [];
  const tableRe = /<table\b[^>]*class=["'][^"']*twotable\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;

  for (const tableMatch of section.matchAll(tableRe)) {
    const trMatches = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (trMatches.length < 2) continue;

    const top = extractCellObjects(trMatches[0][1], "td");
    const bottom = extractCellObjects(trMatches[1][1], "td");
    if (top.length < 6 || bottom.length < 1) continue;

    const rowspanCells = top.filter((cell) => /rowspan\s*=\s*["']?2/i.test(cell.attrs));
    const recordCell = [...rowspanCells].reverse().find((cell) => cell.text && cell.text !== top[0]?.text);
    const rank = top[0]?.text || "";
    const name = top[3]?.text || "";
    const team = bottom[0]?.text || "";
    const record = recordCell?.text || "";
    const remark = top[top.length - 1]?.text || "";

    const statusText = `${record} ${remark}`.toUpperCase();
    if (!rank || !record) continue;
    if (/\b(DNS|DNF)\b|기권|실격/.test(statusText)) continue;

    rows.push({
      rank,
      name,
      team,
      record,
      wind: "",
      heat: "",
      remark
    });
  }

  return rows;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 KAAF result card maker",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`KAAF responded with ${response.status}`);
  }
  return response.text();
}

async function getEvents(tournament) {
  const now = Date.now();
  const cached = eventCache.get(tournament.id);
  if (cached?.data && now - cached.at < 15000) {
    return cached.data;
  }

  const url = `${RESULT_ORIGIN}/tourInfo/resultInfo.do?reg_year=${tournament.reg_year}&to_cd=${tournament.to_cd}&gubun=${tournament.gubun}&domestic=${tournament.domestic}&resultType=${tournament.resultType}&kind_cd=&tabs_id=${tournament.tabs_id}`;
  const html = await fetchText(url);
  const events = parseEventList(html, tournament);
  eventCache.set(tournament.id, { at: now, data: events });
  return events;
}

async function getResult(searchParams) {
  const tournament = findTournament(searchParams.get("tournament_id") || searchParams.get("to_cd"));
  const body = new URLSearchParams({
    reg_year: searchParams.get("reg_year") || tournament.reg_year,
    to_cd: searchParams.get("to_cd") || tournament.to_cd,
    kind_cd: searchParams.get("kind_cd") || "",
    detail_class_cd: searchParams.get("detail_class_cd") || "",
    round: searchParams.get("round") || "",
    gday: searchParams.get("gday") || "",
    resultType: searchParams.get("resultType") || tournament.resultType,
    command: "RESULT_LIST",
    domestic: tournament.domestic,
    tabs_id: tournament.tabs_id,
    gubun: tournament.gubun
  });

  const html = await fetchText(`${RESULT_ORIGIN}/tourInfo/info_command.do`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Origin": RESULT_ORIGIN,
      "Referer": `${RESULT_ORIGIN}/tourInfo/resultInfo.do`
    },
    body
  });
  return parseResultPage(html, tournament);
}

async function handleApi(req, res, pathname, searchParams) {
  try {
    if (pathname === "/api/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/tournaments") {
      return sendJson(res, 200, {
        tournaments: TOURNAMENTS,
        defaultTournament: DEFAULT_TOURNAMENT.id
      });
    }

    if (pathname === "/api/events") {
      const tournament = findTournament(searchParams.get("tournament_id") || searchParams.get("to_cd"));
      const events = await getEvents(tournament);
      return sendJson(res, 200, { tournament, events });
    }

    if (pathname === "/api/result") {
      const result = await getResult(searchParams);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: "API endpoint not found" });
  } catch (error) {
    return sendJson(res, 502, {
      error: "대한육상연맹 결과를 불러오지 못했습니다.",
      detail: error.message
    });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const candidates = [
    {
      base: PUBLIC_DIR,
      filePath: path.normalize(path.join(PUBLIC_DIR, requested))
    }
  ];

  if (ROOT_STATIC_FILES.has(requested)) {
    candidates.push({
      base: ROOT,
      filePath: path.normalize(path.join(ROOT, requested))
    });
  }

  for (const candidate of candidates) {
    if (!candidate.filePath.startsWith(candidate.base)) continue;

    try {
      const file = await fs.readFile(candidate.filePath);
      const type = MIME[path.extname(candidate.filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(file);
      return;
    } catch {
      // Try the next location. This keeps deployments working even if GitHub
      // uploads index.html/app.js/styles.css at the repository root.
    }
  }

  send(res, 404, "Not found", "text/plain; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname, url.searchParams);
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`KAAF card maker running at http://localhost:${PORT}`);
});
