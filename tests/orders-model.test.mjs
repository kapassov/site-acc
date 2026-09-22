import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  orderCreatedOutboxKey,
  ordersStorageMode,
  orderStatusOutboxKey,
} from "../src/lib/orders/model.ts";

test("orders use files only when no PostgreSQL URL is configured", () => {
  assert.equal(ordersStorageMode(undefined, undefined), "file");
  assert.equal(ordersStorageMode("", "  "), "file");
  assert.equal(ordersStorageMode("postgres://orders", undefined), "postgres");
  assert.equal(ordersStorageMode(undefined, " postgres://orders "), "postgres");
});

test("Epharm creation idempotency is stable per order", () => {
  assert.equal(
    orderCreatedOutboxKey("order_01"),
    "epharm:site_order:order_01:created:v1",
  );
  assert.equal(orderCreatedOutboxKey("order_01"), orderCreatedOutboxKey("order_01"));
  assert.notEqual(orderCreatedOutboxKey("order_01"), orderCreatedOutboxKey("order_02"));
});

test("every order status revision gets a distinct outbox idempotency key", () => {
  const first = orderStatusOutboxKey("order_01", 2);
  const second = orderStatusOutboxKey("order_01", 3);
  assert.equal(first, "epharm:site_order:order_01:status:v2");
  assert.notEqual(first, second);
});

test("orders migration enforces durable idempotency and status revisions", async () => {
  const sql = await readFile(new URL("../db/migrations/004_site_orders.sql", import.meta.url), "utf8");
  assert.match(sql, /idempotency_key\s+text\s+NOT NULL UNIQUE/i);
  assert.match(sql, /source_order_id\s+text\s+NOT NULL UNIQUE/i);
  assert.match(sql, /status_version\s+integer\s+NOT NULL DEFAULT 1/i);
});
