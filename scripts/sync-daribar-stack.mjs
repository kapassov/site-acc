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

// PostgreSQL owns every storefront read. Publish the immutable catalogue run,
// then build an availability run that is bound to that exact catalogue run.
await run("scripts/sync-daribar-catalog.mjs");
await run("scripts/sync-daribar-pharmacies.mjs");
await run("scripts/publish-daribar-catalog.mjs");
await run("scripts/sync-daribar-availability.mjs");
