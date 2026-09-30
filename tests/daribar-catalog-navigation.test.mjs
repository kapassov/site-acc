import assert from "node:assert/strict";
import test from "node:test";

import { daribarNavigationTree } from "../src/lib/daribar/catalog-navigation.ts";

test("Daribar navigation exposes routed subcategories beneath primary groups", () => {
  const tree = daribarNavigationTree();
  const supplements = tree.find((node) => node.handle === "bady");
  const hygiene = tree.find((node) => node.handle === "gigiyena");

  assert.ok(supplements);
  assert.ok(hygiene);
  assert.ok(supplements.children.some((node) => node.handle === "bad-pri-prostude"));
  assert.ok(hygiene.children.some((node) => node.handle === "sredstva-zhenskoi-gigieni"));
});

test("directory-only Daribar groups remain addressable category routes", () => {
  const tree = daribarNavigationTree();
  const vitamins = tree.find((node) => node.handle === "vitaminy-i-mineraly");

  assert.ok(vitamins);
  assert.ok(vitamins.children.some((node) => node.handle === "vitamin-d"));
});
