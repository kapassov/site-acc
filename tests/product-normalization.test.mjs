import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProductIdentity } from "../src/lib/product-normalization.ts";

test("normalizes Peptide Bio aliases only for products from the product family", () => {
  assert.deepEqual(
    normalizeProductIdentity({
      name: "Кардиоген Peptide Bio капс. 200 мг №60",
      brand: "Peptide Bio",
      barcode: "4603423001089",
      slug: "kardiogen-peptide-bio-200mg-60-kaps",
    }),
    { name: "Кардиоген Пептид Био капс. 200 мг №60", brand: "Пептид Био" },
  );

  assert.equal(
    normalizeProductIdentity({ name: "Бронхоген 200мг капс. №60", brand: "Peptides", barcode: "4603423001096" }).name,
    "Бронхоген Пептид Био 200мг капс. №60",
  );

  assert.equal(
    normalizeProductIdentity({ name: "Пептидный крем", brand: "Other", barcode: "123" }).brand,
    "Other",
  );
});

test("repairs the known Pankragen record using its exact barcode", () => {
  assert.deepEqual(
    normalizeProductIdentity({
      name: "Жидкий уголь Комплекс с пектином для детей саше 7г №10",
      brand: "Peptide Bio",
      barcode: "4603423001072",
      slug: "pankragen-peptide-bio-200mg-60-kaps",
    }),
    { name: "Панкраген Пептид Био капс. 200 мг №60", brand: "Пептид Био" },
  );
});