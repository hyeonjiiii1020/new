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
  },
  {
    id: "ktfl-30",
    source: "pace",
    name: "제30회 KTFL 전국실업육상경기선수권대회",
    period: "2026-05-26 ~ 2026-05-28",
    place: "해남군",
    comp_id: "35"
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

function paceGenderDivision(gender) {
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
      const division = paceGenderDivision(event.gender);
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
  if (event?.round_type === "final") return `${heat.heat_number || ""}조`.trim();
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
    rows.push(...rankPaceRows(heatRows));
  }

  return rows;
}

function parsePaceFieldDistanceRows(data) {
  const rows = [];
  const heatCount = data.heats?.length || 0;

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

  return rows.map(({ sortValue, ...row }) => row);
}

function parsePaceFieldHeightRows(data) {
  const rows = [];
  const heatCount = data.heats?.length || 0;

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

  return rows;
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Mozilla/5.0 KAAF KTFL result card maker",
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

  const url = `${RESULT_ORIGIN}/tourInfo/resultInfo.do?reg_year=${tournament.reg_year}&to_cd=${tournament.to_cd}&gubun=${tournament.gubun}&domestic=${tournament.domestic}&resultType=${tournament.resultType}&kind_cd=&tabs_id=${tournament.tabs_id}`;
  const html = await fetchText(url);
  const events = parseEventList(html, tournament);
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

async function getPaceResult(searchParams, tournament) {
  const eventId = searchParams.get("event_id");
  if (!eventId) {
    throw new Error("KTFL event_id is missing");
  }

  const data = await fetchJson(`${PACE_ORIGIN}/api/events/${eventId}/live-results`);
  const rows = await parsePaceResult(data);
  const event = data.event || {};
  const meta = {
    tournament: tournament.name,
    period: tournament.period,
    place: tournament.place,
    eventName: event.name || "",
    division: paceGenderDivision(event.gender),
    round: paceRoundLabel(event.round_type),
    date: tournament.period,
    fetchedAt: new Date().toISOString()
  };

  return { tournament, meta, rows };
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
