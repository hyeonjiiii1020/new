const ROWS_PER_PAGE = 8;
const SCHEDULE_ROWS_PER_PAGE = 14;
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const API_BASE = window.location.protocol === "file:" ? "http://localhost:5173" : "";

const state = {
  mode: "result",
  tournaments: [],
  selectedTournament: null,
  events: [],
  filteredEvents: [],
  selectedEvent: null,
  result: null,
  pages: [],
  currentPage: 0,
  manualTitle: false,
  manualSubtitle: false,
  design: "press",
  schedule: {
    sourceCanvas: null,
    images: [],
    rows: [],
    pages: []
  }
};

const $ = (selector) => document.querySelector(selector);

const els = {
  resultModeBtn: $("#resultModeBtn"),
  scheduleModeBtn: $("#scheduleModeBtn"),
  resultControls: $("#resultControls"),
  scheduleControls: $("#scheduleControls"),
  tournamentSelect: $("#tournamentSelect"),
  eventSelect: $("#eventSelect"),
  eventSearch: $("#eventSearch"),
  refreshBtn: $("#refreshBtn"),
  loadBtn: $("#loadBtn"),
  titleInput: $("#titleInput"),
  subtitleInput: $("#subtitleInput"),
  groupByHeat: $("#groupByHeat"),
  hideNonFinishers: $("#hideNonFinishers"),
  statusText: $("#statusText"),
  rowCount: $("#rowCount"),
  pageInfo: $("#pageInfo"),
  prevPage: $("#prevPage"),
  nextPage: $("#nextPage"),
  downloadCurrent: $("#downloadCurrent"),
  downloadAll: $("#downloadAll"),
  designSelect: $("#designSelect"),
  cardTitle: $("#cardTitle"),
  cardSubtitle: $("#cardSubtitle"),
  recordHeader: $("#recordHeader"),
  cardRows: $("#cardRows"),
  cardPreview: $("#cardPreview"),
  scheduleTitleInput: $("#scheduleTitleInput"),
  scheduleSourceMode: $("#scheduleSourceMode"),
  schedulePhotoInput: $("#schedulePhotoInput"),
  scheduleDayInput: $("#scheduleDayInput"),
  scheduleDateInput: $("#scheduleDateInput"),
  scheduleTrackInput: $("#scheduleTrackInput"),
  scheduleFieldInput: $("#scheduleFieldInput"),
  scheduleCoverInput: $("#scheduleCoverInput"),
  buildScheduleBtn: $("#buildScheduleBtn"),
  schedulePreview: $("#schedulePreview"),
  schedulePreviewImage: $("#schedulePreviewImage")
};

const SCHEDULE_SECTION_LABELS = ["트랙 경기", "필드 경기"];

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

const sampleRows = [
  { rank: "1", name: "김주하", team: "시흥시청", record: "11.66", wind: "2.1", heat: "" },
  { rank: "2", name: "서지현", team: "진천군청", record: "11.81", wind: "2.1", heat: "" },
  { rank: "3", name: "유정미", team: "안동시청", record: "11.90", wind: "2.1", heat: "" },
  { rank: "4", name: "김소은", team: "가평군청", record: "12.02", wind: "2.1", heat: "" }
];

const scheduleBody = {
  x: 64,
  y: 132,
  width: 952,
  height: 1148
};

const CARD_THEMES = {
  press: {
    label: "프레스 블랙",
    bg: "#f8f7f1",
    paper: "#ffffff",
    ink: "#111111",
    muted: "#555555",
    line: "#151515",
    softLine: "#d8d4c8",
    header: "#111111",
    headerText: "#ffffff",
    rowAlt: "#f5f3ea",
    shadow: "rgba(20, 20, 20, 0.10)",
    medal1: "#f4f1df",
    medal2: "#eeeeec",
    medal3: "#f0e2d4",
    accent: "#111111",
    accent2: "#111111"
  },
  slate: {
    label: "슬레이트",
    bg: "#eef1f4",
    paper: "#ffffff",
    ink: "#242a31",
    muted: "#626b75",
    line: "#c9d0d7",
    softLine: "#e4e8ec",
    header: "#2c333a",
    headerText: "#ffffff",
    rowAlt: "#f6f8fa",
    shadow: "rgba(25, 35, 45, 0.12)",
    medal1: "#f5edcf",
    medal2: "#edf0f2",
    medal3: "#f1dfd1",
    accent: "#2c333a",
    accent2: "#8b949e"
  },
  navy: {
    label: "네이비 클래식",
    bg: "#fbfcfd",
    paper: "#ffffff",
    ink: "#101419",
    muted: "#557c8c",
    line: "#dfe4ea",
    softLine: "#e7ebef",
    header: "#062764",
    headerText: "#ffffff",
    rowAlt: "#f8fafc",
    shadow: "rgba(12, 25, 42, 0.11)",
    medal1: "#fff4bd",
    medal2: "#eef1f5",
    medal3: "#f2decc",
    accent: "#062764",
    accent2: "#1f9d9a"
  },
  line: {
    label: "라인 미니멀",
    bg: "#ffffff",
    paper: "#ffffff",
    ink: "#111111",
    muted: "#666666",
    line: "#111111",
    softLine: "#dedede",
    header: "#111111",
    headerText: "#ffffff",
    rowAlt: "#fafafa",
    shadow: "rgba(0, 0, 0, 0.05)",
    medal1: "#f7f4e6",
    medal2: "#f1f1f1",
    medal3: "#f2e5da",
    accent: "#111111",
    accent2: "#111111"
  }
};

function setStatus(message) {
  els.statusText.textContent = message;
}

function setResultStatus(message) {
  if (state.mode === "result") {
    setStatus(message);
  }
}

function currentTheme() {
  const key = els.designSelect?.value || state.design || "press";
  return CARD_THEMES[key] || CARD_THEMES.press;
}

function applyDesignToPreview() {
  state.design = els.designSelect?.value || state.design || "press";
  els.cardPreview.dataset.design = state.design;
  els.schedulePreview.dataset.design = state.design;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rankText(rank) {
  const text = normalize(rank);
  return /^\d+$/.test(text) ? `${text}위` : text;
}

function windText(wind) {
  const text = normalize(wind);
  if (!text) return "";
  if (/^[0-9.]+$/.test(text)) return `+${text}`;
  return text;
}

function recordText(row) {
  return normalize(row.record);
}

function isFinalEvent() {
  const round = normalize(state.selectedEvent?.round || state.result?.meta?.round || "");
  return round.includes("결승");
}

function isCombinedOverallEvent() {
  const eventName = normalize(state.result?.meta?.eventName || state.selectedEvent?.eventName || "");
  return /(?:10|8|7)\s*종\s*경기/.test(eventName);
}

function isRelayEventName(name) {
  const text = normalize(name)
    .replace(/×/g, "x")
    .replace(/\s+/g, "")
    .toLowerCase();
  return /\d+x\d+(?:m)?r/.test(text) || text.includes("계주") || text.includes("relay");
}

function isRelayEvent() {
  const eventName = normalize(state.result?.meta?.eventName || state.selectedEvent?.eventName || "");
  return isRelayEventName(eventName);
}

function resultHeaders() {
  if (isRelayEvent()) return ["순위", "소속", "성명", "기록"];
  return ["순위", "성명", "소속", isCombinedOverallEvent() ? "총점" : "기록"];
}

function resultValues(row) {
  if (isRelayEvent()) {
    return [rankText(row.rank), row.team, row.name, recordText(row)];
  }
  return [rankText(row.rank), row.name, row.team, recordText(row)];
}

function resultColumnWidths() {
  return isRelayEvent() ? [118, 292, 382, 168] : [118, 178, 432, 232];
}

function isHigherRecordBetter() {
  const eventName = normalize(state.result?.meta?.eventName || state.selectedEvent?.eventName || "");
  const fieldEvents = [
    "높이뛰기",
    "장대높이뛰기",
    "멀리뛰기",
    "세단뛰기",
    "포환던지기",
    "원반던지기",
    "해머던지기",
    "창던지기",
    "투포환"
  ];
  if (fieldEvents.some((event) => eventName.includes(event))) return true;
  return /^(10종|7종|5종)/.test(eventName) && !eventName.includes("(");
}

function recordValue(record) {
  const value = normalize(record).replace(/,/g, "");
  if (!value) return null;
  if (value.includes(":")) {
    const parts = value.split(":").map((part) => Number.parseFloat(part));
    if (parts.some((part) => Number.isNaN(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

function rerankFinalRows(rows) {
  const higherBetter = isHigherRecordBetter();
  const sortedRows = rows
    .map((row, index) => ({ ...row, originalIndex: index, recordSortValue: recordValue(row.record) }))
    .sort((a, b) => {
      const aValue = a.recordSortValue;
      const bValue = b.recordSortValue;
      if (aValue == null && bValue == null) return a.originalIndex - b.originalIndex;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (aValue === bValue) return a.originalIndex - b.originalIndex;
      return higherBetter ? bValue - aValue : aValue - bValue;
    });

  let previousValue = null;
  let previousRank = 0;
  return sortedRows.map((row, index) => {
    const rank = row.recordSortValue === previousValue ? previousRank : index + 1;
    previousValue = row.recordSortValue;
    previousRank = rank;
    const { originalIndex, recordSortValue, ...cleanRow } = row;
    return { ...cleanRow, rank: String(rank), heat: "" };
  });
}

function filenameSafe(value) {
  return normalize(value)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function setMode(mode) {
  state.mode = mode;
  els.resultModeBtn.classList.toggle("active", mode === "result");
  els.scheduleModeBtn.classList.toggle("active", mode === "schedule");
  els.resultControls.classList.toggle("hidden", mode !== "result");
  els.scheduleControls.classList.toggle("hidden", mode !== "schedule");
  els.cardPreview.classList.toggle("hidden", mode !== "result");
  els.schedulePreview.classList.toggle("hidden", mode !== "schedule");

  if (mode === "result") {
    renderCard();
  } else {
    if (!state.schedule.pages.length) {
      setStatus("시간표 사진을 선택하거나 시간표 내용을 입력해주세요.");
    }
    renderScheduleCard();
  }
}

function activeSchedulePage() {
  return state.schedule.pages[state.currentPage] || null;
}

function eventMatches(event, query) {
  if (!query) return true;
  const relayTokens = isRelayEventName(event.eventName) ? " 계주 릴레이 relay" : "";
  const haystack = `${event.eventName} ${event.division} ${event.round} ${event.status}${relayTokens}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function renderTournamentOptions() {
  els.tournamentSelect.innerHTML = "";
  for (const tournament of state.tournaments) {
    const option = document.createElement("option");
    option.value = tournament.id;
    option.textContent = tournament.name;
    els.tournamentSelect.append(option);
  }

  if (state.selectedTournament) {
    els.tournamentSelect.value = state.selectedTournament.id;
  }
}

function renderEventOptions() {
  const query = normalize(els.eventSearch.value);
  state.filteredEvents = state.events.filter((event) => eventMatches(event, query));

  els.eventSelect.innerHTML = "";
  if (!state.filteredEvents.length) {
    const option = document.createElement("option");
    option.textContent = "검색 결과 없음";
    option.value = "";
    els.eventSelect.append(option);
    return;
  }

  for (const event of state.filteredEvents) {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = `${event.label} · ${event.status}`;
    els.eventSelect.append(option);
  }

  const selectedStillVisible = state.selectedEvent && state.filteredEvents.some((event) => event.id === state.selectedEvent.id);
  if (selectedStillVisible) {
    els.eventSelect.value = state.selectedEvent.id;
  } else {
    state.selectedEvent = state.filteredEvents[0];
    els.eventSelect.value = state.selectedEvent.id;
  }
}

async function loadTournaments() {
  setBusy(true);
  setResultStatus("대회 목록을 불러오는 중입니다.");

  try {
    const response = await fetch(apiUrl("/api/tournaments"));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "대회 목록 요청 실패");

    state.tournaments = payload.tournaments || [];
    state.selectedTournament =
      state.tournaments.find((tournament) => tournament.id === payload.defaultTournament) ||
      state.tournaments[0] ||
      null;
    renderTournamentOptions();

    if (state.selectedTournament) {
      await loadEvents();
    } else {
      renderSample("불러올 수 있는 대회가 없습니다.");
    }
  } catch (error) {
    console.error(error);
    renderSample("대회 목록을 불러오지 못했습니다. 서버가 켜져 있는지 확인해주세요.");
  } finally {
    setBusy(false);
  }
}

async function loadEvents() {
  if (!state.selectedTournament) return;

  setBusy(true);
  setResultStatus(`${state.selectedTournament.name} 경기 목록을 불러오는 중입니다.`);

  try {
    const response = await fetch(apiUrl(`/api/events?tournament_id=${encodeURIComponent(state.selectedTournament.id)}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "목록 요청 실패");

    state.events = payload.events || [];
    const preferred =
      state.events.find((event) => event.round === "결승" && /완료|순위/.test(event.status)) ||
      state.events.find((event) => event.round === "결승") ||
      state.events.find((event) => event.status.includes("완료")) ||
      state.events[0] ||
      null;
    state.selectedEvent = preferred;
    renderEventOptions();

    if (state.selectedEvent) {
      await loadSelectedResult();
    } else {
      state.result = {
        meta: {
          tournament: state.selectedTournament.name,
          place: state.selectedTournament.place,
          eventName: "",
          division: "",
          round: "",
          date: ""
        },
        rows: []
      };
      applyDefaultText(true);
      buildPages();
      renderCard();
      setResultStatus(`${state.selectedTournament.name}에서 불러올 수 있는 실시간 경기가 없습니다.`);
    }
  } catch (error) {
    console.error(error);
    state.events = [];
    renderSample("연맹 연결 실패. 샘플 카드로 화면을 열었습니다.");
  } finally {
    setBusy(false);
  }
}

async function loadSelectedResult() {
  const selected = state.filteredEvents.find((event) => event.id === els.eventSelect.value) || state.selectedEvent;
  if (!selected) return;

  state.selectedEvent = selected;
  setBusy(true);
  setResultStatus(`${state.selectedTournament?.name || "선택 대회"} · ${selected.label} 결과를 불러오는 중입니다.`);

  const params = new URLSearchParams(selected.params);
  params.set("tournament_id", state.selectedTournament?.id || selected.tournament_id || "");
  try {
    const response = await fetch(apiUrl(`/api/result?${params.toString()}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "결과 요청 실패");

    state.result = payload;
    applyDefaultText();
    buildPages();
    renderCard();
    setResultStatus(`${payload.tournament?.name || state.selectedTournament?.name || ""} · ${selected.label} 결과를 불러왔습니다.`);
  } catch (error) {
    console.error(error);
    state.result = {
      tournament: state.selectedTournament,
      meta: {
        tournament: state.selectedTournament?.name || "",
        place: state.selectedTournament?.place || "",
        eventName: selected.eventName || "",
        division: selected.division || "",
        round: selected.round || "",
        date: state.selectedTournament?.period || ""
      },
      rows: []
    };
    applyDefaultText(true);
    buildPages();
    renderCard();
    setResultStatus(`결과를 불러오지 못했습니다. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function renderSample(message) {
  state.result = {
    meta: {
      tournament: "2026 밀양아리랑 전국육상경기대회",
      place: "밀양",
      eventName: "100m",
      division: "여자부",
      round: "결승",
      date: "2026-06-05"
    },
    rows: sampleRows
  };
  applyDefaultText(true);
  buildPages();
  renderCard();
  setResultStatus(message);
}

function applyDefaultText(force = false) {
  const meta = state.result?.meta || {};
  const round = state.selectedEvent?.round || meta.round || "";
  const baseTitle = `${meta.eventName || ""} ${meta.division || ""} ${round}`.replace(/\s+/g, " ").trim();
  const subtitleParts = [meta.tournament, meta.place, meta.date].filter(Boolean);
  const subtitle = subtitleParts.join(" · ");

  if (force || !state.manualTitle) {
    els.titleInput.value = baseTitle ? `🏃 ${baseTitle}` : "🏃 경기 결과";
    state.manualTitle = false;
  }

  if (force || !state.manualSubtitle) {
    els.subtitleInput.value = subtitle || "2026 밀양아리랑 전국육상경기대회";
    state.manualSubtitle = false;
  }
}

function filteredRows() {
  const rows = state.result?.rows || [];
  if (!els.hideNonFinishers.checked) return rows;

  return rows.filter((row) => {
    const text = `${row.record || ""} ${row.remark || ""}`.toUpperCase();
    return !/\b(DNS|DNF)\b/.test(text) && row.rank && row.record;
  });
}

function displayRows() {
  const rows = filteredRows();
  const heatNames = [...new Set(rows.map((row) => normalize(row.heat)).filter(Boolean))];
  return isFinalEvent() && heatNames.length > 1 ? rerankFinalRows(rows) : rows;
}

function buildPages() {
  const rows = displayRows();
  const heatNames = [...new Set(rows.map((row) => normalize(row.heat)).filter(Boolean))];
  const grouped = !isFinalEvent() && els.groupByHeat.checked && heatNames.length > 1;
  const buckets = [];

  if (grouped) {
    for (const heat of heatNames) {
      buckets.push({ heat, rows: rows.filter((row) => normalize(row.heat) === heat) });
    }
  } else {
    buckets.push({ heat: "", rows });
  }

  state.pages = [];
  for (const bucket of buckets) {
    for (let index = 0; index < bucket.rows.length; index += ROWS_PER_PAGE) {
      state.pages.push({
        heat: bucket.heat,
        rows: bucket.rows.slice(index, index + ROWS_PER_PAGE)
      });
    }
  }

  if (!state.pages.length) {
    state.pages.push({ heat: "", rows: [] });
  }

  state.currentPage = Math.min(state.currentPage, state.pages.length - 1);
  if (state.mode === "result") {
    els.rowCount.textContent = `${rows.length}명`;
  }
}

function pageTitle(page = currentPage()) {
  const title = normalize(els.titleInput.value) || "경기 결과";
  return page?.heat ? `${title} ${page.heat}` : title;
}

function resultTitleParts(page = currentPage()) {
  const title = normalize(els.titleInput.value) || "경기 결과";
  const meta = state.result?.meta || {};
  const eventName = normalize(meta.eventName || state.selectedEvent?.eventName || "");
  const division = normalize(meta.division || state.selectedEvent?.division || "");
  const round = normalize(state.selectedEvent?.round || meta.round || "");
  const heat = normalize(page?.heat || "");
  const detail = [division, round, heat].filter(Boolean).join(" ");

  if (!state.manualTitle && eventName) {
    return {
      main: `🏃 ${eventName}`,
      detail
    };
  }

  const plainTitle = title.replace(/^🏃\s*/, "");
  if (eventName && plainTitle.startsWith(eventName)) {
    const prefix = title.startsWith("🏃") ? "🏃 " : "";
    const rest = normalize(`${plainTitle.slice(eventName.length)} ${heat}`);
    return {
      main: `${prefix}${eventName}`,
      detail: rest
    };
  }

  return {
    main: page?.heat ? `${title} ${page.heat}` : title,
    detail: ""
  };
}

function currentPage() {
  return state.pages[state.currentPage] || { heat: "", rows: [] };
}

function renderCard() {
  applyDesignToPreview();
  const page = currentPage();
  const titleParts = resultTitleParts(page);
  const headers = resultHeaders();
  els.cardTitle.innerHTML = "";
  const titleMain = document.createElement("span");
  titleMain.className = "title-main";
  titleMain.textContent = titleParts.main;
  els.cardTitle.append(titleMain);
  if (titleParts.detail) {
    const titleDetail = document.createElement("span");
    titleDetail.className = "title-detail";
    titleDetail.textContent = titleParts.detail;
    els.cardTitle.append(titleDetail);
  }
  els.cardSubtitle.textContent = normalize(els.subtitleInput.value);
  els.cardPreview.classList.toggle("relay-result", isRelayEvent());
  els.cardPreview.classList.toggle("full-page-result", page.rows.length >= ROWS_PER_PAGE);
  els.cardPreview.querySelectorAll(".result-table thead th").forEach((cell, index) => {
    cell.textContent = headers[index] || "";
  });
  els.recordHeader.textContent = headers[3] || "기록";
  els.cardRows.innerHTML = "";

  if (!page.rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 4;
    cell.textContent = "표시할 결과가 없습니다.";
    row.append(cell);
    els.cardRows.append(row);
  } else {
    page.rows.forEach((resultRow) => {
      const tr = document.createElement("tr");
      if (/^\d+$/.test(resultRow.rank) && Number(resultRow.rank) <= 3) {
        tr.className = `medal-${resultRow.rank}`;
      }

      resultValues(resultRow).forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (isRelayEvent() && index === 2) {
          const length = normalize(value).length;
          td.style.fontSize = length >= 19 ? "12px" : length >= 15 ? "13px" : "14px";
        }
        tr.append(td);
      });
      els.cardRows.append(tr);
    });
  }

  if (state.mode === "result") {
    els.rowCount.textContent = `${displayRows().length}명`;
    els.pageInfo.textContent = `${state.currentPage + 1} / ${state.pages.length}`;
    els.prevPage.disabled = state.currentPage === 0;
    els.nextPage.disabled = state.currentPage >= state.pages.length - 1;
    els.downloadCurrent.disabled = !page.rows.length;
    els.downloadAll.disabled = !state.pages.some((item) => item.rows.length);
  }
}

function setBusy(isBusy) {
  els.refreshBtn.disabled = isBusy;
  els.loadBtn.disabled = isBusy;
}

function setScheduleBusy(isBusy) {
  els.buildScheduleBtn.disabled = isBusy;
  els.scheduleSourceMode.disabled = isBusy;
  els.schedulePhotoInput.disabled = isBusy;
  els.scheduleDayInput.disabled = isBusy;
  els.scheduleDateInput.disabled = isBusy;
  els.scheduleTrackInput.disabled = isBusy;
  els.scheduleFieldInput.disabled = isBusy;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawFitText(ctx, text, x, y, maxWidth, options = {}) {
  const {
    align = "left",
    size = 42,
    weight = 800,
    color = "#101010",
    minSize = 26,
    baseline = "middle"
  } = options;
  let fontSize = size;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;

  do {
    ctx.font = `${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || fontSize <= minSize) break;
    fontSize -= 2;
  } while (fontSize >= minSize);

  ctx.fillText(text, x, y, maxWidth);
}

function drawCenteredMultiline(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
  const words = [...String(text || "")];
  const lines = [];
  let current = "";

  ctx.font = `${options.weight || 900} ${options.size || 66}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;

  for (const char of words) {
    const candidate = current + char;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.slice(0, 2).forEach((line, index) => {
    drawFitText(ctx, line, x, startY + index * lineHeight, maxWidth, {
      ...options,
      align: "center",
      baseline: "middle"
    });
  });
}

function drawResultHeader(ctx, page) {
  const theme = currentTheme();
  const titleParts = resultTitleParts(page);
  const hasDetail = Boolean(titleParts.detail);

  drawCenteredMultiline(ctx, titleParts.main, CARD_WIDTH / 2, hasDetail ? 112 : 124, 900, 70, {
    size: hasDetail ? 74 : 68,
    weight: 950,
    color: theme.accent,
    minSize: hasDetail ? 46 : 44
  });

  if (hasDetail) {
    drawFitText(ctx, titleParts.detail, CARD_WIDTH / 2, 184, 820, {
      align: "center",
      size: 38,
      weight: 850,
      color: theme.ink,
      minSize: 26
    });
  }

  drawCenteredMultiline(ctx, normalize(els.subtitleInput.value), CARD_WIDTH / 2, hasDetail ? 242 : 222, 820, 38, {
    size: 32,
    weight: 700,
    color: theme.muted,
    minSize: 23
  });

  return {
    tableY: hasDetail ? 322 : 306
  };
}

function drawCardChrome(ctx, label) {
  const theme = currentTheme();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = theme.paper;
  ctx.fillRect(32, 32, CARD_WIDTH - 64, CARD_HEIGHT - 64);

  ctx.fillStyle = theme.accent;
  ctx.fillRect(60, 58, 172, 10);
  ctx.fillStyle = theme.accent2;
  ctx.fillRect(244, 58, 78, 10);

  drawFitText(ctx, label, CARD_WIDTH - 60, 64, 360, {
    align: "right",
    size: 22,
    weight: 850,
    color: theme.muted,
    minSize: 18
  });

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
}

function drawTableShell(ctx, x, y, width, height) {
  const theme = currentTheme();
  ctx.save();
  ctx.shadowColor = theme.shadow;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = theme.paper;
  roundedRect(ctx, x, y, width, height, 8);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.5;
  roundedRect(ctx, x, y, width, height, 8);
  ctx.stroke();
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

function canvasFromImage(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 2600 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function trimScheduleCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const step = Math.max(2, Math.floor(Math.max(width, height) / 700));
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const lightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const contrast = Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]);
      if (lightness < 238 || contrast > 28) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX >= maxX || minY >= maxY) {
    return canvas;
  }

  const pad = Math.round(Math.max(width, height) * 0.028);
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(width - sx, maxX - minX + pad * 2);
  const sh = Math.min(height - sy, maxY - minY + pad * 2);
  const output = document.createElement("canvas");
  output.width = sw;
  output.height = sh;
  output.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return output;
}

function enhanceScheduleCanvas(canvas) {
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  const ctx = output.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0);

  const image = ctx.getImageData(0, 0, output.width, output.height);
  const { data } = image;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const lightness = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrast = Math.max(red, green, blue) - Math.min(red, green, blue);

    if (lightness < 168 || (lightness < 214 && contrast > 18)) {
      data[index] = 18;
      data[index + 1] = 18;
      data[index + 2] = 18;
    } else if (lightness > 232 && contrast < 20) {
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
    } else {
      const value = Math.max(0, Math.min(255, (lightness - 145) * 1.9));
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
    data[index + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return output;
}

function fitContain(sourceWidth, sourceHeight, box) {
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height
  };
}

function selectedSchedulePhotoFiles() {
  return [...(els.schedulePhotoInput.files || [])].filter((file) =>
    file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(file.name)
  );
}

function scheduleRowScores(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const sampleX = Math.max(3, Math.floor(width / 260));
  const scores = new Uint16Array(height);

  for (let y = 0; y < height; y += 1) {
    let score = 0;
    for (let x = 0; x < width; x += sampleX) {
      const index = (y * width + x) * 4;
      const lightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      if (lightness < 170) {
        score += 1;
      }
    }
    scores[y] = score;
  }

  return scores;
}

function bestScheduleCut(scores, target, min, max) {
  let best = target;
  let bestScore = Number.POSITIVE_INFINITY;
  const start = Math.max(1, min);
  const end = Math.min(scores.length - 2, max);

  for (let y = start; y <= end; y += 1) {
    let score = 0;
    for (let offset = -4; offset <= 4; offset += 1) {
      score += scores[y + offset] || 0;
    }
    const weighted = score + Math.abs(y - target) * 0.04;
    if (weighted < bestScore) {
      best = y;
      bestScore = weighted;
    }
  }

  return best;
}

function cleanScheduleCell(value) {
  return normalize(value)
    .replace(/[“”〃]/g, '"')
    .replace(/[｜│]/g, "|")
    .replace(/\s*\|\s*/g, "|")
    .replace(/^[-–—,.:;|]+/, "")
    .replace(/[-–—,.:;|]+$/, "")
    .trim();
}

function isDitto(value) {
  const text = cleanScheduleCell(value);
  return !text || /^["']+$/.test(text);
}

function normalizeScheduleText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/[｜│]/g, "|")
    .replace(/[“”〃]/g, '"')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Oo](?=\d:\d{2})/g, "0")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseScheduleLine(line, section, carry) {
  const cleanLine = normalizeScheduleText(line);
  const timeMatch = cleanLine.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!timeMatch) return null;

  const time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  let rest = cleanLine.slice(timeMatch.index + timeMatch[0].length).trim();
  rest = rest.replace(/^[-–—|,.:;]+/, "").trim();
  let cells = rest.split(/\s*\|\s*|\t+|\s{2,}/).map(cleanScheduleCell).filter(Boolean);

  let eventName = cells[0] || "";
  let division = cells[1] || "";
  let round = cells[2] || "";

  if (cells.length < 3) {
    const compact = cleanScheduleCell(rest);
    const roundMatch = compact.match(/\s(결승|준결승|예선|\d+\s*조(?:\(\d+\))?|\d+\s*종(?:\(\d+\))?|\d+\s*-\s*\d+\s*\+\s*\d+)\s*$/);
    round = roundMatch ? cleanScheduleCell(roundMatch[1]) : "";
    const beforeRound = roundMatch ? compact.slice(0, roundMatch.index).trim() : compact;
    const divisionMatch = beforeRound.match(/^(.+?)\s+((?:대학|실업|중학|고등|초등|일반|대학부|실업부|남|여|혼성|Mixed)[^|]*)$/i);

    if (divisionMatch) {
      eventName = cleanScheduleCell(divisionMatch[1]);
      division = cleanScheduleCell(divisionMatch[2]);
    } else {
      const parts = beforeRound.split(/\s+/).map(cleanScheduleCell).filter(Boolean);
      eventName = parts[0] || beforeRound;
      division = parts.slice(1).join(" ");
    }
  }

  if (isDitto(eventName)) eventName = carry.eventName;
  if (isDitto(division)) division = carry.division;
  if (isDitto(round)) round = carry.round;

  if (!eventName && !division && !round) return null;

  const row = {
    section,
    time,
    eventName: eventName || carry.eventName,
    division: division || carry.division,
    round: round || carry.round
  };

  carry.eventName = row.eventName;
  carry.division = row.division;
  carry.round = row.round;
  return row;
}

function parseScheduleText(value) {
  const text = normalizeScheduleText(value);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = [];
  let section = "트랙경기";
  const carryBySection = {
    "트랙경기": { eventName: "", division: "", round: "" },
    "필드경기": { eventName: "", division: "", round: "" }
  };

  for (const line of lines) {
    if (/트\s*랙/.test(line)) {
      section = "트랙경기";
      continue;
    }
    if (/필\s*드/.test(line)) {
      section = "필드경기";
      continue;
    }
    if (/경기시간표|시\s*간\s*표|시간\s+종목|종\s*목|부\s*별|라운드/.test(line) && !/\d{1,2}\s*:\s*\d{2}/.test(line)) {
      continue;
    }

    const row = parseScheduleLine(line, section, carryBySection[section]);
    if (row) rows.push(row);
  }

  return rows;
}

function buildSchedulePagesFromRows(rows) {
  const pages = [];
  if (els.scheduleCoverInput.checked) {
    pages.push({ type: "cover" });
  }

  const orderedSections = [...new Set(rows.map((row) => row.section))];
  for (const section of orderedSections) {
    const sectionRows = rows.filter((row) => row.section === section);
    const total = Math.max(1, Math.ceil(sectionRows.length / SCHEDULE_ROWS_PER_PAGE));
    for (let index = 0; index < sectionRows.length; index += SCHEDULE_ROWS_PER_PAGE) {
      pages.push({
        type: "scheduleTable",
        section,
        part: Math.floor(index / SCHEDULE_ROWS_PER_PAGE) + 1,
        total,
        rows: sectionRows.slice(index, index + SCHEDULE_ROWS_PER_PAGE)
      });
    }
  }

  return pages;
}

function scheduleDisplaySection(section) {
  if (/시간표/.test(section)) return "경기 시간표";
  return /필/.test(section) ? "필드 경기" : "트랙 경기";
}

function rowsFromScheduleInputs() {
  const trackRows = parseScheduleText(`트랙경기\n${els.scheduleTrackInput.value}`)
    .map((row) => ({ ...row, section: "트랙경기" }));
  const fieldRows = parseScheduleText(`필드경기\n${els.scheduleFieldInput.value}`)
    .map((row) => ({ ...row, section: "필드경기" }));
  return { trackRows, fieldRows, rows: [...trackRows, ...fieldRows] };
}

function buildDesignedSchedulePages() {
  const { trackRows, fieldRows, rows } = rowsFromScheduleInputs();
  const pages = [];
  if (els.scheduleCoverInput.checked) {
    pages.push({ type: "cover" });
  }

  if (trackRows.length) {
    pages.push({ type: "scheduleDesigned", section: "트랙경기", rows: trackRows });
  }
  if (fieldRows.length) {
    pages.push({ type: "scheduleDesigned", section: "필드경기", rows: fieldRows });
  }

  return { pages, rows };
}

function buildSchedulePagesFromPhotos(images) {
  const pages = [];
  if (els.scheduleCoverInput.checked) {
    pages.push({ type: "cover" });
  }

  images.forEach((image, index) => {
    const fallback = images.length === 1 ? "시간표" : SCHEDULE_SECTION_LABELS[index] || `시간표 ${index + 1}`;
    pages.push({
      type: "scheduleDesignedPhoto",
      canvas: image.canvas,
      fileName: image.fileName,
      imageIndex: index + 1,
      section: image.section || fallback
    });
  });

  return pages;
}

function buildSchedulePagesFromCanvas(sourceCanvas) {
  const pages = [];
  if (els.scheduleCoverInput.checked) {
    pages.push({ type: "cover" });
  }

  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const scale = scheduleBody.width / sourceWidth;
  const maxSliceHeight = Math.floor(scheduleBody.height / scale);
  const minSliceHeight = Math.floor(maxSliceHeight * 0.62);
  const scores = scheduleRowScores(sourceCanvas);
  let y = 0;

  while (y < sourceHeight) {
    const remaining = sourceHeight - y;
    if (remaining <= maxSliceHeight) {
      pages.push({ type: "schedule", y, height: remaining });
      break;
    }

    const target = Math.min(sourceHeight - 1, y + maxSliceHeight);
    const min = Math.min(sourceHeight - 1, y + minSliceHeight);
    const max = Math.min(sourceHeight - 1, y + Math.floor(maxSliceHeight * 1.08));
    let cut = bestScheduleCut(scores, target, min, max);
    if (cut <= y + Math.floor(maxSliceHeight * 0.45)) {
      cut = target;
    }

    pages.push({ type: "schedule", y, height: cut - y });
    y = cut;
  }

  return pages;
}

function buildSchedulePagesFromImages(images) {
  const pages = [];
  if (els.scheduleCoverInput.checked) {
    pages.push({ type: "cover" });
  }

  images.forEach((image, index) => {
    pages.push({
      type: "schedulePhoto",
      canvas: image.canvas,
      fileName: image.fileName,
      imageIndex: index + 1,
      section: image.section || SCHEDULE_SECTION_LABELS[index] || `시간표 ${index + 1}`
    });
  });

  return pages;
}

function drawScheduleCredit(ctx) {
  const theme = currentTheme();
  drawFitText(ctx, "한국육상매거진", CARD_WIDTH - 54, CARD_HEIGHT - 31, 360, {
    align: "right",
    size: 22,
    weight: 700,
    color: theme.muted,
    minSize: 18
  });
}

function renderScheduleEmptyCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  drawCardChrome(ctx, "TIMETABLE");
  drawCenteredMultiline(ctx, "시간표 카드", CARD_WIDTH / 2, 610, 800, 72, {
    size: 76,
    weight: 950,
    color: "#062764",
    minSize: 46
  });
  drawFitText(ctx, "시간표 사진을 선택하거나 내용을 입력해주세요.", CARD_WIDTH / 2, 730, 840, {
    align: "center",
    size: 28,
    weight: 700,
    color: "#8a929d",
    minSize: 22
  });
  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleCoverCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const title = normalize(els.scheduleTitleInput.value) || "경기시간표";
  const theme = currentTheme();

  drawCardChrome(ctx, "TIMETABLE");
  ctx.fillStyle = theme.accent;
  ctx.fillRect(CARD_WIDTH - 246, CARD_HEIGHT - 98, 170, 10);

  ctx.strokeStyle = theme.softLine;
  ctx.lineWidth = 2;
  for (let y = 180; y <= 1110; y += 92) {
    ctx.beginPath();
    ctx.moveTo(112, y);
    ctx.lineTo(CARD_WIDTH - 112, y);
    ctx.stroke();
  }
  for (let x = 160; x <= CARD_WIDTH - 160; x += 190) {
    ctx.beginPath();
    ctx.moveTo(x, 208);
    ctx.lineTo(x, 1070);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillRect(0, 320, CARD_WIDTH, 650);

  drawCenteredMultiline(ctx, title, CARD_WIDTH / 2, 548, 850, 66, {
    size: 58,
    weight: 950,
    color: theme.accent,
    minSize: 34
  });

  drawFitText(ctx, "경기시간표", CARD_WIDTH / 2, 720, 820, {
    align: "center",
    size: 92,
    weight: 950,
    color: theme.ink,
    minSize: 58
  });

  drawFitText(ctx, "TIMETABLE", CARD_WIDTH / 2, 820, 620, {
    align: "center",
    size: 24,
    weight: 800,
    color: theme.muted,
    minSize: 18
  });

  ctx.strokeStyle = theme.softLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleTableCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const title = normalize(els.scheduleTitleInput.value) || "경기시간표";
  const theme = currentTheme();
  const sectionLabel = `${page.section}${page.total > 1 ? ` ${page.part}/${page.total}` : ""}`;
  const tableX = 60;
  const tableY = 300;
  const tableW = 960;
  const headerH = 60;
  const rowH = 62;
  const colW = [148, 272, 328, 212];
  const headers = ["시간", "종목", "부별", "라운드"];
  const tableH = headerH + page.rows.length * rowH;

  drawCardChrome(ctx, "TIMETABLE");

  drawCenteredMultiline(ctx, title, CARD_WIDTH / 2, 92, 900, 34, {
    size: 30,
    weight: 800,
    color: theme.muted,
    minSize: 22
  });

  drawFitText(ctx, "경기시간표", CARD_WIDTH / 2, 170, 760, {
    align: "center",
    size: 56,
    weight: 950,
    color: theme.accent,
    minSize: 40
  });

  drawFitText(ctx, sectionLabel, CARD_WIDTH / 2, 242, 760, {
    align: "center",
    size: 28,
    weight: 850,
    color: theme.muted,
    minSize: 22
  });

  drawTableShell(ctx, tableX, tableY, tableW, tableH);
  ctx.fillStyle = theme.header;
  ctx.fillRect(tableX, tableY, tableW, headerH);

  let x = tableX;
  headers.forEach((header, index) => {
    if (index > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, tableY);
      ctx.lineTo(x, tableY + headerH);
      ctx.stroke();
    }

    drawFitText(ctx, header, x + colW[index] / 2, tableY + headerH / 2, colW[index] - 24, {
      align: "center",
      size: 28,
      weight: 950,
      color: theme.headerText,
      minSize: 22
    });
    x += colW[index];
  });

  page.rows.forEach((row, rowIndex) => {
    const y = tableY + headerH + rowIndex * rowH;
    ctx.fillStyle = rowIndex % 2 === 0 ? theme.paper : theme.rowAlt;
    ctx.fillRect(tableX, y, tableW, rowH);
    ctx.strokeStyle = theme.softLine;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowH);
    ctx.lineTo(tableX + tableW, y + rowH);
    ctx.stroke();

    const values = [row.time, row.eventName, row.division, row.round];
    let cellX = tableX;
    values.forEach((value, index) => {
      const isLeft = index === 1 || index === 2;
      drawFitText(ctx, value, isLeft ? cellX + 22 : cellX + colW[index] / 2, y + rowH / 2, colW[index] - 34, {
        align: isLeft ? "left" : "center",
        size: index === 0 ? 29 : 27,
        weight: index === 0 || index === 1 ? 900 : 760,
        color: theme.ink,
        minSize: 18
      });
      cellX += colW[index];
    });
  });

  drawScheduleCredit(ctx);
  return canvas;
}

function drawScheduleWaves(ctx) {
  ctx.fillStyle = "#f7f1e7";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const blue = ctx.createLinearGradient(0, 0, CARD_WIDTH, 250);
  blue.addColorStop(0, "rgba(120,177,222,0.58)");
  blue.addColorStop(1, "rgba(211,232,247,0.68)");
  ctx.fillStyle = blue;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(CARD_WIDTH, 0);
  ctx.bezierCurveTo(940, 116, 780, 174, 604, 190);
  ctx.bezierCurveTo(362, 214, 174, 160, 0, 238);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.beginPath();
  ctx.moveTo(118, 0);
  ctx.lineTo(CARD_WIDTH, 0);
  ctx.bezierCurveTo(894, 72, 748, 128, 574, 152);
  ctx.bezierCurveTo(388, 178, 220, 132, 40, 196);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(92,153,205,0.34)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(118, 0);
  ctx.bezierCurveTo(86, 62, 48, 96, 0, 130);
  ctx.closePath();
  ctx.fill();
}

function drawDesignedScheduleHeader(ctx, page) {
  const day = normalize(els.scheduleDayInput.value) || "제2일 경기";
  const date = normalize(els.scheduleDateInput.value) || "2026. 6. 6(토)";
  const navy = "#06285d";

  drawScheduleWaves(ctx);
  ctx.strokeStyle = navy;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(278, 42);
  ctx.lineTo(510, 42);
  ctx.moveTo(570, 42);
  ctx.lineTo(804, 42);
  ctx.moveTo(278, 174);
  ctx.lineTo(804, 174);
  ctx.stroke();

  drawFitText(ctx, "◆", CARD_WIDTH / 2, 43, 40, {
    align: "center",
    size: 18,
    weight: 900,
    color: navy,
    minSize: 14
  });

  drawFitText(ctx, "경기 시간표", CARD_WIDTH / 2, 116, 620, {
    align: "center",
    size: 76,
    weight: 950,
    color: navy,
    minSize: 52
  });

  drawFitText(ctx, day, 64, 214, 260, {
    align: "left",
    size: 28,
    weight: 900,
    color: navy,
    minSize: 22
  });
  drawFitText(ctx, date, CARD_WIDTH - 64, 214, 270, {
    align: "right",
    size: 25,
    weight: 900,
    color: navy,
    minSize: 20
  });

  const ribbonX = 42;
  const ribbonY = 236;
  const ribbonW = CARD_WIDTH - 84;
  const ribbonH = 48;
  ctx.fillStyle = navy;
  roundedRect(ctx, ribbonX, ribbonY, ribbonW, ribbonH, 8);
  ctx.fill();
  drawFitText(ctx, scheduleDisplaySection(page.section).replace(" ", "     "), CARD_WIDTH / 2, ribbonY + ribbonH / 2, 520, {
    align: "center",
    size: 26,
    weight: 950,
    color: "#ffffff",
    minSize: 20
  });
}

function drawDesignedScheduleCell(ctx, text, x, y, width, height, options = {}) {
  drawCenteredMultiline(ctx, String(text || ""), x + width / 2, y + height / 2, width - 8, Math.max(18, height * 0.42), {
    size: options.size || 21,
    weight: options.weight || 760,
    color: options.color || "#101820",
    minSize: options.minSize || 13,
    lineHeight: options.lineHeight || 1.03
  });
}

function drawDesignedScheduleHalf(ctx, rows, box, rowH, maxRows, side, section) {
  const colW = [74, 112, 140, 132, 40];
  const headers = ["시간", "종목", "종별", "라운드", "P"];
  const headerH = 50;
  const lineColor = "#6ea0c7";
  const softGreen = "#edf6df";
  const lateStart = section === "트랙경기" && side === "right" ? Math.max(0, rows.length - 6) : rows.length + 1;

  ctx.fillStyle = "#e8f4ff";
  ctx.fillRect(box.x, box.y, box.w, headerH);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.15;
  ctx.strokeRect(box.x, box.y, box.w, headerH + maxRows * rowH);

  let x = box.x;
  headers.forEach((header, index) => {
    if (index > 0) {
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, box.y);
      ctx.lineTo(x, box.y + headerH + maxRows * rowH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawDesignedScheduleCell(ctx, header, x, box.y, colW[index], headerH, {
      size: 23,
      weight: 900,
      color: "#0a2454"
    });
    x += colW[index];
  });

  for (let index = 0; index < maxRows; index += 1) {
    const y = box.y + headerH + index * rowH;
    const row = rows[index];
    ctx.fillStyle = index >= lateStart ? softGreen : "rgba(255,255,255,0.82)";
    ctx.fillRect(box.x, y, box.w, rowH);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(box.x, y + rowH);
    ctx.lineTo(box.x + box.w, y + rowH);
    ctx.stroke();

    if (!row) continue;
    const values = [row.time, row.eventName, row.division, row.round, ""];
    let cellX = box.x;
    values.forEach((value, col) => {
      drawDesignedScheduleCell(ctx, value, cellX, y, colW[col], rowH, {
        size: col === 0 ? 20 : 19,
        weight: col === 0 || col === 1 ? 860 : 730,
        color: index >= lateStart ? "#214b2e" : "#101820",
        minSize: col === 3 ? 11 : 12
      });
      cellX += colW[col];
    });
  }
}

function drawRestBox(ctx, x, y, width, height) {
  if (height < 120) return;
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#8fbf8f";
  ctx.lineWidth = 1.1;
  ctx.setLineDash([4, 3]);
  roundedRect(ctx, x + 20, y + 20, width - 40, height - 40, 8);
  ctx.stroke();
  ctx.setLineDash([]);

  drawFitText(ctx, "휴   식", x + width / 2, y + height / 2 + 8, width - 150, {
    align: "center",
    size: 54,
    weight: 950,
    color: "#315a36",
    minSize: 34
  });
}

function renderDesignedScheduleCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const rows = page.rows || [];

  drawDesignedScheduleHeader(ctx, page);

  const tableX = 42;
  const tableY = 284;
  const tableW = CARD_WIDTH - 84;
  const tableBottom = CARD_HEIGHT - 64;
  const gutter = 0;
  const halfW = tableW / 2;
  const leftCount = rows.length > 28 ? Math.min(14, Math.ceil(rows.length * 0.42)) : Math.ceil(rows.length / 2);
  const leftRows = rows.slice(0, leftCount);
  const rightRows = rows.slice(leftCount);
  const maxRows = Math.max(leftRows.length, rightRows.length, rows.length > 28 ? rightRows.length : 14, 1);
  const headerH = 50;
  const rowH = Math.max(31, Math.min(48, Math.floor((tableBottom - tableY - headerH) / maxRows)));
  const usedH = headerH + maxRows * rowH;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(tableX, tableY, tableW, usedH);
  ctx.strokeStyle = "#08366f";
  ctx.lineWidth = 2;
  ctx.strokeRect(tableX, tableY - 48, tableW, usedH + 48);

  drawDesignedScheduleHalf(ctx, leftRows, { x: tableX, y: tableY, w: halfW, h: usedH }, rowH, maxRows, "left", page.section);
  drawDesignedScheduleHalf(ctx, rightRows, { x: tableX + halfW + gutter, y: tableY, w: halfW, h: usedH }, rowH, maxRows, "right", page.section);

  const restY = tableY + headerH + leftRows.length * rowH;
  const restH = usedH - headerH - leftRows.length * rowH;
  if (page.section === "트랙경기" && rightRows.length > leftRows.length + 2) {
    drawRestBox(ctx, tableX, restY, halfW, restH);
  }

  ctx.strokeStyle = "#08366f";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(tableX + halfW, tableY - 48);
  ctx.lineTo(tableX + halfW, tableY + usedH);
  ctx.stroke();

  drawScheduleCredit(ctx);
  return canvas;
}

function renderDesignedSchedulePhotoCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const source = page?.canvas;
  drawDesignedScheduleHeader(ctx, page);

  const frame = {
    x: 42,
    y: 294,
    width: CARD_WIDTH - 84,
    height: CARD_HEIGHT - 358
  };

  ctx.fillStyle = "rgba(255,255,255,0.94)";
  roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, 8);
  ctx.fill();
  ctx.strokeStyle = "#08366f";
  ctx.lineWidth = 2;
  roundedRect(ctx, frame.x, frame.y, frame.width, frame.height, 8);
  ctx.stroke();

  if (source) {
    const imageBox = {
      x: frame.x + 18,
      y: frame.y + 18,
      width: frame.width - 36,
      height: frame.height - 36
    };
    const box = fitContain(source.width, source.height, imageBox);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.drawImage(source, box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleImageCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const source = page?.canvas || state.schedule.sourceCanvas;
  const theme = currentTheme();

  drawCardChrome(ctx, "TIMETABLE");

  if (!source || !page) {
    drawScheduleCredit(ctx);
    return canvas;
  }

  if (page.type === "schedulePhoto") {
    drawFitText(ctx, "경기시간표", CARD_WIDTH / 2, 54, 640, {
      align: "center",
      size: 46,
      weight: 950,
      color: theme.ink,
      minSize: 34
    });
    const badgeW = 300;
    const badgeH = 44;
    const badgeX = (CARD_WIDTH - badgeW) / 2;
    const badgeY = 80;
    ctx.fillStyle = theme.header;
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    drawFitText(ctx, page.section || "시간표", CARD_WIDTH / 2, badgeY + badgeH / 2, badgeW - 34, {
      align: "center",
      size: 28,
      weight: 950,
      color: theme.headerText,
      minSize: 22
    });

    const box = fitContain(source.width, source.height, scheduleBody);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
    ctx.drawImage(source, box.x, box.y, box.width, box.height);
    ctx.restore();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
    drawScheduleCredit(ctx);
    return canvas;
  }

  const scale = scheduleBody.width / source.width;
  const drawHeight = Math.min(scheduleBody.height, page.height * scale);
  ctx.drawImage(
    source,
    0,
    page.y,
    source.width,
    page.height,
    scheduleBody.x,
    scheduleBody.y,
    scheduleBody.width,
    drawHeight
  );

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(scheduleBody.x, scheduleBody.y, scheduleBody.width, drawHeight);
  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleCanvas(page) {
  if (!page) return renderScheduleEmptyCanvas();
  if (page.type === "cover") return renderScheduleCoverCanvas();
  if (page.type === "scheduleDesigned") return renderDesignedScheduleCanvas(page);
  if (page.type === "scheduleDesignedPhoto") return renderDesignedSchedulePhotoCanvas(page);
  if (page.type === "scheduleTable") return renderScheduleTableCanvas(page);
  return renderScheduleImageCanvas(page);
}

function renderScheduleCard() {
  applyDesignToPreview();
  const pages = state.schedule.pages;
  const page = activeSchedulePage();
  const previewCanvas = renderScheduleCanvas(page);
  els.schedulePreviewImage.src = previewCanvas.toDataURL("image/png");
  els.pageInfo.textContent = pages.length ? `${state.currentPage + 1} / ${pages.length}` : "0 / 0";
  els.prevPage.disabled = state.currentPage <= 0;
  els.nextPage.disabled = state.currentPage >= pages.length - 1;
  els.downloadCurrent.disabled = !pages.length;
  els.downloadAll.disabled = !pages.length;
  els.rowCount.textContent = `${pages.length}장`;
}

async function buildScheduleFromInput() {
  if (els.scheduleSourceMode.value === "photo") {
    await buildScheduleFromPhotos();
    return;
  }

  await buildScheduleFromTableInputs();
}

async function buildScheduleFromTableInputs() {
  const { pages, rows } = buildDesignedSchedulePages();
  if (!rows.length) {
    setStatus("트랙 또는 필드 시간표 내용을 입력해주세요.");
    return;
  }

  setMode("schedule");
  setScheduleBusy(true);
  setStatus("시간표 카드를 1080x1350 양식으로 만드는 중입니다.");

  try {
    state.schedule.images = [];
    state.schedule.sourceCanvas = null;
    state.schedule.rows = rows;
    state.schedule.pages = pages;
    state.currentPage = 0;
    renderScheduleCard();
    setStatus(`${rows.length}개 일정을 ${pages.length}장 시간표 카드로 만들었습니다.`);
  } catch (error) {
    console.error(error);
    setStatus(`시간표 카드를 만들지 못했습니다. ${error.message}`);
  } finally {
    setScheduleBusy(false);
  }
}

async function buildScheduleFromPhotos() {
  const files = selectedSchedulePhotoFiles();
  if (!files.length) {
    setStatus("시간표 사진을 선택해주세요.");
    return;
  }

  setMode("schedule");
  setScheduleBusy(true);
  setStatus(`${files.length}장 시간표 사진을 카드로 정리하는 중입니다.`);

  try {
    const images = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const image = await loadImageFromFile(file);
      const canvas = trimScheduleCanvas(canvasFromImage(image));
      const section = files.length === 1 ? "시간표" : SCHEDULE_SECTION_LABELS[index] || `시간표 ${index + 1}`;
      images.push({ fileName: file.name || `schedule_${index + 1}`, canvas, section });
    }

    state.schedule.images = images;
    state.schedule.sourceCanvas = images[0]?.canvas || null;
    state.schedule.rows = [];
    state.schedule.pages = buildSchedulePagesFromPhotos(images);
    state.currentPage = 0;
    renderScheduleCard();
    setStatus(`${images.length}장 사진을 ${state.schedule.pages.length}장 시간표 카드로 만들었습니다.`);
  } catch (error) {
    console.error(error);
    setStatus(`시간표 사진 카드를 만들지 못했습니다. ${error.message}`);
  } finally {
    setScheduleBusy(false);
  }
}

function rebuildDesignedSchedulePreview() {
  if (els.scheduleSourceMode.value === "photo" && state.schedule.images.length) {
    state.schedule.rows = [];
    state.schedule.pages = buildSchedulePagesFromPhotos(state.schedule.images);
  } else {
    const { pages, rows } = buildDesignedSchedulePages();
    state.schedule.rows = rows;
    state.schedule.pages = pages;
  }
  state.currentPage = Math.min(state.currentPage, Math.max(0, state.schedule.pages.length - 1));
  renderScheduleCard();
}

function renderCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const theme = currentTheme();

  drawCardChrome(ctx, "RESULTS");

  const headerLayout = drawResultHeader(ctx, page);

  const tableX = 60;
  const tableY = headerLayout.tableY;
  const tableW = 960;
  const headerH = 70;
  const preferredRowH = page.rows.length >= ROWS_PER_PAGE ? 86 : 94;
  const footerTop = CARD_HEIGHT - 142;
  const availableRowArea = Math.max(preferredRowH, footerTop - tableY - headerH);
  const rowH = page.rows.length ? Math.min(preferredRowH, Math.floor(availableRowArea / page.rows.length)) : preferredRowH;
  const colW = resultColumnWidths();
  const headers = resultHeaders();
  const tableH = headerH + page.rows.length * rowH;

  drawTableShell(ctx, tableX, tableY, tableW, tableH);
  ctx.fillStyle = theme.header;
  ctx.fillRect(tableX, tableY, tableW, headerH);

  let x = tableX;
  headers.forEach((header, index) => {
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    if (index > 0) {
      ctx.beginPath();
      ctx.moveTo(x, tableY);
      ctx.lineTo(x, tableY + headerH);
      ctx.stroke();
    }
    drawFitText(ctx, header, x + colW[index] / 2, tableY + headerH / 2, colW[index] - 24, {
      align: "center",
      size: 34,
      weight: 950,
      color: theme.headerText,
      minSize: 26
    });
    x += colW[index];
  });

  page.rows.forEach((row, rowIndex) => {
    const y = tableY + headerH + rowIndex * rowH;
    const numericRank = Number(row.rank);
    ctx.fillStyle = numericRank === 1 ? theme.medal1 : numericRank === 2 ? theme.medal2 : numericRank === 3 ? theme.medal3 : rowIndex % 2 === 0 ? theme.paper : theme.rowAlt;
    ctx.fillRect(tableX, y, tableW, rowH);
    if (numericRank >= 1 && numericRank <= 3) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(tableX, y, 8, rowH);
    }
    ctx.strokeStyle = theme.softLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowH);
    ctx.lineTo(tableX + tableW, y + rowH);
    ctx.stroke();

    const values = resultValues(row);
    let cellX = tableX;
    values.forEach((value, index) => {
      const isRelay = isRelayEvent();
      const isLeft = isRelay ? index === 1 || index === 2 : index === 2;
      const isRecord = index === 3;
      drawFitText(ctx, value, isLeft ? cellX + 24 : cellX + colW[index] / 2, y + rowH / 2, colW[index] - 32, {
        align: isLeft ? "left" : "center",
        size: isRelay && index === 2 ? 30 : isRecord ? 32 : 36,
        weight: isLeft ? 760 : 900,
        color: theme.ink,
        minSize: isRelay && index === 2 ? 18 : isLeft ? 21 : 25
      });
      cellX += colW[index];
    });
  });

  drawFitText(ctx, "한국육상매거진", CARD_WIDTH - 60, CARD_HEIGHT - 34, 360, {
    align: "right",
    size: 24,
    weight: 700,
    color: theme.muted,
    minSize: 20
  });

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("PNG 변환에 실패했습니다."));
      }
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadPage(page, index) {
  const title = filenameSafe(pageTitle(page));
  const pageNo = String(index + 1).padStart(2, "0");
  const blob = await canvasToBlob(renderCanvas(page));
  downloadBlob(blob, `${pageNo}_${title || "result_card"}.png`);
}

function scheduleFilename(page, index) {
  const title = filenameSafe(normalize(els.scheduleTitleInput.value) || "경기시간표");
  const pageNo = String(index + 1).padStart(2, "0");
  const photoName = page?.type === "schedulePhoto" || page?.type === "scheduleDesignedPhoto" ? filenameSafe(page.fileName || `사진_${page.imageIndex || pageNo}`) : "";
  const sectionName = page?.type === "scheduleDesigned" ? filenameSafe(scheduleDisplaySection(page.section)) : "";
  const suffix = page?.type === "cover" ? "표지" : sectionName ? sectionName : photoName ? `시간표_${photoName}` : "시간표";
  return `${pageNo}_${title}_${suffix}.png`;
}

async function downloadSchedulePage(page, index) {
  const blob = await canvasToBlob(renderScheduleCanvas(page));
  downloadBlob(blob, scheduleFilename(page, index));
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: dosDate };
}

function zipHeader(size) {
  const data = new Uint8Array(size);
  const view = new DataView(data.buffer);
  return { data, view };
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const fileBytes = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(fileBytes);

    const local = zipHeader(30 + nameBytes.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, stamp.time, true);
    local.view.setUint16(12, stamp.date, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, fileBytes.length, true);
    local.view.setUint32(22, fileBytes.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    local.view.setUint16(28, 0, true);
    local.data.set(nameBytes, 30);
    localParts.push(local.data, fileBytes);

    const central = zipHeader(46 + nameBytes.length);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, stamp.time, true);
    central.view.setUint16(14, stamp.date, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, fileBytes.length, true);
    central.view.setUint32(24, fileBytes.length, true);
    central.view.setUint16(28, nameBytes.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, offset, true);
    central.data.set(nameBytes, 46);
    centralParts.push(central.data);

    offset += local.data.length + fileBytes.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipHeader(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, centralOffset, true);
  end.view.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end.data], { type: "application/zip" });
}

async function downloadAllPages() {
  const pages = state.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.rows.length);
  if (!pages.length) return;

  els.downloadAll.disabled = true;
  els.downloadCurrent.disabled = true;
  setStatus(`${pages.length}개 페이지를 ZIP으로 묶는 중입니다.`);

  try {
    const files = [];
    for (const { page, index } of pages) {
      const title = filenameSafe(pageTitle(page));
      const pageNo = String(index + 1).padStart(2, "0");
      files.push({
        name: `${pageNo}_${title || "result_card"}.png`,
        blob: await canvasToBlob(renderCanvas(page))
      });
    }
    const zip = await createZip(files);
    const zipName = `${filenameSafe(normalize(els.titleInput.value) || "result_cards")}.zip`;
    downloadBlob(zip, zipName);
    setStatus(`${files.length}개 페이지를 ZIP으로 저장했습니다.`);
  } catch (error) {
    console.error(error);
    setStatus(`전체 저장에 실패했습니다. ${error.message}`);
  } finally {
    renderCard();
  }
}

async function downloadAllSchedulePages() {
  const pages = state.schedule.pages.map((page, index) => ({ page, index }));
  if (!pages.length) return;

  els.downloadAll.disabled = true;
  els.downloadCurrent.disabled = true;
  setStatus(`${pages.length}개 시간표 카드를 ZIP으로 묶는 중입니다.`);

  try {
    const files = [];
    for (const { page, index } of pages) {
      files.push({
        name: scheduleFilename(page, index),
        blob: await canvasToBlob(renderScheduleCanvas(page))
      });
    }
    const zip = await createZip(files);
    const zipName = `${filenameSafe(normalize(els.scheduleTitleInput.value) || "경기시간표")}_시간표.zip`;
    downloadBlob(zip, zipName);
    setStatus(`${files.length}개 시간표 카드를 ZIP으로 저장했습니다.`);
  } catch (error) {
    console.error(error);
    setStatus(`전체 저장에 실패했습니다. ${error.message}`);
  } finally {
    renderScheduleCard();
  }
}

els.resultModeBtn.addEventListener("click", () => {
  state.currentPage = Math.min(state.currentPage, state.pages.length - 1);
  setMode("result");
});

els.scheduleModeBtn.addEventListener("click", () => {
  state.currentPage = Math.min(state.currentPage, Math.max(0, state.schedule.pages.length - 1));
  setMode("schedule");
});

els.eventSearch.addEventListener("input", () => {
  renderEventOptions();
});

els.tournamentSelect.addEventListener("change", () => {
  state.selectedTournament =
    state.tournaments.find((tournament) => tournament.id === els.tournamentSelect.value) ||
    state.selectedTournament;
  state.selectedEvent = null;
  state.result = null;
  state.currentPage = 0;
  state.manualTitle = false;
  state.manualSubtitle = false;
  loadEvents();
});

els.eventSelect.addEventListener("change", () => {
  state.selectedEvent = state.filteredEvents.find((event) => event.id === els.eventSelect.value) || null;
});

els.refreshBtn.addEventListener("click", loadEvents);
els.loadBtn.addEventListener("click", loadSelectedResult);

els.titleInput.addEventListener("input", () => {
  state.manualTitle = true;
  renderCard();
});

els.subtitleInput.addEventListener("input", () => {
  state.manualSubtitle = true;
  renderCard();
});

els.designSelect.addEventListener("change", () => {
  applyDesignToPreview();
  if (state.mode === "schedule") {
    renderScheduleCard();
  } else {
    renderCard();
  }
});

els.scheduleTitleInput.addEventListener("input", () => {
  if (state.mode === "schedule") {
    renderScheduleCard();
  }
});

els.scheduleSourceMode.addEventListener("change", () => {
  if (state.mode === "schedule" && state.schedule.pages.length) {
    rebuildDesignedSchedulePreview();
  }
});

els.schedulePhotoInput.addEventListener("change", () => {
  const count = selectedSchedulePhotoFiles().length;
  if (count) {
    setMode("schedule");
    els.scheduleSourceMode.value = "photo";
    setStatus(`${count}장 시간표 사진을 선택했습니다.`);
  }
});

els.scheduleDayInput.addEventListener("input", () => {
  if (state.mode === "schedule") {
    renderScheduleCard();
  }
});

els.scheduleDateInput.addEventListener("input", () => {
  if (state.mode === "schedule") {
    renderScheduleCard();
  }
});

[els.scheduleTrackInput, els.scheduleFieldInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (state.mode === "schedule" && state.schedule.pages.length) {
      rebuildDesignedSchedulePreview();
    }
  });
});

els.scheduleCoverInput.addEventListener("change", () => {
  if (state.schedule.pages.length) {
    rebuildDesignedSchedulePreview();
  }
});

els.buildScheduleBtn.addEventListener("click", () => {
  buildScheduleFromInput();
});

[els.groupByHeat, els.hideNonFinishers].forEach((input) => {
  input.addEventListener("change", () => {
    buildPages();
    renderCard();
  });
});

els.prevPage.addEventListener("click", () => {
  state.currentPage = Math.max(0, state.currentPage - 1);
  if (state.mode === "schedule") {
    renderScheduleCard();
  } else {
    renderCard();
  }
});

els.nextPage.addEventListener("click", () => {
  const maxPage = Math.max(0, state.mode === "schedule" ? state.schedule.pages.length - 1 : state.pages.length - 1);
  state.currentPage = Math.min(maxPage, state.currentPage + 1);
  if (state.mode === "schedule") {
    renderScheduleCard();
  } else {
    renderCard();
  }
});

els.downloadCurrent.addEventListener("click", async () => {
  try {
    if (state.mode === "schedule") {
      await downloadSchedulePage(activeSchedulePage(), state.currentPage);
    } else {
      await downloadPage(currentPage(), state.currentPage);
    }
  } catch (error) {
    console.error(error);
    setStatus(`현재 페이지 저장에 실패했습니다. ${error.message}`);
  }
});

els.downloadAll.addEventListener("click", () => {
  if (state.mode === "schedule") {
    downloadAllSchedulePages();
  } else {
    downloadAllPages();
  }
});

applyDesignToPreview();
renderSample("샘플 카드가 준비되었습니다.");
loadTournaments();
