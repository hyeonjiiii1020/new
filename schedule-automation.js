(function scheduleDraftModule(root) {
  const EMPTY_DRAFT = {
    title: "",
    day: "",
    date: "",
    track: [],
    field: [],
    uncertain: []
  };

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/[｜│]/g, "|")
      .replace(/[“”〃]/g, '"')
      .replace(/[×]/g, "x")
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, " ")
      .trim();
  }

  function arrayFrom(value) {
    return Array.isArray(value) ? value : [];
  }

  function firstText(row, keys) {
    for (const key of keys) {
      const value = row && typeof row === "object" ? row[key] : "";
      const text = cleanText(value);
      if (text) return text;
    }
    return "";
  }

  function normalizeRow(row, section, previous) {
    const time = firstText(row, ["time", "시간"]);
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      return {
        kind: "invalid",
        reason: "시간 형식이 HH:MM이 아닙니다.",
        row
      };
    }

    const eventName = firstText(row, ["eventName", "event", "종목"]) || previous.eventName;
    const division = firstText(row, ["division", "category", "class", "종별", "부별"]) || previous.division;
    const round = firstText(row, ["round", "라운드"]) || previous.round;
    const p = firstText(row, ["p", "P"]);

    if (!eventName || !division || !round) {
      return {
        kind: "invalid",
        reason: "종목, 종별, 라운드 중 비어 있는 값이 있습니다.",
        row
      };
    }

    const normalized = {
      section,
      time: time.padStart(5, "0"),
      eventName,
      division,
      round,
      p
    };

    previous.eventName = normalized.eventName;
    previous.division = normalized.division;
    previous.round = normalized.round;

    return {
      kind: "valid",
      row: normalized
    };
  }

  function normalizeRows(rows, section) {
    const previous = { eventName: "", division: "", round: "" };
    const valid = [];
    const invalid = [];

    arrayFrom(rows).forEach((row, index) => {
      const parsed = normalizeRow(row, section, previous);
      if (parsed.kind === "valid") {
        valid.push(parsed.row);
      } else {
        invalid.push({
          index: index + 1,
          reason: parsed.reason,
          row: parsed.row
        });
      }
    });

    return { valid, invalid };
  }

  function parseScheduleDraft(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      return {
        ok: false,
        message: "AI 추출 초안을 붙여넣어 주세요.",
        draft: EMPTY_DRAFT,
        invalid: []
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        message: "JSON 형식으로 읽지 못했습니다. 따옴표와 쉼표를 확인해 주세요.",
        draft: EMPTY_DRAFT,
        invalid: [{ index: 0, reason: error.message, row: raw.slice(0, 160) }]
      };
    }

    const trackRows = normalizeRows(parsed.track || parsed.tracks || [], "트랙경기");
    const fieldRows = normalizeRows(parsed.field || parsed.fields || [], "필드경기");
    const draft = {
      title: cleanText(parsed.title),
      day: cleanText(parsed.day),
      date: cleanText(parsed.date),
      track: trackRows.valid,
      field: fieldRows.valid,
      uncertain: arrayFrom(parsed.uncertain).map((item) => {
        if (typeof item === "string") return cleanText(item);
        const label = cleanText(item.field || item.label || "");
        const value = cleanText(item.value || "");
        const note = cleanText(item.note || item.reason || "");
        return [label, value, note].filter(Boolean).join(" · ");
      }).filter(Boolean)
    };
    const invalid = [...trackRows.invalid, ...fieldRows.invalid];
    const rowCount = draft.track.length + draft.field.length;

    return {
      ok: rowCount > 0 && invalid.length === 0,
      message: rowCount ? "초안 검토가 끝났습니다." : "반영할 시간표 행을 찾지 못했습니다.",
      draft,
      invalid
    };
  }

  function formatRows(rows) {
    return rows
      .map((row) => [row.time, row.eventName, row.division, row.round, row.p].filter(Boolean).join(" | "))
      .join("\n");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderReview(target, result) {
    if (!target) return;
    const { draft, invalid } = result;
    const meta = [draft.day, draft.date].filter(Boolean).join(" · ");
    const rows = [...draft.track, ...draft.field].slice(0, 8);
    const warnings = [
      ...draft.uncertain,
      ...invalid.map((item) => `${item.index}행 · ${item.reason}`)
    ];

    target.classList.toggle("is-error", !result.ok);
    target.innerHTML = [
      `<strong>${escapeHtml(result.message)}</strong>`,
      meta ? `<span>${escapeHtml(meta)}</span>` : "",
      `<span>트랙 ${draft.track.length}개 · 필드 ${draft.field.length}개 · 확인 필요 ${warnings.length}개</span>`,
      rows.length
        ? `<div class="draft-mini-table">${rows.map((row) => `<p><b>${escapeHtml(row.time)}</b> ${escapeHtml(row.eventName)} · ${escapeHtml(row.division)} · ${escapeHtml(row.round)}</p>`).join("")}</div>`
        : "",
      warnings.length
        ? `<div class="draft-warnings">${warnings.slice(0, 5).map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>`
        : ""
    ].filter(Boolean).join("");
  }

  function setValue(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setStatus(message) {
    const status = document.getElementById("statusText");
    if (status) status.textContent = message;
  }

  function applyDraft(result) {
    if (!result.ok) {
      setStatus("초안에 확인이 필요한 행이 있습니다. 수정 후 다시 검토해주세요.");
      return false;
    }

    const mode = document.getElementById("scheduleSourceMode");
    if (mode) mode.value = "table";

    if (result.draft.title && !/경기\s*시간표|경기시간표/.test(result.draft.title)) {
      setValue("scheduleTitleInput", result.draft.title);
    }
    setValue("scheduleDayInput", result.draft.day);
    setValue("scheduleDateInput", result.draft.date);
    setValue("scheduleTrackInput", formatRows(result.draft.track));
    setValue("scheduleFieldInput", formatRows(result.draft.field));

    const buildButton = document.getElementById("buildScheduleBtn");
    if (buildButton) buildButton.click();
    setStatus(`검토한 초안으로 트랙 ${result.draft.track.length}개, 필드 ${result.draft.field.length}개를 반영했습니다.`);
    return true;
  }

  function initScheduleDraftUi() {
    const draftInput = document.getElementById("scheduleDraftInput");
    const review = document.getElementById("scheduleDraftReview");
    const reviewButton = document.getElementById("reviewScheduleDraftBtn");
    const applyButton = document.getElementById("applyScheduleDraftBtn");
    if (!draftInput || !review || !reviewButton || !applyButton) return;

    let lastResult = null;

    reviewButton.addEventListener("click", () => {
      lastResult = parseScheduleDraft(draftInput.value);
      renderReview(review, lastResult);
      setStatus(lastResult.ok ? "AI 추출 초안을 검토했습니다. 이상 없으면 반영하세요." : lastResult.message);
    });

    applyButton.addEventListener("click", () => {
      const result = lastResult || parseScheduleDraft(draftInput.value);
      lastResult = result;
      renderReview(review, result);
      applyDraft(result);
    });

    draftInput.addEventListener("input", () => {
      lastResult = null;
      review.classList.remove("is-error");
      review.textContent = "AI가 읽은 초안을 붙여넣고 검토해주세요.";
    });
  }

  const api = {
    parseScheduleDraft,
    formatRows,
    applyDraft
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.scheduleDraftTools = api;

  if (typeof document !== "undefined") {
    initScheduleDraftUi();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
