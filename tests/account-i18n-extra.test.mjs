import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ACCOUNT_LAYOUT = new URL("../src/app/account/layout.tsx", import.meta.url);
const ACCOUNT_PAGE = new URL("../src/app/account/page.tsx", import.meta.url);
const BONUSES_PAGE = new URL("../src/app/account/bonuses/page.tsx", import.meta.url);
const ADDRESSES_PAGE = new URL("../src/app/account/addresses/page.tsx", import.meta.url);
const EXTRA_COPY = new URL("../src/lib/i18n/account-extra.ts", import.meta.url);

test("account surfaces derive supplemental copy from the reactive locale", async () => {
  const [layout, overview, bonuses, addresses, copy] = await Promise.all([
    readFile(ACCOUNT_LAYOUT, "utf8"),
    readFile(ACCOUNT_PAGE, "utf8"),
    readFile(BONUSES_PAGE, "utf8"),
    readFile(ADDRESSES_PAGE, "utf8"),
    readFile(EXTRA_COPY, "utf8"),
  ]);

  for (const source of [layout, overview, bonuses, addresses]) {
    assert.match(source, /accountExtraCopy\[lang\]/);
  }

  assert.match(copy, /export const accountExtraCopy: Record<Lang, AccountExtraCopy>/);
  for (const locale of ["ru", "kz", "en"]) {
    assert.match(copy, new RegExp(`\\n  ${locale}: \\{`));
  }
});

test("account fallback labels and number formatting follow the active locale", async () => {
  const [layout, overview, bonuses, addresses] = await Promise.all([
    readFile(ACCOUNT_LAYOUT, "utf8"),
    readFile(ACCOUNT_PAGE, "utf8"),
    readFile(BONUSES_PAGE, "utf8"),
    readFile(ADDRESSES_PAGE, "utf8"),
  ]);

  assert.match(layout, /copy\.customerFallback/);
  assert.match(overview, /copy\.customerFallback/);
  assert.doesNotMatch(`${layout}\n${overview}\n${bonuses}`, /toLocaleString\("ru-RU"\)/);
  assert.match(layout, /toLocaleString\(copy\.locale\)/);
  assert.match(overview, /toLocaleString\(copy\.locale\)/);
  assert.match(bonuses, /toLocaleString\(copy\.locale\)/);
  assert.match(bonuses, /copy\.bonusUnavailable/);
  assert.match(bonuses, /copy\.bonusHistoryEmpty/);
  assert.match(addresses, /aria-label=\{copy\.removeAddress\}/);
});
