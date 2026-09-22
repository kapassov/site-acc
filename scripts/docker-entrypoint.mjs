#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let activeChild = null;
let terminationSignal = null;
let stage = "startup";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    activeChild = child;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = null;
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      finish(() => {
        if (code === 0) resolve();
        else {
          const error = new Error(`${command} ${args.join(" ")} failed (${signal || code})`);
          error.exitCode = code;
          error.signal = signal;
          reject(error);
        }
      });
    });
  });
}

function forwardSignal(signal) {
  terminationSignal ||= signal;
  process.exitCode = signalExitCodes[terminationSignal] || 1;
  const child = activeChild;
  if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.once("SIGTERM", () => forwardSignal("SIGTERM"));
process.once("SIGINT", () => forwardSignal("SIGINT"));

async function main() {
  if (String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim()) {
    stage = "database migration";
    console.log("[startup] applying database migrations");
    await run(process.execPath, ["scripts/db-migrate.mjs"]);
  }
  if (terminationSignal) return;

  stage = "server";
  await run(process.execPath, ["server.js"]);
}

main().catch((error) => {
  if (terminationSignal) {
    process.exitCode = signalExitCodes[terminationSignal] || 1;
    return;
  }
  console.error(`[startup] ${stage} failed`, error);
  process.exitCode = Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
});
