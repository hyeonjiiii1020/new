#!/usr/bin/env node
"use strict";

const { main } = require("./telegram_result_watch 2.js");

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exitCode = 1;
});
