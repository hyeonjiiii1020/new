const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const helperPath = path.resolve(__dirname, "../telegram_schedule_card.js");
const originalArgv = process.argv;
process.argv = [process.argv[0], helperPath, "--self-test"];
const helper = require(helperPath);
process.argv = originalArgv;

function draft(index, overrides = {}) {
  return {
    sourceId: `album-source-${index}`,
    sourceName: `schedule-${index}.json`,
    sourceIndex: index,
    sourceCount: 5,
    pageIndex: 1,
    pageCount: 1,
    title: "2026 전국육상경기대회",
    day: `제${index}일 경기`,
    date: `2026. 9. ${13 + index}.`,
    track: [{ time: "08:00", event: "100m", division: "남고", round: "결승" }],
    field: [],
    ...overrides
  };
}

function fiveSourcePackage() {
  return { drafts: [1, 2, 3, 4, 5].map((index) => draft(index)) };
}

{
  const normalized = helper.normalizeDrafts(fiveSourcePackage());
  assert.equal(normalized.length, 5);
  assert.deepEqual(normalized.map((item) => item.sourceId), [
    "album-source-1",
    "album-source-2",
    "album-source-3",
    "album-source-4",
    "album-source-5"
  ]);
  assert.deepEqual(normalized.map((item) => item.day), [
    "제1일 경기",
    "제2일 경기",
    "제3일 경기",
    "제4일 경기",
    "제5일 경기"
  ]);
  assert.equal(normalized[4].sourceCount, 5);
  assert.equal(normalized[0].pageIndex, 1);
  assert.equal(normalized[0].pageCount, 1);
  assert.equal(normalized[0].identity, "album-source-1#page-1");
}

{
  const missingMetadata = helper.validateDraftPackage({
    drafts: [draft(1, { sourceId: "", day: "" })]
  });
  assert.equal(missingMetadata.ok, false);
  assert.equal(missingMetadata.response.status, "needs_human_review");
  assert.equal(missingMetadata.response.action, "correct_json_and_resubmit");
  assert.match(missingMetadata.response.message, /확인/);
  assert.ok(missingMetadata.issues.some((issue) => issue.code === "missing_source_id"));
  assert.ok(missingMetadata.issues.some((issue) => issue.code === "missing_day"));
  assert.equal(missingMetadata.drafts[0].day, "");
}

{
  const uncertain = helper.validateDraftPackage({
    drafts: [draft(1, { uncertain: [{ field: "date", value: "2026. 9. 14.", note: "OCR uncertain" }] })]
  });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.response.status, "needs_human_review");
  assert.equal(uncertain.response.action, "correct_json_and_resubmit");
  assert.ok(uncertain.issues.some((issue) => issue.code === "uncertain_data"));
}

{
  const malformedUncertain = helper.validateDraftPackage({
    drafts: [draft(1, { uncertain: { field: "date", value: "unknown" } })]
  });
  assert.equal(malformedUncertain.ok, false);
  assert.ok(malformedUncertain.issues.some((issue) => issue.code === "invalid_uncertain_data"));
}

{
  const invalidFields = helper.validateDraftPackage({
    drafts: [draft(1, {
      track: [{ time: "99:80", event: "", division: "", round: "" }]
    })]
  });
  assert.equal(invalidFields.ok, false);
  assert.ok(invalidFields.issues.some((issue) => issue.code === "invalid_time"));
  assert.ok(invalidFields.issues.some((issue) => issue.code === "missing_event"));
  assert.ok(invalidFields.issues.some((issue) => issue.code === "missing_division"));
}

{
  const invalidMetadata = helper.validateDraftPackage({
    drafts: [draft(1, { sourceIndex: "1", sourceCount: 5, pageIndex: 0, pageCount: 1 })]
  });
  assert.equal(invalidMetadata.ok, false);
  assert.ok(invalidMetadata.issues.some((issue) => issue.code === "invalid_source_metadata"));
  assert.ok(invalidMetadata.issues.some((issue) => issue.code === "invalid_page_metadata"));
}

{
  assert.throws(
    () => helper.parseArgs(["--file", "schedule.jpg"]),
    (error) => error.code === "UNKNOWN_OPTION" && /--file/.test(error.message)
  );
  assert.throws(
    () => helper.parseArgs(["--photo"]),
    (error) => error.code === "UNKNOWN_OPTION" && /photo/.test(error.message)
  );
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaaf-timetable-runs-"));
  try {
    const dayPackages = [draft(1, { day: "제1일 경기" }), draft(2, { day: "제2일 경기" })];
    const runDirs = dayPackages.map(() => helper.prepareOutputDir({ outDir: tempDir, outDirExplicit: false }));
    assert.notEqual(runDirs[0], runDirs[1]);
    assert.equal(path.dirname(runDirs[0]), path.resolve(tempDir));
    assert.equal(path.dirname(runDirs[1]), path.resolve(tempDir));
    const pageName = "01_same-page-name.png";
    const verificationName = "verification.json";
    dayPackages.forEach((item, index) => {
      fs.writeFileSync(path.join(runDirs[index], pageName), item.day);
      fs.writeFileSync(path.join(runDirs[index], verificationName), JSON.stringify({ day: item.day }));
    });
    assert.equal(fs.readFileSync(path.join(runDirs[0], pageName), "utf8"), "제1일 경기");
    assert.equal(fs.readFileSync(path.join(runDirs[1], pageName), "utf8"), "제2일 경기");
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDirs[0], verificationName), "utf8")).day, "제1일 경기");
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDirs[1], verificationName), "utf8")).day, "제2일 경기");
    const explicitDir = path.join(tempDir, "explicit");
    assert.equal(helper.parseArgs([]).outDirExplicit, false);
    assert.equal(helper.parseArgs(["--out-dir", explicitDir]).outDirExplicit, true);
    assert.equal(helper.prepareOutputDir({ outDir: explicitDir, outDirExplicit: true }), path.resolve(explicitDir));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaaf-timetable-intake-"));
  const pngPaths = [];
  try {
    for (let index = 0; index < 6; index += 1) {
      const filePath = path.join(tempDir, `${index + 1}.png`);
      const header = Buffer.alloc(24);
      header.write("PNG", 1, "ascii");
      header.writeUInt32BE(1080, 16);
      header.writeUInt32BE(1350, 20);
      fs.writeFileSync(filePath, header);
      pngPaths.push(filePath);
    }
    const files = pngPaths.map((filePath, index) => ({
      path: filePath,
      size: helper.pngSize(filePath),
      sourceId: `album-source-${Math.floor(index / 2) + 1}`,
      sourceIndex: Math.floor(index / 2) + 1,
      sourceCount: 5,
      pageIndex: 1,
      pageCount: 1,
      draftIndex: Math.floor(index / 2) + 1,
      identity: `album-source-${Math.floor(index / 2) + 1}#page-1`,
      outputPageIndex: (index % 2) + 1,
      outputPageCount: 2,
      kind: index % 2 === 0 ? "cover" : "content",
      page: index + 1
    }));
    const normalizedDrafts = helper.normalizeDrafts({ drafts: [draft(1), draft(2), draft(3)] });
    const verification = helper.buildVerification({
      sourcePath: path.join(tempDir, "drafts.json"),
      appUrl: "http://127.0.0.1:5173/",
      runDir: tempDir,
      drafts: normalizedDrafts,
      files,
      renderedDrafts: [
        { draftIndex: 1, pageCount: 2, identity: "album-source-1#page-1" },
        { draftIndex: 2, pageCount: 2, identity: "album-source-2#page-1" },
        { draftIndex: 3, pageCount: 2, identity: "album-source-3#page-1" }
      ]
    });
    assert.equal(verification.ok, true);
    assert.equal(verification.runDir, path.resolve(tempDir));
    assert.equal(verification.counts.downloadedPngs, 6);
    assert.equal(verification.counts.drafts, 3);
    assert.equal(verification.files.every((file) => file.size.width === 1080 && file.size.height === 1350), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    "multi-day-five-source-normalization",
    "metadata-review",
    "uncertain-review",
    "uncertain-shape-review",
    "invalid-fields",
    "invalid-metadata",
    "unknown-cli-flags",
    "two-day-run-isolation",
    "png-count-size-verification"
  ]
}));
