import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeStandardNRow, parseDelimited, parseStandardNFolder } from "../scripts/parse-standardn-folder.mjs";

test("Standard-N row aliases preserve SKU, name, price, quantity and barcode", () => {
  assert.deepEqual(normalizeStandardNRow({ Код_товара: " 10001 ", Наименование: "Аспирин 100 мг №20",
    Цена: "1 250,50", Остаток: "7", Штрихкод: "460000000001" }, "wares.csv"), {
    standard_sku: "10001", name: "Аспирин 100 мг №20", barcode: "460000000001",
    price: 1250.5, quantity: 7, pharmacy_id: "", source_file: "wares.csv",
  });
});

test("delimited parser handles semicolons and quoted delimiters", () => {
  const rows = parseDelimited('sku;name;price\n100;"Крем; детский";990,5\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Крем; детский");
});

test("folder parser is bounded to catalogue-like exports and deduplicates stock rows", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "standardn-parser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "export"));
  await writeFile(join(root, "export", "wares.csv"), "sku;name;price;quantity;barcode\n100;Аспирин 100 мг №20;1200;3;4601\n100;Аспирин 100 мг №20;1200;5;4601\n", "utf8");
  await writeFile(join(root, "zkassa.log"), "sku;name\n999;ignore", "utf8");
  await writeFile(join(root, "product-extra.json"), JSON.stringify({ products: [{ sku: "200", name: "Гептрал 500 мг №5", price: 18000, quantity: 2 }] }), "utf8");
  const result = await parseStandardNFolder(root);
  assert.equal(result.complete, true);
  assert.equal(result.files_scanned, 2);
  assert.equal(result.product_count, 2);
  assert.equal(result.products.find((row) => row.standard_sku === "100").quantity, 5);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});


