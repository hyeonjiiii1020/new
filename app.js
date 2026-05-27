const ROWS_PER_PAGE = 8;
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1080;
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
  schedule: {
    sourceCanvas: null,
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
  cardTitle: $("#cardTitle"),
  cardSubtitle: $("#cardSubtitle"),
  recordHeader: $("#recordHeader"),
  cardRows: $("#cardRows"),
  cardPreview: $("#cardPreview"),
  scheduleTitleInput: $("#scheduleTitleInput"),
  scheduleImageInput: $("#scheduleImageInput"),
  scheduleCoverInput: $("#scheduleCoverInput"),
  buildScheduleBtn: $("#buildScheduleBtn"),
  schedulePreview: $("#schedulePreview"),
  schedulePreviewImage: $("#schedulePreviewImage")
};

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
  x: 54,
  y: 44,
  width: 972,
  height: 968
};

function setStatus(message) {
  els.statusText.textContent = message;
}

function setResultStatus(message) {
  if (state.mode === "result") {
    setStatus(message);
  }
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
      setStatus("대회명을 입력하고 시간표 사진을 선택해주세요.");
    }
    renderScheduleCard();
  }
}

function activeSchedulePage() {
  return state.schedule.pages[state.currentPage] || null;
}

function eventMatches(event, query) {
  if (!query) return true;
  const haystack = `${event.eventName} ${event.division} ${event.round} ${event.status}`.toLowerCase();
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
    const preferred = state.events.find((event) => event.round === "결승" && event.status.includes("완료")) || state.events[0] || null;
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
    setResultStatus(`결과를 불러오지 못했습니다. ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function renderSample(message) {
  state.result = {
    meta: {
      tournament: "제80회 전국육상경기선수권대회",
      place: "정선",
      eventName: "100m",
      division: "여자부",
      round: "결승",
      date: "2026-05-11"
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
    els.subtitleInput.value = subtitle || "제80회 전국육상경기선수권대회";
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

function currentPage() {
  return state.pages[state.currentPage] || { heat: "", rows: [] };
}

function renderCard() {
  const page = currentPage();
  els.cardTitle.textContent = pageTitle(page);
  els.cardSubtitle.textContent = normalize(els.subtitleInput.value);
  els.recordHeader.textContent = isCombinedOverallEvent() ? "총점" : "기록";
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

      [rankText(resultRow.rank), resultRow.name, resultRow.team, recordText(resultRow)].forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
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
  els.scheduleImageInput.disabled = isBusy;
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
      if (lightness > 185) {
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

  const pad = Math.round(Math.max(width, height) * 0.01);
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

function drawScheduleCredit(ctx) {
  drawFitText(ctx, "한국육상매거진", CARD_WIDTH - 54, CARD_HEIGHT - 31, 360, {
    align: "right",
    size: 22,
    weight: 700,
    color: "#8a929d",
    minSize: 18
  });
}

function renderScheduleEmptyCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.strokeStyle = "#f1f1f1";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
  drawCenteredMultiline(ctx, "시간표 카드", CARD_WIDTH / 2, 484, 800, 68, {
    size: 72,
    weight: 950,
    color: "#062764",
    minSize: 46
  });
  drawFitText(ctx, "사진을 업로드하면 미리보기가 표시됩니다.", CARD_WIDTH / 2, 590, 780, {
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
  const source = state.schedule.sourceCanvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  if (source) {
    const scale = Math.max(CARD_WIDTH / source.width, CARD_HEIGHT / source.height);
    const drawW = source.width * scale;
    const drawH = source.height * scale;
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(source, (CARD_WIDTH - drawW) / 2, (CARD_HEIGHT - drawH) / 2, drawW, drawH);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }

  ctx.fillStyle = "#062764";
  ctx.fillRect(76, 86, 170, 10);
  ctx.fillRect(CARD_WIDTH - 246, CARD_HEIGHT - 98, 170, 10);

  drawCenteredMultiline(ctx, title, CARD_WIDTH / 2, 414, 850, 62, {
    size: 56,
    weight: 950,
    color: "#062764",
    minSize: 34
  });

  drawFitText(ctx, "경기시간표", CARD_WIDTH / 2, 578, 820, {
    align: "center",
    size: 88,
    weight: 950,
    color: "#101419",
    minSize: 58
  });

  drawFitText(ctx, "TIMETABLE", CARD_WIDTH / 2, 668, 620, {
    align: "center",
    size: 24,
    weight: 800,
    color: "#557c8c",
    minSize: 18
  });

  ctx.strokeStyle = "#f1f1f1";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleImageCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  const source = state.schedule.sourceCanvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.strokeStyle = "#f1f1f1";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);

  if (!source || !page) {
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

  ctx.strokeStyle = "#dfe4ea";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(scheduleBody.x, scheduleBody.y, scheduleBody.width, drawHeight);
  drawScheduleCredit(ctx);
  return canvas;
}

function renderScheduleCanvas(page) {
  if (!page) return renderScheduleEmptyCanvas();
  if (page.type === "cover") return renderScheduleCoverCanvas();
  return renderScheduleImageCanvas(page);
}

function renderScheduleCard() {
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

function rebuildSchedulePages() {
  if (!state.schedule.sourceCanvas) return;
  state.schedule.pages = buildSchedulePagesFromCanvas(state.schedule.sourceCanvas);
  state.currentPage = 0;
  renderScheduleCard();
  setStatus(`${state.schedule.pages.length}장으로 시간표 카드가 준비되었습니다.`);
}

async function buildScheduleFromInput() {
  const file = els.scheduleImageInput.files?.[0];
  if (!file) {
    setStatus("시간표 사진을 먼저 선택해주세요.");
    return;
  }

  setMode("schedule");
  setScheduleBusy(true);
  setStatus("시간표 사진을 카드뉴스용으로 정리하는 중입니다.");

  try {
    const image = await loadImageFromFile(file);
    const baseCanvas = canvasFromImage(image);
    state.schedule.sourceCanvas = trimScheduleCanvas(baseCanvas);
    rebuildSchedulePages();
  } catch (error) {
    console.error(error);
    setStatus(`시간표 카드를 만들지 못했습니다. ${error.message}`);
  } finally {
    setScheduleBusy(false);
  }
}

function renderCanvas(page) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.strokeStyle = "#f1f1f1";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);

  drawCenteredMultiline(ctx, pageTitle(page), CARD_WIDTH / 2, 96, 900, 62, {
    size: 64,
    weight: 950,
    color: "#062764",
    minSize: 44
  });

  drawCenteredMultiline(ctx, normalize(els.subtitleInput.value), CARD_WIDTH / 2, 178, 820, 36, {
    size: 30,
    weight: 700,
    color: "#557c8c",
    minSize: 23
  });

  const tableX = 60;
  const tableY = 246;
  const tableW = 960;
  const headerH = 62;
  const rowH = 80;
  const colW = [118, 178, 432, 232];
  const headers = ["순위", "성명", "소속", isCombinedOverallEvent() ? "총점" : "기록"];

  ctx.fillStyle = "#062764";
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
      size: 32,
      weight: 950,
      color: "#ffffff",
      minSize: 26
    });
    x += colW[index];
  });

  page.rows.forEach((row, rowIndex) => {
    const y = tableY + headerH + rowIndex * rowH;
    const numericRank = Number(row.rank);
    ctx.fillStyle = numericRank === 1 ? "#fff6c9" : numericRank === 2 ? "#f0f1f3" : numericRank === 3 ? "#f3e3d3" : "#ffffff";
    ctx.fillRect(tableX, y, tableW, rowH);
    ctx.strokeStyle = "#e7e7e7";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tableX, y + rowH);
    ctx.lineTo(tableX + tableW, y + rowH);
    ctx.stroke();

    const values = [rankText(row.rank), row.name, row.team, recordText(row)];
    let cellX = tableX;
    values.forEach((value, index) => {
      const isLeft = index === 2;
      const isRecord = index === 3;
      drawFitText(ctx, value, isLeft ? cellX + 24 : cellX + colW[index] / 2, y + rowH / 2, colW[index] - 32, {
        align: isLeft ? "left" : "center",
        size: isRecord ? 30 : 34,
        weight: index === 2 ? 760 : 900,
        color: "#101010",
        minSize: index === 2 ? 24 : 25
      });
      cellX += colW[index];
    });
  });

  drawFitText(ctx, "한국육상매거진", CARD_WIDTH - 60, CARD_HEIGHT - 34, 360, {
    align: "right",
    size: 24,
    weight: 700,
    color: "#8a929d",
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
  const suffix = page?.type === "cover" ? "표지" : "시간표";
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

els.scheduleTitleInput.addEventListener("input", () => {
  if (state.mode === "schedule") {
    renderScheduleCard();
  }
});

els.scheduleCoverInput.addEventListener("change", () => {
  if (state.schedule.sourceCanvas) {
    rebuildSchedulePages();
  }
});

els.scheduleImageInput.addEventListener("change", () => {
  if (els.scheduleImageInput.files?.[0]) {
    buildScheduleFromInput();
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

renderSample("샘플 카드가 준비되었습니다.");
loadTournaments();
