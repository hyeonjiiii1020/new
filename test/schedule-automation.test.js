const assert = require("node:assert/strict");
const { formatRows, parseScheduleDraft } = require("../public/schedule-automation.js");

const result = parseScheduleDraft(JSON.stringify({
  day: "제3일 경기",
  date: "2026. 6. 29.(월)",
  track: [
    { time: "08:00", event: "400m", division: "실업(남)", round: "결승" },
    { time: "08:10", event: "\"", division: "\"", round: "\"" }
  ],
  field: []
}));

assert.equal(result.ok, true);
assert.deepEqual(result.draft.track[1], {
  section: "트랙경기",
  time: "08:10",
  eventName: "400m",
  division: "실업(남)",
  round: "결승",
  p: "",
  column: ""
});

const columnResult = parseScheduleDraft(JSON.stringify({
  track: {
    left: [{ time: "08:00", event: "100m", division: "남고", round: "결승" }],
    right: [{ time: "14:00", event: "200m", division: "여고", round: "결승" }]
  }
}));
assert.equal(columnResult.ok, true);
assert.equal(columnResult.draft.track[0].column, "left");
assert.equal(columnResult.draft.track[1].column, "right");
assert.match(formatRows(columnResult.draft.track), /14:00 \| 200m \| 여고 \| 결승 \| right/);

const blankRoundResult = parseScheduleDraft(JSON.stringify({
  track: [{ time: "10:00", event: "4x400mR", division: "남고", round: "" }]
}));
assert.equal(blankRoundResult.ok, true);
assert.equal(blankRoundResult.draft.track[0].round, "");

console.log(JSON.stringify({ ok: true, checks: ["ditto-values-carry-forward"] }));
