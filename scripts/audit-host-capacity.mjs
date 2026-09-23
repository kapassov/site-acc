#!/usr/bin/env node
import os from "node:os";
import { statfs } from "node:fs/promises";
import { resolve } from "node:path";

const minimumCpu = Number(process.env.REQUIRED_CPU_COUNT || 8);
const minimumRamGb = Number(process.env.REQUIRED_RAM_GB || 16);
const minimumDiskGb = Number(process.env.REQUIRED_DISK_GB || 300);
const path = resolve(process.env.DEPLOY_DATA_PATH || process.cwd());
const disk = await statfs(path);
const cpu = os.cpus().length;
const ramGb = os.totalmem() / 1024 ** 3;
const diskGb = Number(disk.blocks) * Number(disk.bsize) / 1024 ** 3;
const freeDiskGb = Number(disk.bavail) * Number(disk.bsize) / 1024 ** 3;
const checks = {
  cpu: cpu >= minimumCpu,
  ram: ramGb >= minimumRamGb,
  disk: diskGb >= minimumDiskGb,
  freeDisk: freeDiskGb >= Math.min(20, minimumDiskGb * 0.1),
};
const report = { ok: Object.values(checks).every(Boolean), actual: { cpu, ramGb, diskGb, freeDiskGb },
  required: { cpu: minimumCpu, ramGb: minimumRamGb, diskGb: minimumDiskGb }, checks };
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.ok) process.exitCode = 1;

