const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /accept="[^"]*application\/pdf/);
assert.match(html, /multiple/);
assert.match(app, /loadPdfCanvases/);
assert.match(app, /inferScheduleImageMeta/);
assert.doesNotMatch(app, /lines\.slice\(0, 2\)/);

console.log(JSON.stringify({ ok: true, checks: ["pdf-input", "multiple-input", "pdf-renderer", "file-metadata", "multiline-no-truncation"] }));
