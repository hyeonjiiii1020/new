const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const RESULT_ORIGIN = "https://result.kaaf.or.kr";
const PACE_ORIGIN = "https://pace-rise-node.com";

const TOURNAMENTS = [
  {
    id: "jeongseon-distance-masters-2026",
    name: "2026 정선 중장거리 챌린지대회 (마스터즈)",
    period: "2026-07-25 ~ 2026-07-25",
    place: "정선",
    source: "pace",
    comp_id: "51",
    divisionMap: {
      M: "남자부",
      F: "여자부",
      X: "혼성"
    }
  },
  {
    id: "jeongseon-distance-elite-2026",
    name: "2026 정선 중장거리 챌린지대회 (엘리트)",
    period: "2026-07-25 ~ 2026-07-25",
    place: "정선군",
    source: "pace",
    comp_id: "58",
    divisionMap: {
      M: "남자부",
      F: "여자부",
      X: "혼성"
    }
  },
  {
    id: "kuaf-university-2026",
    name: "제5회 전국대학육상경기대회",
    period: "2026-06-29 ~ 2026-07-01",
    place: "서천군",
    source: "pace",
    comp_id: "55",
    divisionMap: {
      M: "남자대학부",
      F: "여자대학부",
      X: "대학부"
    }
  },
  {
    id: "ktfl-president-cup-2026",
    name: "제2회 한국실업육상연맹회장배 전국실업육상경기대회",
    period: "2026-06-29 ~ 2026-07-01",
    place: "서천군",
    source: "pace",
    comp_id: "56",
    divisionMap: {
      M: "남자실업부",
      F: "여자실업부",
      X: "실업부"
    }
  },
  {
    id: "miryang-2026",
    name: "2026 밀양아리랑 전국육상경기대회",
    period: "2026-06-05 ~ 2026-06-09",
    place: "밀양",
    reg_year: "2026",
    to_cd: "E016370011",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  },
  {
    id: "baekje-iksan-2026",
    name: "백제왕도 익산 2026 전국육상경기대회",
    period: "2026-07-04 ~ 2026-07-08",
    place: "익산",
    reg_year: "2026",
    to_cd: "E016200031",
    gubun: "E",
    domestic: "0",
    resultType: "TRM",
    tabs_id: "toKor"
  }
];

const MIRYANG_EVENT_SPECS = [
  ["100m", "남자고등학교부", "예선", "경기완료", "13", "11", "1", "", "TRM"],
  ["100m", "여자고등학교부", "예선", "경기완료", "23", "11", "1", "", "TRM"],
  ["100m", "여자고등학교부", "결승", "순위처리", "23", "11", "4", "", "TRM"],
  ["100m", "여자일반부", "예선", "경기완료", "25", "11", "1", "", "TRM"],
  ["100m", "여자일반부", "결승", "순위처리", "25", "11", "4", "", "TRM"],
  ["400m", "남자중학교부", "예선", "경기완료", "12", "13", "1", "", "TRM"],
  ["400m", "남자중학교부", "결승", "순위처리", "12", "13", "4", "", "TRM"],
  ["400m", "남자대학교부", "결승", "순위처리", "14", "13", "4", "", "TRM"],
  ["400m", "여자대학교부", "결승", "순위처리", "24", "13", "4", "", "TRM"],
  ["800m", "남자일반부", "예선", "경기완료", "15", "14", "1", "", "TRM"],
  ["800m", "남자일반부", "결승", "순위처리", "15", "14", "4", "", "TRM"],
  ["800m", "여자고등학교부", "결승", "순위처리", "23", "14", "4", "", "TRM"],
  ["800m", "여자일반부", "예선", "경기완료", "25", "14", "1", "", "TRM"],
  ["800m", "여자일반부", "결승", "순위처리", "25", "14", "4", "", "TRM"],
  ["1500m", "여자중학교부", "결승", "순위처리", "22", "16", "4", "", "TRM"],
  ["3000mSC", "남자일반부", "결승", "순위처리", "15", "1B", "4", "", "TRM"],
  ["3000mSC", "여자일반부", "결승", "순위처리", "25", "1B", "4", "", "TRM"],
  ["100mH", "여자고등학교부", "결승", "순위처리", "23", "1C", "4", "", "TRM"],
  ["높이뛰기", "여자중학교부", "결승", "경기완료", "22", "21", "4", "", "TRM"],
  ["높이뛰기", "남자대학교부", "결승", "순위처리", "14", "21", "4", "", "TRM"],
  ["높이뛰기", "남자일반부", "결승", "순위처리", "15", "21", "4", "", "TRM"],
  ["장대높이뛰기", "여자일반부", "결승", "순위처리", "25", "22", "4", "", "TRM"],
  ["멀리뛰기", "남자중학교부", "결승", "순위처리", "12", "23", "4", "", "TRM"],
  ["멀리뛰기", "남자일반부", "결승", "순위처리", "15", "23", "4", "", "TRM"],
  ["멀리뛰기", "여자중학교부", "결승", "순위처리", "22", "23", "4", "", "TRM"],
  ["해머던지기", "남자고등학교부", "결승", "순위처리", "13", "27", "4", "", "TRM"],
  ["해머던지기", "남자대학교부", "결승", "순위처리", "14", "27", "4", "", "TRM"],
  ["해머던지기", "남자일반부", "결승", "순위처리", "15", "27", "4", "", "TRM"],
  ["해머던지기", "여자고등학교부", "결승", "순위처리", "23", "27", "4", "", "TRM"],
  ["해머던지기", "여자일반부", "결승", "순위처리", "25", "27", "4", "", "TRM"],
  ["10종경기", "남자고등학교부", "결승", "순위처리", "13", "41", "4", "", "TRM"],
  ["10종경기", "남자대학교부", "결승", "순위처리", "14", "41", "4", "", "TRM"],
  ["10종경기", "남자일반부", "결승", "순위처리", "15", "41", "4", "", "TRM"],
  ["7종경기", "여자고등학교부", "결승", "순위처리", "23", "42", "4", "", "TRM"],
  ["4x100mR", "남자중학교부", "결승", "순위처리", "12", "51", "4", "", "TRM"],
  ["4x100mR", "남자일반부", "결승", "순위처리", "15", "51", "4", "", "TRM"],
  ["4x100mR", "여자중학교부", "결승", "순위처리", "22", "51", "4", "", "TRM"],
  ["4x100mR", "여자일반부", "결승", "순위처리", "25", "51", "4", "", "TRM"],
  ["4x400mR(Mixed)", "중학교부", "결승", "순위처리", "32", "54", "4", "", "TRM"],
  ["4x800mR", "남자중학교부", "결승", "순위처리", "12", "56", "4", "", "TRM"],
  ["4x800mR", "여자중학교부", "결승", "순위처리", "22", "56", "4", "", "TRM"],
  ["100m(10종)", "남자고등학교부", "결승", "경기완료", "13", "A1", "4", "", "TRM"],
  ["100m(10종)", "남자대학교부", "결승", "경기완료", "14", "A1", "4", "", "TRM"],
  ["100m(10종)", "남자일반부", "결승", "경기완료", "15", "A1", "4", "", "TRM"],
  ["멀리뛰기(10종)", "남자고등학교부", "결승", "경기완료", "13", "A2", "4", "", "TRM"],
  ["멀리뛰기(10종)", "남자대학교부", "결승", "경기완료", "14", "A2", "4", "", "TRM"],
  ["멀리뛰기(10종)", "남자일반부", "결승", "경기완료", "15", "A2", "4", "", "TRM"],
  ["포환던지기(10종)", "남자고등학교부", "결승", "경기완료", "13", "A3", "4", "", "TRM"],
  ["포환던지기(10종)", "남자대학교부", "결승", "경기완료", "14", "A3", "4", "", "TRM"],
  ["포환던지기(10종)", "남자일반부", "결승", "경기완료", "15", "A3", "4", "", "TRM"],
  ["높이뛰기(10종)", "남자고등학교부", "결승", "경기완료", "13", "A4", "4", "", "TRM"],
  ["높이뛰기(10종)", "남자대학교부", "결승", "경기완료", "14", "A4", "4", "", "TRM"],
  ["높이뛰기(10종)", "남자일반부", "결승", "경기완료", "15", "A4", "4", "", "TRM"],
  ["100mH(7종)", "여자고등학교부", "결승", "경기완료", "23", "B1", "4", "", "TRM"],
  ["높이뛰기(7종)", "여자고등학교부", "결승", "경기완료", "23", "B2", "4", "", "TRM"],
  ["포환던지기(7종)", "여자고등학교부", "결승", "경기완료", "23", "B3", "4", "", "TRM"]
];

const DEFAULT_TOURNAMENT = TOURNAMENTS[0];
const eventCache = new Map();
const resultCache = new Map();
const issueCache = { generatedAt: 0, payload: null };
const ISSUE_CACHE_MS = 10 * 60 * 1000;
const ISSUE_SOURCES = [
  {
    id: "world-athletics",
    name: "World Athletics",
    group: "공식",
    url: "https://worldathletics.org/news/rss"
  },
  {
    id: "letsrun",
    name: "LetsRun",
    group: "육상 매체",
    url: "https://www.letsrun.com/feed/"
  },
  {
    id: "athletics-weekly",
    name: "Athletics Weekly",
    group: "육상 매체",
    url: "https://athleticsweekly.com/feed/"
  },
  {
    id: "canadian-running",
    name: "Canadian Running Magazine",
    group: "육상 매체",
    url: "https://runningmagazine.ca/feed/"
  },
  {
    id: "runners-world",
    name: "Runner's World",
    group: "러닝 매체",
    url: "https://www.runnersworld.com/rss/all.xml/"
  }
];

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

const ROOT_STATIC_FILES = new Set(["/index.html", "/styles.css", "/app.js", "/schedule-automation.js"]);

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
  const events = [];
  const seen = new Set();
  for (const rowMatch of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const cells = extractCells(rowHtml, "td");
    const onclick =
      (rowHtml.match(/onclick\s*=\s*"([^"]*go_result[^"]*)"/i) || [])[1] ||
      (rowHtml.match(/onclick\s*=\s*'([^']*go_result[^']*)'/i) || [])[1] ||
      "";
    const params = parseGoResult(onclick);
    if (!params || cells.length < 4) continue;

    const [eventName, division, roundLabel, status] = cells;
    if (!eventName || !division || !roundLabel) continue;

    const id = [
      params.kind_cd,
      params.detail_class_cd,
      params.round,
      params.gday || "all",
      params.resultType
    ].join("-");
    if (seen.has(id)) continue;
    seen.add(id);

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

function fallbackEventsForTournament(tournament) {
  if (tournament.id !== "miryang-2026") return [];

  return MIRYANG_EVENT_SPECS.map(([eventName, division, round, status, kind_cd, detail_class_cd, roundCode, gday, resultType]) => {
    const id = [kind_cd, detail_class_cd, roundCode, gday || "all", resultType].join("-");
    return {
      id,
      tournament_id: tournament.id,
      eventName,
      division,
      round,
      status,
      label: `${eventName} ${division} ${round}`,
      params: {
        to_cd: tournament.to_cd,
        reg_year: tournament.reg_year,
        kind_cd,
        detail_class_cd,
        round: roundCode,
        gday,
        resultType
      }
    };
  });
}

function isRelayEventName(name) {
  const text = String(name || "")
    .replace(/×/g, "x")
    .replace(/\s+/g, "")
    .toLowerCase();
  return /\d+x\d+(?:m)?r/.test(text) || text.includes("계주") || text.includes("relay");
}

function joinRelayNames(names) {
  const seen = new Set();
  return names
    .map((name) => String(name || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .join(" ");
}

function parseRelayRows(section) {
  const rows = [];
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

    let current = null;
    const finishCurrent = () => {
      if (!current) return;
      const statusText = `${current.record} ${current.remark}`.toUpperCase();
      if (current.rank && current.record && !/\b(DNS|DNF)\b|기권|실격/.test(statusText)) {
        rows.push({
          ...current,
          name: joinRelayNames(current.names),
          resultKind: "relay"
        });
      }
      current = null;
    };

    for (const trMatch of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = extractCells(trMatch[1], "td");
      if (cells.length < 4) continue;

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

      if (rank && record) {
        finishCurrent();
        current = {
          rank,
          names: [],
          team,
          record,
          wind,
          heat,
          remark
        };
      }

      if (current && name) {
        current.names.push(name);
      }
    }

    finishCurrent();
  }

  return rows;
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

  if (isRelayEventName(meta.eventName)) {
    const relayRows = parseRelayRows(section);
    if (relayRows.length) {
      return { tournament, meta, rows: relayRows };
    }
  }

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

function cleanPaceDivision(value) {
  return String(value || "")
    .split(/\d{1,2}\s*시/)[0]
    .replace(/\s+/g, " ")
    .replace(/남자\s*/g, "남자")
    .replace(/여자\s*/g, "여자")
    .replace(/대학\s*부/g, "대학부")
    .replace(/실업\s*부/g, "실업부")
    .trim();
}

function paceGenderDivision(eventOrGender, tournament = {}) {
  const event = typeof eventOrGender === "object" && eventOrGender ? eventOrGender : null;
  const gender = event ? event.gender : eventOrGender;
  const explicit = cleanPaceDivision(event?.division) || cleanPaceDivision(event?.callroom_event_memo);
  if (explicit) return explicit;
  if (tournament.divisionMap?.[gender]) return tournament.divisionMap[gender];
  return {
    M: "남자실업부",
    F: "여자실업부",
    X: "혼성"
  }[gender] || "";
}

function paceRoundLabel(round) {
  return {
    preliminary: "예선",
    semifinal: "준결승",
    final: "결승"
  }[round] || round || "";
}

function paceStatusLabel(status) {
  return {
    completed: "완료",
    in_progress: "진행중",
    heats_generated: "조편성",
    created: "예정",
    registered: "대기"
  }[status] || status || "";
}

function parsePaceEventList(events, tournament) {
  return events
    .filter((event) => !event.parent_event_id)
    .sort((a, b) => {
      const order = (a.sort_order || 0) - (b.sort_order || 0);
      if (order) return order;
      return `${a.gender || ""}${a.name || ""}${a.round_type || ""}`.localeCompare(
        `${b.gender || ""}${b.name || ""}${b.round_type || ""}`
      );
    })
    .map((event) => {
      const division = paceGenderDivision(event, tournament);
      const round = paceRoundLabel(event.round_type);
      return {
        id: `pace-${tournament.comp_id}-${event.id}`,
        tournament_id: tournament.id,
        eventName: event.name || "",
        division,
        round,
        status: paceStatusLabel(event.round_status),
        label: `${event.name || ""} ${division} ${round}`.replace(/\s+/g, " ").trim(),
        params: {
          source: "pace",
          event_id: String(event.id)
        }
      };
    });
}

function formatPaceTime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "";
  const value = Number(seconds);
  const rounded3 = Math.round(value * 1000) / 1000;
  const rounded2 = Math.round(value * 100) / 100;
  const decimalPlaces = Math.abs(rounded3 - rounded2) < 0.0001 ? 2 : 3;

  if (value >= 3600) {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value - hours * 3600) / 60);
    const secondsPart = value - hours * 3600 - minutes * 60;
    return `${hours}:${String(minutes).padStart(2, "0")}:${secondsPart
      .toFixed(decimalPlaces)
      .padStart(decimalPlaces + 3, "0")}`;
  }

  if (value >= 60) {
    const minutes = Math.floor(value / 60);
    const secondsPart = value - minutes * 60;
    return `${minutes}:${secondsPart.toFixed(decimalPlaces).padStart(decimalPlaces + 3, "0")}`;
  }

  return value.toFixed(decimalPlaces);
}

function formatPaceMeasure(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return Number(value).toFixed(2);
}

function paceHeatLabel(heat, heatCount, event) {
  if (!heat || heatCount <= 1) return "";
  if (event?.round_type === "final") return "";
  return heat.heat_name || `${heat.heat_number || ""}조`.trim();
}

function rankPaceRows(rows, higherBetter = false) {
  const sorted = rows
    .map((row, index) => ({ ...row, originalIndex: index }))
    .sort((a, b) => {
      if (a.sortValue == null && b.sortValue == null) return a.originalIndex - b.originalIndex;
      if (a.sortValue == null) return 1;
      if (b.sortValue == null) return -1;
      if (a.sortValue === b.sortValue) return a.originalIndex - b.originalIndex;
      return higherBetter ? b.sortValue - a.sortValue : a.sortValue - b.sortValue;
    });

  let previousValue = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const rank = row.sortValue === previousValue ? previousRank : index + 1;
    previousValue = row.sortValue;
    previousRank = rank;
    const { originalIndex, sortValue, ...cleanRow } = row;
    return { ...cleanRow, rank: String(rank) };
  });
}

function parsePaceTrackRows(data) {
  const rows = [];
  const heatCount = data.heats?.length || 0;
  const shouldRankOverall = data.event?.round_type === "final" || heatCount <= 1;

  for (const heat of data.heats || []) {
    const heatRows = [];
    for (const entry of heat.entries || []) {
      const result = (heat.results || []).find((item) => item.event_entry_id === entry.event_entry_id);
      const statusCode = (result?.status_code || "").toUpperCase();
      const time = result?.time_seconds;

      if (statusCode || time == null) continue;

      heatRows.push({
        rank: "",
        name: entry.name || "",
        team: entry.team || "",
        record: formatPaceTime(time),
        wind: heat.wind || result?.wind || "",
        heat: paceHeatLabel(heat, heatCount, data.event),
        remark: result?.remark || "",
        sortValue: Number(time)
      });
    }
    rows.push(...(shouldRankOverall ? heatRows : rankPaceRows(heatRows)));
  }

  return shouldRankOverall ? rankPaceRows(rows) : rows;
}

function parsePaceFieldDistanceRows(data) {
  const rows = [];
  const heatCount = data.heats?.length || 0;
  const shouldRankOverall = data.event?.round_type === "final" || heatCount <= 1;

  for (const heat of data.heats || []) {
    const heatRows = [];
    for (const entry of heat.entries || []) {
      const entryResults = (heat.results || []).filter((item) => item.event_entry_id === entry.event_entry_id);
      const statusCode = (entryResults.find((item) => item.status_code)?.status_code || "").toUpperCase();
      if (statusCode) continue;

      const valid = entryResults
        .filter((item) => item.distance_meters != null && Number(item.distance_meters) > 0)
        .map((item) => Number(item.distance_meters))
        .sort((a, b) => b - a);
      const best = valid[0];
      if (best == null) continue;

      heatRows.push({
        rank: "",
        name: entry.name || "",
        team: entry.team || "",
        record: formatPaceMeasure(best),
        wind: "",
        heat: paceHeatLabel(heat, heatCount, data.event),
        remark: "",
        sortValue: best,
        tiebreakValues: valid
      });
    }

    heatRows.sort((a, b) => {
      if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
      const length = Math.max(a.tiebreakValues.length, b.tiebreakValues.length);
      for (let index = 1; index < length; index += 1) {
        const aValue = a.tiebreakValues[index] || -1;
        const bValue = b.tiebreakValues[index] || -1;
        if (bValue !== aValue) return bValue - aValue;
      }
      return 0;
    });

    if (shouldRankOverall) {
      rows.push(...heatRows);
    } else {
      let previousKey = "";
      let previousRank = 0;
      heatRows.forEach((row, index) => {
        const key = row.tiebreakValues.join("|");
        const rank = key === previousKey ? previousRank : index + 1;
        previousKey = key;
        previousRank = rank;
        const { tiebreakValues, ...cleanRow } = row;
        rows.push({ ...cleanRow, rank: String(rank) });
      });
    }
  }

  const rankedRows = shouldRankOverall
    ? (() => {
        let previousKey = "";
        let previousRank = 0;
        return rows
          .sort((a, b) => {
            if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
            const length = Math.max(a.tiebreakValues.length, b.tiebreakValues.length);
            for (let index = 1; index < length; index += 1) {
              const aValue = a.tiebreakValues[index] || -1;
              const bValue = b.tiebreakValues[index] || -1;
              if (bValue !== aValue) return bValue - aValue;
            }
            return 0;
          })
          .map((row, index) => {
            const key = row.tiebreakValues.join("|");
            const rank = key === previousKey ? previousRank : index + 1;
            previousKey = key;
            previousRank = rank;
            return { ...row, rank: String(rank) };
          });
      })()
    : rows;

  return rankedRows.map(({ sortValue, tiebreakValues, ...row }) => row);
}

function parsePaceFieldHeightRows(data) {
  const rows = [];
  const heatCount = data.heats?.length || 0;
  const shouldRankOverall = data.event?.round_type === "final" || heatCount <= 1;

  for (const heat of data.heats || []) {
    const attempts = heat.height_attempts || [];
    const heights = [...new Set(attempts.map((item) => Number(item.bar_height)).filter(Boolean))].sort((a, b) => a - b);
    const heatRows = [];

    for (const entry of heat.entries || []) {
      const entryAttempts = attempts.filter((item) => item.event_entry_id === entry.event_entry_id);
      let best = null;
      let totalFails = 0;
      let failsAtBest = 0;

      for (const height of heights) {
        const atHeight = entryAttempts.filter((item) => Number(item.bar_height) === height);
        const fails = atHeight.filter((item) => item.result_mark === "X").length;
        totalFails += fails;
        if (atHeight.some((item) => item.result_mark === "O")) {
          best = height;
          failsAtBest = fails;
        }
      }

      if (best == null) continue;

      heatRows.push({
        rank: "",
        name: entry.name || "",
        team: entry.team || "",
        record: formatPaceMeasure(best),
        wind: "",
        heat: paceHeatLabel(heat, heatCount, data.event),
        remark: "",
        sortValue: best,
        failsAtBest,
        totalFails
      });
    }

    heatRows.sort((a, b) => {
      if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
      if (a.failsAtBest !== b.failsAtBest) return a.failsAtBest - b.failsAtBest;
      return a.totalFails - b.totalFails;
    });

    if (shouldRankOverall) {
      rows.push(...heatRows);
    } else {
      let previousKey = "";
      let previousRank = 0;
      heatRows.forEach((row, index) => {
        const key = `${row.sortValue}|${row.failsAtBest}|${row.totalFails}`;
        const rank = key === previousKey ? previousRank : index + 1;
        previousKey = key;
        previousRank = rank;
        const { sortValue, failsAtBest, totalFails, ...cleanRow } = row;
        rows.push({ ...cleanRow, rank: String(rank) });
      });
    }
  }

  if (!shouldRankOverall) return rows;

  let previousKey = "";
  let previousRank = 0;
  return rows
    .sort((a, b) => {
      if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
      if (a.failsAtBest !== b.failsAtBest) return a.failsAtBest - b.failsAtBest;
      return a.totalFails - b.totalFails;
    })
    .map((row, index) => {
      const key = `${row.sortValue}|${row.failsAtBest}|${row.totalFails}`;
      const rank = key === previousKey ? previousRank : index + 1;
      previousKey = key;
      previousRank = rank;
      const { sortValue, failsAtBest, totalFails, ...cleanRow } = row;
      return { ...cleanRow, rank: String(rank) };
    });
}

const PACE_WA_TABLES = {
  M_100m: { A: 25.4347, B: 18, C: 1.81, type: "track" },
  M_long_jump: { A: 0.14354, B: 220, C: 1.4, type: "field_cm" },
  M_shot_put: { A: 51.39, B: 1.5, C: 1.05, type: "field_m" },
  M_high_jump: { A: 0.8465, B: 75, C: 1.42, type: "field_cm" },
  M_400m: { A: 1.53775, B: 82, C: 1.81, type: "track" },
  M_110m_hurdles: { A: 5.74352, B: 28.5, C: 1.92, type: "track" },
  M_discus: { A: 12.91, B: 4, C: 1.1, type: "field_m" },
  M_pole_vault: { A: 0.2797, B: 100, C: 1.35, type: "field_cm" },
  M_javelin: { A: 10.14, B: 7, C: 1.08, type: "field_m" },
  M_1500m: { A: 0.03768, B: 480, C: 1.85, type: "track" },
  F_100m_hurdles: { A: 9.23076, B: 26.7, C: 1.835, type: "track" },
  F_high_jump: { A: 1.84523, B: 75, C: 1.348, type: "field_cm" },
  F_shot_put: { A: 56.0211, B: 1.5, C: 1.05, type: "field_m" },
  F_200m: { A: 4.99087, B: 42.5, C: 1.81, type: "track" },
  F_long_jump: { A: 0.188807, B: 210, C: 1.41, type: "field_cm" },
  F_javelin: { A: 15.9803, B: 3.8, C: 1.04, type: "field_m" },
  F_800m: { A: 0.11193, B: 254, C: 1.88, type: "track" }
};

const PACE_DECATHLON_EVENTS = [
  { order: 1, key: "M_100m", name: "100m" },
  { order: 2, key: "M_long_jump", name: "멀리뛰기" },
  { order: 3, key: "M_shot_put", name: "포환던지기" },
  { order: 4, key: "M_high_jump", name: "높이뛰기" },
  { order: 5, key: "M_400m", name: "400m" },
  { order: 6, key: "M_110m_hurdles", name: "110mH" },
  { order: 7, key: "M_discus", name: "원반던지기" },
  { order: 8, key: "M_pole_vault", name: "장대높이뛰기" },
  { order: 9, key: "M_javelin", name: "창던지기" },
  { order: 10, key: "M_1500m", name: "1500m" }
];

const PACE_HEPTATHLON_EVENTS = [
  { order: 1, key: "F_100m_hurdles", name: "100mH" },
  { order: 2, key: "F_high_jump", name: "높이뛰기" },
  { order: 3, key: "F_shot_put", name: "포환던지기" },
  { order: 4, key: "F_200m", name: "200m" },
  { order: 5, key: "F_long_jump", name: "멀리뛰기" },
  { order: 6, key: "F_javelin", name: "창던지기" },
  { order: 7, key: "F_800m", name: "800m" }
];

function calcPaceWAPoints(key, record) {
  const table = PACE_WA_TABLES[key];
  const raw = Number(record);
  if (!table || !raw || Number.isNaN(raw)) return 0;

  if (table.type === "track") {
    const value = table.B - raw;
    return value > 0 ? Math.floor(table.A * value ** table.C) : 0;
  }

  if (table.type === "field_cm") {
    const value = raw * 100 - table.B;
    return value > 0 ? Math.floor(table.A * value ** table.C) : 0;
  }

  const value = raw - table.B;
  return value > 0 ? Math.floor(table.A * value ** table.C) : 0;
}

function cleanCombinedEventName(name) {
  return String(name || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function findPaceSubEvent(subEvents, definition) {
  const wanted = cleanCombinedEventName(definition.name);
  return subEvents.find((event) => cleanCombinedEventName(event.name) === wanted);
}

function findMatchingPaceEntry(entries, parentEntry) {
  return entries.find((entry) => {
    const bibMatch = entry.bib_number && parentEntry.bib_number && String(entry.bib_number) === String(parentEntry.bib_number);
    const identityMatch = entry.name === parentEntry.name && entry.team === parentEntry.team;
    return bibMatch || identityMatch;
  });
}

function extractPaceSubRecord(subData, parentEntry) {
  const event = subData.event || {};
  for (const heat of subData.heats || []) {
    const entry = findMatchingPaceEntry(heat.entries || [], parentEntry);
    if (!entry) continue;

    if (event.category === "track" || event.category === "relay" || event.category === "road") {
      const result = (heat.results || []).find((item) => item.event_entry_id === entry.event_entry_id);
      if (!result || result.status_code || result.time_seconds == null) return null;
      return Number(result.time_seconds);
    }

    if (event.category === "field_distance") {
      const valid = (heat.results || [])
        .filter((item) => item.event_entry_id === entry.event_entry_id)
        .filter((item) => item.attempt_number && item.distance_meters != null && Number(item.distance_meters) > 0)
        .map((item) => Number(item.distance_meters));
      return valid.length ? Math.max(...valid) : null;
    }

    if (event.category === "field_height") {
      const attempts = (heat.height_attempts || []).filter((item) => item.event_entry_id === entry.event_entry_id);
      const clearances = attempts
        .filter((item) => item.result_mark === "O")
        .map((item) => Number(item.bar_height));
      return clearances.length ? Math.max(...clearances) : null;
    }
  }

  return null;
}

async function parsePaceCombinedRows(event) {
  const [subEvents, entries] = await Promise.all([
    fetchJson(`${PACE_ORIGIN}/api/combined-sub-events?parent_event_id=${event.id}`),
    fetchJson(`${PACE_ORIGIN}/api/events/${event.id}/entries`)
  ]);
  const definitions = event.gender === "M" ? PACE_DECATHLON_EVENTS : PACE_HEPTATHLON_EVENTS;
  const subData = new Map();

  for (const definition of definitions) {
    const subEvent = findPaceSubEvent(subEvents, definition);
    if (!subEvent) continue;
    try {
      subData.set(definition.key, await fetchJson(`${PACE_ORIGIN}/api/events/${subEvent.id}/live-results`));
    } catch {
      // Some later-day combined sub-events may not have live result data yet.
    }
  }

  const rows = entries
    .map((entry) => {
      const total = definitions.reduce((sum, definition) => {
        const data = subData.get(definition.key);
        if (!data) return sum;
        const record = extractPaceSubRecord(data, entry);
        return sum + calcPaceWAPoints(definition.key, record);
      }, 0);
      return {
        rank: "",
        name: entry.name || "",
        team: entry.team || "",
        record: total > 0 ? String(total) : "",
        wind: "",
        heat: "",
        remark: "",
        sortValue: total,
        resultKind: "points"
      };
    })
    .filter((row) => row.sortValue > 0);

  return rankPaceRows(rows, true);
}

async function parsePaceResult(data) {
  const category = data.event?.category || "";

  if (category === "combined") {
    return parsePaceCombinedRows(data.event);
  }

  if (category === "field_distance") {
    return parsePaceFieldDistanceRows(data);
  }

  if (category === "field_height") {
    return parsePaceFieldHeightRows(data);
  }

  return parsePaceTrackRows(data);
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
    const rank = top[0]?.text || (/^\d+$/.test(top[1]?.text || "") ? top[1].text : "");
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

function kaafResultInfoUrl(tournament) {
  return `${RESULT_ORIGIN}/tourInfo/resultInfo.do?reg_year=${tournament.reg_year}&to_cd=${tournament.to_cd}&gubun=${tournament.gubun}&domestic=${tournament.domestic}&resultType=${tournament.resultType}&kind_cd=&tabs_id=${tournament.tabs_id}`;
}

function isKaafServerError(html) {
  return /NullPointerException|전산운영시스템\s*500|class\s+java\.lang/i.test(html || "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsessionId(html) {
  const match = String(html || "").match(/info_command\.do;jsessionid=([A-Z0-9]+)/i);
  return match ? match[1] : "";
}

async function fetchKaafText(url, options = {}, attempts = 6) {
  let lastHtml = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastHtml = await fetchText(url, options);
    if (!isKaafServerError(lastHtml)) return lastHtml;
    if (attempt < attempts - 1) {
      await wait(450 * (attempt + 1));
    }
  }
  return lastHtml;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 KAAF result card maker",
      "Accept": "application/json,text/plain,*/*",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Result source responded with ${response.status}`);
  }
  return response.json();
}

async function getEvents(tournament) {
  if (tournament.source === "pace") {
    return getPaceEvents(tournament);
  }

  const now = Date.now();
  const cached = eventCache.get(tournament.id);
  if (cached?.data && now - cached.at < 15000) {
    return cached.data;
  }

  const html = await fetchKaafText(kaafResultInfoUrl(tournament));
  let events = parseEventList(html, tournament);
  if (!events.length) {
    events = fallbackEventsForTournament(tournament);
  }
  eventCache.set(tournament.id, { at: now, data: events });
  return events;
}

async function getPaceEvents(tournament) {
  const now = Date.now();
  const cached = eventCache.get(tournament.id);
  if (cached?.data && now - cached.at < 15000) {
    return cached.data;
  }

  const events = await fetchJson(`${PACE_ORIGIN}/api/events?competition_id=${tournament.comp_id}`);
  const parsedEvents = parsePaceEventList(events, tournament);
  eventCache.set(tournament.id, { at: now, data: parsedEvents });
  return parsedEvents;
}

async function getResult(searchParams) {
  const tournament = findTournament(searchParams.get("tournament_id") || searchParams.get("to_cd"));
  if (tournament.source === "pace" || searchParams.get("source") === "pace") {
    return getPaceResult(searchParams, tournament);
  }

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
  const cacheKey = [
    tournament.id,
    body.get("reg_year"),
    body.get("to_cd"),
    body.get("kind_cd"),
    body.get("detail_class_cd"),
    body.get("round"),
    body.get("gday"),
    body.get("resultType")
  ].join("|");
  const cached = resultCache.get(cacheKey);
  const referer = kaafResultInfoUrl(tournament);
  let commandUrl = `${RESULT_ORIGIN}/tourInfo/info_command.do`;

  try {
    const warmHtml = await fetchKaafText(referer, {}, 2);
    const jsessionId = extractJsessionId(warmHtml);
    if (jsessionId && !isKaafServerError(warmHtml)) {
      commandUrl = `${RESULT_ORIGIN}/tourInfo/info_command.do;jsessionid=${jsessionId}`;
    }
  } catch {
    // The result POST below can still work even when the warm-up request fails.
  }

  const html = await fetchKaafText(commandUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Origin": RESULT_ORIGIN,
      "Referer": referer
    },
    body
  }, 6);
  const result = parseResultPage(html, tournament);
  if (isKaafServerError(html)) {
    if (cached?.data && Date.now() - cached.at < 10 * 60 * 1000) {
      return {
        ...cached.data,
        meta: {
          ...cached.data.meta,
          cached: true,
          fetchedAt: new Date().toISOString()
        }
      };
    }
    throw new Error("KAAF 서버가 일시적으로 500 오류를 반환했습니다. 잠시 뒤 새로고침해주세요.");
  }
  if (result.rows.length) {
    resultCache.set(cacheKey, { at: Date.now(), data: result });
  }
  return result;
}

async function getPaceResult(searchParams, tournament) {
  const eventId = searchParams.get("event_id");
  if (!eventId) {
    throw new Error("PACE event_id is missing");
  }

  const data = await fetchJson(`${PACE_ORIGIN}/api/events/${eventId}/live-results`);
  const rows = await parsePaceResult(data);
  const event = data.event || {};
  const meta = {
    tournament: tournament.name,
    period: tournament.period,
    place: tournament.place,
    eventName: event.name || "",
    division: paceGenderDivision(event, tournament),
    round: paceRoundLabel(event.round_type),
    date: tournament.period,
    fetchedAt: new Date().toISOString()
  };

  return { tournament, meta, rows };
}

function isContentIdeaEvent(event) {
  if (String(event.round || "").trim() !== "결승") return false;
  if (!/(완료|순위)/.test(String(event.status || ""))) return false;
  if (/\((?:10|7)종\)/.test(String(event.eventName || ""))) return false;
  return /^(?:100m|200m|400m|800m|1500m|3000m|5000m|10000m|3000mSC|100mH|110mH|400mH|4x|높이뛰기|장대높이뛰기|멀리뛰기|세단뛰기|포환던지기|원반던지기|해머던지기|창던지기|5000mW|10kmW|20kmW|10종경기|7종경기)/.test(String(event.eventName || ""));
}

function ideaEventPriority(event) {
  const name = String(event.eventName || "");
  if (isRelayEventName(name)) return 1;
  if (/^(100m|200m|400m)$/.test(name)) return 2;
  if (/H$|3000mSC/.test(name)) return 3;
  if (/10종경기|7종경기/.test(name)) return 4;
  if (/높이뛰기|장대높이뛰기|멀리뛰기|세단뛰기/.test(name)) return 5;
  if (/800m|1500m|3000m|5000m|10000m/.test(name)) return 6;
  if (/포환|원반|해머|창/.test(name)) return 7;
  return 8;
}

function resultNumber(record) {
  const value = String(record || "").replace(/,/g, "").trim();
  if (!value) return null;
  if (value.includes(":")) {
    const parts = value.split(":").map((part) => Number.parseFloat(part));
    if (parts.some((part) => Number.isNaN(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

function recordDifference(rows) {
  const [first, second] = rows;
  if (!first || !second) return null;
  const firstValue = resultNumber(first.record);
  const secondValue = resultNumber(second.record);
  if (firstValue === null || secondValue === null) return null;
  return Math.abs(secondValue - firstValue);
}

function formatDifference(diff, eventName) {
  if (diff === null) return "";
  if (/m$|H$|3000mSC|5000m|10000m|W$|R/.test(eventName)) return `${diff.toFixed(2)}초`;
  if (/종경기/.test(eventName)) return `${Math.round(diff)}점`;
  return diff < 1 ? `${diff.toFixed(2)}` : `${diff.toFixed(2)}`;
}

function closeThreshold(eventName) {
  if (isRelayEventName(eventName)) return 0.15;
  if (/^(100m|200m)$/.test(eventName)) return 0.12;
  if (/^(400m|400mH)$/.test(eventName)) return 0.45;
  if (/800m|1500m|3000mSC/.test(eventName)) return 3;
  if (/3000m|5000m|10000m|W/.test(eventName)) return 8;
  if (/높이뛰기|장대높이뛰기|멀리뛰기|세단뛰기/.test(eventName)) return 0.08;
  if (/종경기/.test(eventName)) return 200;
  return 0.2;
}

function recordMarker(rows) {
  const markerText = rows
    .map((row) => `${row.record || ""} ${row.wind || ""} ${row.remark || ""}`)
    .join(" ");
  const marker = markerText.match(/한국신|한국기록|대회신|신기록|시즌베스트|개인최고|개인\s?최고|PB|SB|NR|MR|GR|WL/i);
  return marker ? marker[0] : "";
}

function ideaParamsFromEvent(event) {
  return {
    ...event.params,
    tournament_id: event.tournament_id
  };
}

function ideaRowName(row) {
  return row.name || row.team || "";
}

function makeIdea({ event, result, type, title, reason, format, score, chips }) {
  const rows = result.rows || [];
  return {
    id: `${type}-${event.id}`,
    type,
    title,
    reason,
    format,
    score,
    chips: chips.filter(Boolean),
    eventId: event.id,
    eventLabel: event.label,
    params: ideaParamsFromEvent(event),
    topRows: rows.slice(0, 3).map((row) => ({
      rank: row.rank,
      name: row.name || "",
      team: row.team || "",
      record: row.record || ""
    }))
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function getContentIdeas(searchParams) {
  const tournament = findTournament(searchParams.get("tournament_id") || searchParams.get("to_cd"));
  const events = (await getEvents(tournament))
    .filter(isContentIdeaEvent)
    .sort((a, b) => ideaEventPriority(a) - ideaEventPriority(b) || String(a.label).localeCompare(String(b.label), "ko"))
    .slice(0, 42);

  const eventResults = await mapWithConcurrency(events, 4, async (event) => {
    try {
      const params = new URLSearchParams(event.params);
      params.set("tournament_id", tournament.id);
      const result = await getResult(params);
      const rows = (result.rows || []).filter((row) => {
        const text = `${row.record || ""} ${row.remark || ""}`.toUpperCase();
        return row.rank && row.record && !/\b(DNS|DNF)\b|기권|실격/.test(text);
      });
      return rows.length ? { event, result: { ...result, rows } } : null;
    } catch {
      return null;
    }
  });

  const usable = eventResults.filter(Boolean);
  const winnerMap = new Map();
  for (const item of usable) {
    if (isRelayEventName(item.event.eventName)) continue;
    const winner = item.result.rows[0];
    const key = `${winner.name || ""}|${winner.team || ""}`;
    if (!winner.name || (winnerMap.has(key) && winnerMap.get(key).some((eventLabel) => eventLabel === item.event.label))) continue;
    const list = winnerMap.get(key) || [];
    list.push(item.event.label);
    winnerMap.set(key, list);
  }

  const ideas = [];
  for (const item of usable) {
    const { event, result } = item;
    const rows = result.rows;
    const top = rows[0];
    const second = rows[1];
    const eventName = event.eventName;
    const diff = recordDifference(rows);
    const diffText = formatDifference(diff, eventName);
    const marker = recordMarker(rows);
    const relay = isRelayEventName(eventName);
    const youth = /중학교|고등학교/.test(event.division);
    const sameTeamTop2 = top?.team && second?.team && top.team === second.team;
    const close = diff !== null && diff <= closeThreshold(eventName);
    const topName = ideaRowName(top);

    if (marker) {
      ideas.push(makeIdea({
        event,
        result,
        type: "기록 소식",
        title: `${topName}, ${eventName} ${marker}`,
        reason: `결과지 비고/기록에서 ${marker} 표시가 감지됐습니다. 기록형 콘텐츠로 먼저 올리기 좋습니다.`,
        format: "카드뉴스 1장 + 스토리 공유",
        score: 98,
        chips: [marker, event.division, top.record]
      }));
    }

    if (close && second) {
      ideas.push(makeIdea({
        event,
        result,
        type: "접전",
        title: diff === 0 ? `${eventName} ${event.division}, 같은 기록의 승부` : `${diffText} 차이, ${eventName} 승부`,
        reason: `${topName}와 ${ideaRowName(second)}의 차이가 ${diffText || "매우 작게"} 났습니다. 댓글 반응을 만들기 좋은 접전 포인트입니다.`,
        format: relay ? "릴스 후킹 + 결과 카드" : "결과 카드 + 스토리 투표",
        score: relay ? 92 : 88,
        chips: [event.division, top.record, second.record]
      }));
    }

    if (relay) {
      ideas.push(makeIdea({
        event,
        result,
        type: "릴레이",
        title: `${top.team}, ${eventName} 우승`,
        reason: `${top.name} 조합으로 팀 승부를 보여줄 수 있습니다. 릴레이는 선수 4명을 함께 조명하기 좋아요.`,
        format: "결과 카드 + 팀명 중심 캡션",
        score: close ? 86 : 78,
        chips: [top.team, event.division, top.record]
      }));
    }

    if (sameTeamTop2 && !relay) {
      ideas.push(makeIdea({
        event,
        result,
        type: "팀 장악",
        title: `${top.team}, ${eventName} 1-2위`,
        reason: `${top.name}와 ${second.name}가 같은 소속으로 1-2위를 차지했습니다. 팀 스토리로 묶기 좋습니다.`,
        format: "캐러셀 2장",
        score: 84,
        chips: [top.team, top.record, second.record]
      }));
    }

    if (youth) {
      ideas.push(makeIdea({
        event,
        result,
        type: "유망주",
        title: `${event.division} ${eventName}, ${topName} 우승`,
        reason: "중고등부 결과는 미래 선수 조명 콘텐츠로 반응이 좋습니다. 종목별 유망주 기록으로 저장 가치가 있습니다.",
        format: "선수 조명 카드",
        score: /높이뛰기|100m|200m|400m/.test(eventName) ? 75 : 67,
        chips: [event.division, top.record]
      }));
    }

    if (/3000mSC|W$|10kmW|20kmW|10종경기|7종경기|포환|원반|해머|창/.test(eventName)) {
      ideas.push(makeIdea({
        event,
        result,
        type: "종목 조명",
        title: `${eventName}, 오늘의 종목 조명`,
        reason: "단거리 외 종목은 설명형 카드로 만들면 육상인들이 저장하고 공유하기 좋습니다.",
        format: "설명형 카드뉴스",
        score: /3000mSC|10종경기|7종경기/.test(eventName) ? 76 : 65,
        chips: [event.division, topName, top.record]
      }));
    }
  }

  for (const [key, eventLabels] of winnerMap.entries()) {
    if (eventLabels.length < 2) continue;
    const [name, team] = key.split("|");
    const matching = usable.find((item) => item.result.rows[0]?.name === name && item.result.rows[0]?.team === team);
    if (!matching) continue;
    ideas.push(makeIdea({
      event: matching.event,
      result: matching.result,
      type: "다관왕",
      title: `${name}, ${eventLabels.length}관왕 후보`,
      reason: `${eventLabels.slice(0, 3).join(", ")}에서 우승했습니다. 대회 주인공 콘텐츠로 묶기 좋습니다.`,
      format: "캐러셀 표지 + 종목별 결과",
      score: 95,
      chips: [team, `${eventLabels.length}관왕`, ...eventLabels.slice(0, 2)]
    }));
  }

  const sortedIdeas = ideas.sort((a, b) => b.score - a.score);
  const deduped = [];
  const seen = new Set();
  const typeCounts = new Map();
  const addIdea = (idea, enforceTypeCap = true) => {
    const key = `${idea.type}|${idea.eventLabel}|${idea.title}`;
    if (seen.has(key)) return false;
    const typeCount = typeCounts.get(idea.type) || 0;
    if (enforceTypeCap && typeCount >= 3) return false;
    seen.add(key);
    typeCounts.set(idea.type, typeCount + 1);
    deduped.push(idea);
    return true;
  };

  for (const type of ["기록 소식", "다관왕", "접전", "릴레이", "팀 장악", "유망주", "종목 조명"]) {
    const idea = sortedIdeas.find((item) => item.type === type);
    if (idea) addIdea(idea, false);
    if (deduped.length >= 12) break;
  }

  for (const idea of sortedIdeas) {
    addIdea(idea, true);
    if (deduped.length >= 12) break;
  }

  if (deduped.length < 12) {
    for (const idea of sortedIdeas) {
      addIdea(idea, false);
      if (deduped.length >= 12) break;
    }
  }

  return {
    tournament,
    generatedAt: new Date().toISOString(),
    source: "공식 경기 결과",
    ideas: deduped
  };
}

function stripCdata(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function extractRssTag(block, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(block || "").match(re);
  return match ? cleanText(stripCdata(match[1])) : "";
}

function extractRssLink(block, sourceUrl) {
  const rssLink = extractRssTag(block, "link");
  const atomHref = String(block || "").match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || "";
  const rawLink = rssLink || atomHref || extractRssTag(block, "guid");
  try {
    return rawLink ? new URL(decodeEntities(rawLink), sourceUrl).href : "";
  } catch {
    return rawLink;
  }
}

function parseRssDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function publishedLabel(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function parseRssItems(xml, source) {
  const blocks = [
    ...String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/gi)
  ];

  return blocks.slice(0, 12).map((match, index) => {
    const block = match[0];
    const title = extractRssTag(block, "title");
    const description =
      extractRssTag(block, "description") ||
      extractRssTag(block, "summary") ||
      extractRssTag(block, "content:encoded");
    const timestamp =
      parseRssDate(extractRssTag(block, "pubDate")) ||
      parseRssDate(extractRssTag(block, "published")) ||
      parseRssDate(extractRssTag(block, "updated"));
    return {
      id: `${source.id}-${index}`,
      title,
      description,
      url: extractRssLink(block, source.url),
      publishedAt: timestamp,
      source
    };
  }).filter((item) => item.title && item.url);
}

async function fetchExternalText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 Korean Athletics Magazine content scout",
        "Accept": "application/rss+xml,application/xml,text/xml,text/html,*/*"
      }
    });
    if (!response.ok) {
      throw new Error(`source responded with ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function issueKeywordChips(text) {
  const chips = [];
  const checks = [
    ["신기록", /\b(world record|national record|area record|meet record|record-breaking)\b|신기록|한국신|세계신/i],
    ["시즌베스트", /\bworld lead|season best|sb\b|wl\b/i],
    ["신발/장비", /\bshoes?|running shoes?|track spikes?|spikes\b|super shoes?|nike|adidas|asics|puma|new balance|hoka|on running|brooks|saucony\b|신발|스파이크|러닝화/i],
    ["세계육상", /\bworld athletics|diamond league|world championships|continental tour|olympic|paris|tokyo\b|세계육상|다이아몬드리그|올림픽/i],
    ["마라톤", /\bmarathon|road race|half marathon|10k\b|마라톤/i],
    ["트랙", /\b100m|200m|400m|800m|1500m|5000m|10000m|hurdles|relay|steeplechase\b|허들|계주/i],
    ["필드", /\bhigh jump|long jump|pole vault|triple jump|shot put|discus|javelin|hammer\b|높이뛰기|멀리뛰기|장대높이뛰기|투척/i]
  ];
  for (const [label, re] of checks) {
    if (re.test(text)) chips.push(label);
  }
  return chips;
}

function isShoeIssue(text) {
  return /\bshoes?|running shoes?|track spikes?|spikes\b|super shoes?|nike|adidas|asics|puma|new balance|hoka|on running|brooks|saucony\b|신발|스파이크|러닝화/i.test(text);
}

function issueType(text, source) {
  if (isShoeIssue(text)) {
    return "신발/장비";
  }
  if (/\bworld record|national record|area record|meet record|record-breaking|world lead|season best|personal best|pb\b|sb\b|wl\b/i.test(text)) {
    return "기록 이슈";
  }
  if (/\bdiamond league|world championships|continental tour|olympic|championships|meeting|results?\b/i.test(text)) {
    return "해외 경기";
  }
  if (source.id === "world-athletics") {
    return "세계육상";
  }
  return "육상 소식";
}

function issueScore(item, type, chips) {
  const now = Date.now();
  const ageDays = item.publishedAt ? Math.max(0, (now - item.publishedAt) / 86400000) : 30;
  let score = 45;
  if (item.source.group === "공식") score += 14;
  if (item.source.group === "육상 매체") score += 9;
  if (ageDays <= 1) score += 22;
  else if (ageDays <= 3) score += 16;
  else if (ageDays <= 7) score += 10;
  else if (ageDays <= 14) score += 4;
  if (type === "기록 이슈") score += 24;
  if (type === "해외 경기") score += 18;
  if (type === "신발/장비") score += 16;
  if (type === "세계육상") score += 12;
  score += Math.min(12, chips.length * 3);
  return Math.min(99, score);
}

function issueFormat(type) {
  if (type === "신발/장비") return "장비 소개 카드 + 스토리 투표";
  if (type === "기록 이슈") return "뉴스 카드 + 기록 비교";
  if (type === "해외 경기") return "릴스 후킹 + 결과 요약";
  if (type === "세계육상") return "뉴스 카드 + 원문 링크";
  return "스토리 공유 + 짧은 캡션";
}

function issueReason(item, type) {
  const sourceName = item.source.name;
  if (type === "신발/장비") {
    return `${sourceName}에 올라온 신발/장비 관련 소식입니다. 육상인들이 댓글로 의견을 남기기 좋아 장비형 콘텐츠 후보로 적합합니다.`;
  }
  if (type === "기록 이슈") {
    return `${sourceName}에서 기록 관련 신호가 감지됐습니다. 기록 비교 카드나 '얼마나 빠른 기록인가' 형식으로 풀기 좋습니다.`;
  }
  if (type === "해외 경기") {
    return `${sourceName}의 해외 경기 소식입니다. 한국육상매거진 팔로워에게 세계 흐름을 짧게 소개하기 좋습니다.`;
  }
  if (type === "세계육상") {
    return `World Athletics 공식 소식입니다. 공식 출처 기반이라 신뢰도 높은 뉴스 카드로 활용하기 좋습니다.`;
  }
  return `${sourceName}에 올라온 육상 관련 이슈입니다. 반응을 보며 스토리 또는 짧은 게시물로 확장할 수 있습니다.`;
}

function makeIssueIdea(item) {
  const text = `${item.title} ${item.description}`;
  const chips = issueKeywordChips(text);
  const type = issueType(text, item.source);
  return {
    id: item.id,
    type,
    title: item.title,
    reason: issueReason(item, type),
    format: issueFormat(type),
    score: issueScore(item, type, chips),
    chips: [item.source.group, ...chips].filter(Boolean),
    sourceName: item.source.name,
    publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : "",
    publishedLabel: publishedLabel(item.publishedAt),
    url: item.url
  };
}

async function getIssueIdeas() {
  if (issueCache.payload && Date.now() - issueCache.generatedAt < ISSUE_CACHE_MS) {
    return {
      ...issueCache.payload,
      cached: true
    };
  }

  const sourceResults = await mapWithConcurrency(ISSUE_SOURCES, 3, async (source) => {
    try {
      const xml = await fetchExternalText(source.url);
      return {
        source,
        items: parseRssItems(xml, source),
        error: ""
      };
    } catch (error) {
      return {
        source,
        items: [],
        error: error.message
      };
    }
  });

  const rawItems = sourceResults.flatMap((result) => result.items);
  const seen = new Set();
  const ideas = rawItems
    .map(makeIssueIdea)
    .filter((idea) => {
      const key = `${idea.url || ""}|${cleanText(idea.title).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 12);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "공식/육상 매체 RSS",
    sources: sourceResults.map((result) => ({
      id: result.source.id,
      name: result.source.name,
      group: result.source.group,
      count: result.items.length,
      error: result.error
    })),
    sourcesUsed: sourceResults.filter((result) => result.items.length).length,
    ideas
  };

  issueCache.generatedAt = Date.now();
  issueCache.payload = payload;
  return payload;
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

    if (pathname === "/api/content-ideas") {
      const ideas = await getContentIdeas(searchParams);
      return sendJson(res, 200, ideas);
    }

    if (pathname === "/api/issue-ideas") {
      const ideas = await getIssueIdeas();
      return sendJson(res, 200, ideas);
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
