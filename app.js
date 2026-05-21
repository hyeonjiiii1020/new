const ROWS_PER_PAGE = 7;
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1080;
const API_BASE = window.location.protocol === "file:" ? "http://localhost:5173" : "";

const state = {
  tournaments: [],
  selectedTournament: null,
  events: [],
  filteredEvents: [],
  selectedEvent: null,
  result: null,
  pages: [],
  currentPage: 0,
  manualTitle: false,
  manualSubtitle: false
};

const $ = (selector) => document.querySelector(selector);

const els = {
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
  cardRows: $("#cardRows")
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

function setStatus(message) {
  els.statusText.textContent = message;
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
  setStatus("대회 목록을 불러오는 중입니다.");

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
  setStatus(`${state.selectedTournament.name} 경기 목록을 불러오는 중입니다.`);

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
      setStatus(`${state.selectedTournament.name}에서 불러올 수 있는 실시간 경기가 없습니다.`);
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
  setStatus(`${state.selectedTournament?.name || "선택 대회"} · ${selected.label} 결과를 불러오는 중입니다.`);

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
    setStatus(`${payload.tournament?.name || state.selectedTournament?.name || ""} · ${selected.label} 결과를 불러왔습니다.`);
  } catch (error) {
    console.error(error);
    setStatus(`결과를 불러오지 못했습니다. ${error.message}`);
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
  setStatus(message);
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
  els.rowCount.textContent = `${rows.length}명`;
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

  els.pageInfo.textContent = `${state.currentPage + 1} / ${state.pages.length}`;
  els.prevPage.disabled = state.currentPage === 0;
  els.nextPage.disabled = state.currentPage >= state.pages.length - 1;
  els.downloadCurrent.disabled = !page.rows.length;
  els.downloadAll.disabled = !state.pages.some((item) => item.rows.length);
}

function setBusy(isBusy) {
  els.refreshBtn.disabled = isBusy;
  els.loadBtn.disabled = isBusy;
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
  const tableY = 250;
  const tableW = 960;
  const headerH = 66;
  const rowH = 84;
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
      size: 34,
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
        size: isRecord ? 32 : 36,
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

[els.groupByHeat, els.hideNonFinishers].forEach((input) => {
  input.addEventListener("change", () => {
    buildPages();
    renderCard();
  });
});

els.prevPage.addEventListener("click", () => {
  state.currentPage = Math.max(0, state.currentPage - 1);
  renderCard();
});

els.nextPage.addEventListener("click", () => {
  state.currentPage = Math.min(state.pages.length - 1, state.currentPage + 1);
  renderCard();
});

els.downloadCurrent.addEventListener("click", async () => {
  try {
    await downloadPage(currentPage(), state.currentPage);
  } catch (error) {
    console.error(error);
    setStatus(`현재 페이지 저장에 실패했습니다. ${error.message}`);
  }
});

els.downloadAll.addEventListener("click", () => {
  downloadAllPages();
});

renderSample("샘플 카드가 준비되었습니다.");
loadTournaments();
