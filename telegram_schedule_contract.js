const path = require("node:path");

const BROWSER_CONTRACT = Object.freeze({
  reviewSelector: "#scheduleDraftReview",
  acknowledgementSelector: "#scheduleDraftAcknowledge",
  statusSelector: "#statusText",
  pageInfoSelector: "#pageInfo",
  acceptedReviewText: "초안 검토가 끝났습니다.",
  acknowledgementAttribute: "data-draft-ack"
});

class ContractError extends Error {
  constructor(code, message, response = null) {
    super(message);
    this.name = "ContractError";
    this.code = code;
    this.response = response;
  }
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function addIssue(issues, code, issuePath, message) {
  issues.push({ code, path: issuePath, message });
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return [
    ...(Array.isArray(value.left) ? value.left.map((row) => ({ ...row, column: row.column || "left" })) : []),
    ...(Array.isArray(value.right) ? value.right.map((row) => ({ ...row, column: row.column || "right" })) : [])
  ];
}

function normalizeRow(row, issuePath, issues) {
  const value = asObject(row);
  const normalized = {
    time: clean(value.time || value.시간),
    event: clean(value.eventName || value.event || value.종목),
    division: clean(value.division || value.category || value.class || value.종별 || value.부별),
    round: clean(value.round || value.라운드),
    p: clean(value.p || value.P),
    column: clean(value.column || value.side || value.열 || value.구역)
  };
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(normalized.time)) addIssue(issues, "invalid_time", issuePath + ".time", "HH:MM 형식의 시간이 필요합니다.");
  if (!normalized.event) addIssue(issues, "missing_event", issuePath + ".event", "종목이 필요합니다.");
  if (!normalized.division) addIssue(issues, "missing_division", issuePath + ".division", "부별이 필요합니다.");
  return normalized;
}

function metadataInteger(source, keys, issues, issuePath, label) {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(source, candidate));
  if (!key) return null;
  if (!Number.isInteger(source[key])) {
    addIssue(issues, "invalid_" + label + "_metadata", issuePath + "." + key, label + " 메타데이터는 정수여야 합니다.");
    return null;
  }
  return source[key];
}

function normalizeDraft(draft, index, issues) {
  const source = asObject(draft);
  const sourceId = clean(source.sourceId || source.source_id);
  const title = clean(source.title || source.competition_name || source.competition);
  const day = clean(source.day || source.day_label || source.일차);
  const date = clean(source.date || source.date_label || source.날짜);
  const issuePath = "drafts[" + index + "]";
  const sourceIndex = metadataInteger(source, ["sourceIndex", "source_index"], issues, issuePath, "source");
  const sourceCount = metadataInteger(source, ["sourceCount", "source_count"], issues, issuePath, "source");
  const pageIndex = metadataInteger(source, ["pageIndex", "page_index"], issues, issuePath, "page");
  const pageCount = metadataInteger(source, ["pageCount", "page_count"], issues, issuePath, "page");
  if (!sourceId) addIssue(issues, "missing_source_id", issuePath + ".sourceId", "입력 원본 식별자가 필요합니다.");
  if (!title) addIssue(issues, "missing_title", issuePath + ".title", "대회 제목이 필요합니다.");
  if (!day) addIssue(issues, "missing_day", issuePath + ".day", "경기일 식별자가 필요합니다.");
  if (!date) addIssue(issues, "missing_date", issuePath + ".date", "경기 날짜가 필요합니다.");
  if ((sourceIndex === null) !== (sourceCount === null)) addIssue(issues, "incomplete_source_metadata", issuePath, "sourceIndex와 sourceCount는 함께 제공되어야 합니다.");
  if ((pageIndex === null) !== (pageCount === null)) addIssue(issues, "incomplete_page_metadata", issuePath, "pageIndex와 pageCount는 함께 제공되어야 합니다.");
  if (sourceIndex !== null && (sourceIndex < 1 || sourceCount < 1 || sourceIndex > sourceCount)) addIssue(issues, "invalid_source_metadata", issuePath, "sourceIndex/sourceCount 범위가 올바르지 않습니다.");
  if (pageIndex !== null && (pageIndex < 1 || pageCount < 1 || pageIndex > pageCount)) addIssue(issues, "invalid_page_metadata", issuePath, "pageIndex/pageCount 범위가 올바르지 않습니다.");
  const uncertainValue = source.uncertain;
  const uncertain = Array.isArray(uncertainValue) ? uncertainValue : [];
  if (uncertainValue !== undefined && !Array.isArray(uncertainValue)) addIssue(issues, "invalid_uncertain_data", issuePath + ".uncertain", "uncertain은 배열이어야 합니다.");
  if (uncertain.length) addIssue(issues, "uncertain_data", issuePath + ".uncertain", "확인이 필요한 불확실 데이터가 있습니다.");
  const normalized = {
    sourceId,
    sourceName: clean(source.sourceName || source.source_name || source.fileName || source.file_name),
    sourceIndex,
    sourceCount,
    pageIndex,
    pageCount,
    identity: pageIndex === null ? sourceId + "#source" : sourceId + "#page-" + pageIndex,
    title,
    day,
    date,
    track: [],
    field: [],
    uncertain,
    draftIndex: index + 1
  };
  normalized.track = rows(source.track || source.tracks).map((row, rowIndex) => normalizeRow(row, issuePath + ".track[" + rowIndex + "]", issues));
  normalized.field = rows(source.field || source.fields).map((row, rowIndex) => normalizeRow(row, issuePath + ".field[" + rowIndex + "]", issues));
  if (!normalized.track.length && !normalized.field.length) addIssue(issues, "empty_schedule_rows", issuePath, "트랙 또는 필드 행이 하나 이상 필요합니다.");
  normalized.source = { id: sourceId, name: normalized.sourceName, index: sourceIndex, count: sourceCount };
  normalized.page = { index: pageIndex, count: pageCount };
  return normalized;
}

function draftList(value) {
  const source = asObject(value);
  if (Array.isArray(value)) return value;
  if (Array.isArray(source.drafts)) return source.drafts;
  if (Array.isArray(source.days)) return source.days;
  if (source.track || source.tracks || source.field || source.fields) return [source];
  return [];
}

function reviewResponse(issues) {
  return {
    status: "needs_human_review",
    action: "correct_json_and_resubmit",
    message: "시간표 AI JSON에 확인이 필요한 항목이 있습니다. JSON의 원본/페이지 식별자, 날짜, 행 필드를 확인한 뒤 다시 제출해주세요.",
    issues
  };
}

function validateDraftPackage(value) {
  const issues = [];
  const drafts = draftList(value).map((item, index) => normalizeDraft(item, index, issues));
  if (!drafts.length) addIssue(issues, "empty_drafts", "drafts", "시간표 draft가 하나 이상 필요합니다.");
  const identities = new Set();
  for (const draft of drafts) {
    if (identities.has(draft.identity)) addIssue(issues, "duplicate_identity", draft.identity, "원본/페이지 식별자가 중복됩니다.");
    identities.add(draft.identity);
  }
  return { ok: issues.length === 0, drafts, issues, response: issues.length ? reviewResponse(issues) : null };
}

function normalizeDrafts(value) {
  const result = validateDraftPackage(value);
  if (!result.ok) throw new ContractError("NEEDS_HUMAN_REVIEW", result.response.message, result.response);
  return result.drafts;
}

function parseArgs(argv) {
  const args = { appUrl: process.env.KAAF_RESULT_CARD_URL || "https://kaaf-result-card-maker.onrender.com/", outDir: process.env.KAAF_SCHEDULE_OUTPUT_DIR || "/Users/ahnhyeonji/.hermes/image_cache/schedule-cards", outDirExplicit: false };
  const valueFor = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new ContractError("MISSING_OPTION_VALUE", option + " 값이 필요합니다.");
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.jsonPath = valueFor(index++, token);
    else if (token === "--latest-file") args.latest = true;
    else if (token === "--app-url") args.appUrl = valueFor(index++, token);
    else if (token === "--out-dir") { args.outDir = valueFor(index++, token); args.outDirExplicit = true; }
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help") args.help = true;
    else throw new ContractError("UNKNOWN_OPTION", "지원하지 않는 옵션입니다: " + token + ". AI/vision JSON 입력만 사용하세요.");
  }
  if (args.jsonPath && args.latest) throw new ContractError("CONFLICTING_INPUTS", "--json과 --latest-file 중 하나만 지정하세요.");
  return args;
}

function buildVerification({ sourcePath, appUrl, runDir, drafts, files, renderedDrafts }) {
  const draftByIdentity = new Map(drafts.map((draft) => [draft.identity, draft]));
  const expectedPngs = renderedDrafts.reduce((total, item) => total + item.pageCount, 0);
  const kindsByIdentity = new Map();
  const invalid = files.filter((file) => {
    const draft = draftByIdentity.get(file.identity);
    const metadataMatches = draft && [
      ["sourceId", draft.sourceId],
      ["sourceIndex", draft.sourceIndex],
      ["sourceCount", draft.sourceCount],
      ["sourcePageIndex", draft.pageIndex],
      ["sourcePageCount", draft.pageCount]
    ].every(([key, expected]) => !Object.prototype.hasOwnProperty.call(file, key) || file[key] === expected);
    if (file.kind) {
      const kinds = kindsByIdentity.get(file.identity) || new Set();
      kinds.add(file.kind);
      kindsByIdentity.set(file.identity, kinds);
    }
    return !file.size || file.size.width !== 1080 || file.size.height !== 1350 || !metadataMatches;
  });
  const coverageOk = drafts.every((draft) => {
    const kinds = kindsByIdentity.get(draft.identity);
    return kinds && kinds.has("cover") && kinds.has("content");
  });
  const renderedOk = renderedDrafts.length === drafts.length && renderedDrafts.every((item) => item.pageCount >= 2 && draftByIdentity.has(item.identity));
  return {
    ok: expectedPngs > 0 && renderedOk && coverageOk && files.length === expectedPngs && invalid.length === 0,
    source: path.resolve(sourcePath),
    appUrl,
    runDir: runDir ? path.resolve(runDir) : null,
    counts: { drafts: drafts.length, renderedDrafts: renderedDrafts.length, expectedPngs, downloadedPngs: files.length },
    drafts: drafts.map((draft) => ({ identity: draft.identity, sourceId: draft.sourceId, sourceIndex: draft.sourceIndex, sourceCount: draft.sourceCount, pageIndex: draft.pageIndex, pageCount: draft.pageCount, day: draft.day })),
    renderedDrafts,
    files,
    uncertain: drafts.flatMap((draft) => draft.uncertain.map((item) => ({ identity: draft.identity, item }))),
    invalid
  };
}

module.exports = { BROWSER_CONTRACT, ContractError, buildVerification, normalizeDrafts, parseArgs, reviewResponse, validateDraftPackage };
