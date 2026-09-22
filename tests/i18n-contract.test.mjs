import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { dict, langs } from "../src/lib/i18n/dict.ts";
import { CATALOG_DIRECTORY } from "../src/lib/catalog-directory.ts";
import { catalogCategoryName } from "../src/lib/i18n/catalog-categories.ts";

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const LANGUAGE_CONTEXT = new URL("../src/lib/i18n/LanguageContext.tsx", import.meta.url);
const HEADER = new URL("../src/components/layout/Header.tsx", import.meta.url);
const ROOT_LAYOUT = new URL("../src/app/layout.tsx", import.meta.url);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

test("RU, KZ and EN dictionaries expose the same complete non-empty key set", () => {
  assert.deepEqual(langs.map(({ code }) => code), ["ru", "kz", "en"]);
  const referenceKeys = Object.keys(dict.ru).sort();
  assert.ok(referenceKeys.length > 0);
  for (const { code } of langs) {
    assert.deepEqual(Object.keys(dict[code]).sort(), referenceKeys, `${code} dictionary keys drifted from RU`);
    for (const key of referenceKeys) {
      const value = dict[code][key];
      assert.equal(typeof value, "string", `${code}.${key} must be a string`);
      assert.ok(value.trim().length > 0, `${code}.${key} must not be empty`);
    }
  }
});

test("every literal translation key used by the application exists in every locale", async () => {
  const files = await sourceFiles(SOURCE_ROOT);
  const used = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
      const locations = used.get(match[1]) ?? [];
      locations.push(file);
      used.set(match[1], locations);
    }
  }
  assert.ok(used.size > 0, "no translation calls were discovered");
  for (const [key, locations] of used) {
    for (const { code } of langs) {
      assert.ok(Object.hasOwn(dict[code], key), `${code} is missing ${key}, used by ${locations.join(", ")}`);
    }
  }
});

test("switching language is reactive, persisted and initialized on the server", async () => {
  const [context, header, layout] = await Promise.all([
    readFile(LANGUAGE_CONTEXT, "utf8"),
    readFile(HEADER, "utf8"),
    readFile(ROOT_LAYOUT, "utf8"),
  ]);
  assert.match(context, /initialLang = "ru"/);
  assert.match(context, /useState<Lang>\(initialLang\)/);
  assert.match(context, /const setLang = useCallback\(\(l: Lang\) => \{[\s\S]*?setLangState\(l\)/);
  assert.match(context, /localStorage\.setItem\(KEY, lang\)/);
  assert.match(context, /document\.cookie = `\$\{KEY\}=\$\{lang\}/);
  assert.match(context, /document\.documentElement\.lang = lang === "kz" \? "kk" : lang/);
  assert.match(context, /const t = useCallback\([\s\S]*?, \[lang\]\)/);
  assert.doesNotMatch(context, /dict\.ru\[key\]/, "non-RU locales must not silently fall back to Russian");
  assert.match(context, /const plural = useCallback\([\s\S]*?\[lang\],[\s\S]*?\)/);
  assert.match(context, /LanguageContext\.Provider value=\{\{ lang, setLang, t, plural \}\}/);
  assert.match(layout, /await cookies\(\)/);
  assert.match(layout, /<html lang=\{documentLang\}/);
  assert.match(layout, /<LanguageProvider initialLang=\{initialLang\}>/);
  assert.match(header, /langs\.map\(\(l/);
  assert.match(header, /onClick=\{\(\) => setLang\(l\.code\)\}/);
  assert.match(header, /aria-pressed=\{lang === l\.code\}/);
});

test("a saved locale is restored only when it is supported", async () => {
  const context = await readFile(LANGUAGE_CONTEXT, "utf8");
  assert.match(context, /localStorage\.getItem\(KEY\) as Lang \| null/);
  assert.match(context, /if \(saved && dict\[saved\] && saved !== initialLang\)/);
  assert.match(context, /setLangState\(saved\)/);
  assert.match(context, /persistLanguage\(saved\)/);
  assert.match(context, /try \{[\s\S]*?localStorage\.getItem\(KEY\)[\s\S]*?\} catch/);
});

test("the new catalogue directory chrome has translations in all supported locales", () => {
  const keys = ["home.directory.title", "home.directory.sub", "home.directory.all", "home.directory.groupAll", "home.directory.sections", "home.directory.aria"];
  for (const { code } of langs) {
    for (const key of keys) {
      assert.ok(Object.hasOwn(dict[code], key), `${code} is missing ${key}`);
      assert.ok(dict[code][key].trim(), `${code}.${key} is empty`);
    }
  }
});

test("every storefront directory category has a localized label by stable handle", () => {
  const handles = CATALOG_DIRECTORY.flatMap((group) => [group.handle, ...group.children.map((child) => child.handle)]);
  handles.push("linzy", "intim", "drugoe", "zagar-i-zashita-ot-solnca");
  for (const handle of new Set(handles)) {
    for (const language of ["ru", "kz", "en"]) {
      const translated = catalogCategoryName(handle, "__missing__", language);
      assert.notEqual(translated, "__missing__", `${language} category label missing for ${handle}`);
      assert.ok(translated.trim(), `${language} category label empty for ${handle}`);
    }
  }
});
