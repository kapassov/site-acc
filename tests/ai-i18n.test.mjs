import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aiChips, aiIntents, aiTrending } from "../src/lib/data/ai.ts";
import { aiCopy, findAiIntent } from "../src/lib/data/ai-copy.ts";

const CONSULTANT = new URL("../src/components/ai/AIConsultant.tsx", import.meta.url);
const LOCALES = ["ru", "kz", "en"];

function nonEmpty(value, location) {
  assert.equal(typeof value, "string", `${location} must be a string`);
  assert.ok(value.trim(), `${location} must not be empty`);
}

test("AI copy has complete RU, KZ and EN parity", () => {
  assert.deepEqual(Object.keys(aiCopy), LOCALES);
  const chipIds = Object.keys(aiCopy.ru.chips).sort();
  const intentIds = Object.keys(aiCopy.ru.intents).sort();
  const whyIds = Object.keys(aiCopy.ru.why).sort();

  for (const lang of LOCALES) {
    const copy = aiCopy[lang];
    nonEmpty(copy.userAvatar, `${lang}.userAvatar`);
    nonEmpty(copy.send, `${lang}.send`);
    assert.deepEqual(Object.keys(copy.chips).sort(), chipIds, `${lang} chip ids drifted`);
    assert.deepEqual(Object.keys(copy.intents).sort(), intentIds, `${lang} intent ids drifted`);
    assert.deepEqual(Object.keys(copy.why).sort(), whyIds, `${lang} rationale ids drifted`);

    for (const id of chipIds) {
      nonEmpty(copy.chips[id].label, `${lang}.chips.${id}.label`);
      nonEmpty(copy.chips[id].query, `${lang}.chips.${id}.query`);
    }
    for (const id of intentIds) {
      const intent = copy.intents[id];
      nonEmpty(intent.intro, `${lang}.intents.${id}.intro`);
      assert.ok(intent.keys.length > 0, `${lang}.intents.${id}.keys must not be empty`);
      intent.keys.forEach((key, index) => nonEmpty(key, `${lang}.intents.${id}.keys.${index}`));
      assert.equal(Boolean(intent.warn), Boolean(aiCopy.ru.intents[id].warn), `${lang}.intents.${id}.warn parity drifted`);
      if (intent.warn) nonEmpty(intent.warn, `${lang}.intents.${id}.warn`);
    }
    for (const id of whyIds) nonEmpty(copy.why[id], `${lang}.why.${id}`);
  }
});

test("stable AI ids connect every locale to the same recommendation model", () => {
  assert.deepEqual(aiIntents.map(({ id }) => id).sort(), Object.keys(aiCopy.ru.intents).sort());
  assert.deepEqual(aiChips.map(({ id }) => id).sort(), Object.keys(aiCopy.ru.chips).sort());

  for (const { id, intentId } of aiChips) {
    for (const lang of LOCALES) {
      assert.equal(findAiIntent(aiCopy[lang].chips[id].query, lang)?.id, intentId, `${lang}.${id} query must resolve its intent`);
    }
  }

  for (const pick of [...aiTrending, ...aiIntents.flatMap(({ picks }) => picks)]) {
    assert.ok(pick.match.length > 0, `${pick.whyId} must keep catalog match keys`);
    assert.ok(Object.hasOwn(aiCopy.ru.why, pick.whyId), `${pick.whyId} has no localized rationale`);
    assert.equal(Object.hasOwn(pick, "why"), false, "recommendations must not store rendered copy");
  }
});

test("AI chat stores semantic ids and resolves all generated copy from the active locale", async () => {
  const source = await readFile(CONSULTANT, "utf8");

  assert.match(source, /const \{ t, lang \} = useLang\(\)/);
  assert.match(source, /const locale = aiCopy\[lang\]/);
  assert.match(source, /botTextKey: "ai\.greet"/);
  assert.match(source, /botTextKey: "ai\.trendIntro"/);
  assert.match(source, /intentId: intent\.id/);
  assert.match(source, /botTextKey: "ai\.clarify"/);
  assert.match(source, /locale\.intents\[m\.intentId\]\.intro/);
  assert.match(source, /locale\.intents\[m\.intentId\]\.warn/);
  assert.match(source, /aiCopy\[lang\]\.why\[whyId\]/);
  assert.match(source, /locale\.chips\[m\.chipId\]\.query/);
  assert.match(source, /locale\.userAvatar/);
  assert.match(source, /aria-label=\{locale\.send\}/);
  assert.doesNotMatch(source, /text:\s*t\("ai\.(?:greet|trendIntro|clarify)"\)/, "translated assistant text must not be frozen in state");
  assert.doesNotMatch(source, /warn:\s*intent\.warn/, "translated warnings must not be frozen in state");
});
