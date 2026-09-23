#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function run(script, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(process.cwd(), script), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(signal ? `daribar_stack_${signal}` : `daribar_stack_exit_${code}`));
    });
  });
}

// The file is atomically renamed first. Typesense then switches its alias to
// that exact snapshot. PostgreSQL publishes last; until it does, the runtime's
// generatedAt guard rejects the newer index instead of mixing two versions.
await run("scripts/sync-daribar-catalog.mjs");
await run("scripts/sync-typesense-catalog.mjs", ["--retain-versions", "3"]);
await run("scripts/publish-daribar-catalog.mjs");

