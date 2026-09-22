import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SERVICE = new URL("../deploy/systemd/inkar-shop-catalog-sync.service", import.meta.url);
const TIMER = new URL("../deploy/systemd/inkar-shop-catalog-sync.timer", import.meta.url);

test("Medusa catalogue sync runs once per day while stock remains request-time Daribar data", async () => {
  const [service, timer] = await Promise.all([
    readFile(SERVICE, "utf8"),
    readFile(TIMER, "utf8"),
  ]);

  assert.match(service, /sync-medusa-catalog\.mjs --apply --page-size 500 --mark-missing-inactive/);
  assert.match(service, /Prices and product content come from Medusa/);
  assert.match(service, /pharmacy stock is resolved separately through Daribar v3/);
  assert.match(timer, /OnCalendar=\*-\*-\* 02:30:00 Asia\/Almaty/);
  assert.match(timer, /Persistent=true/);
  assert.doesNotMatch(timer, /OnUnitInactiveSec|OnUnitActiveSec/);
});
