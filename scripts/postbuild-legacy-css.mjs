import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const staticDir = path.resolve(distDir, "static");

function listCssFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listCssFiles(fullPath)
      : entry.isFile() && entry.name.endsWith(".css")
        ? [fullPath]
        : [];
  });
}

let transformed = 0;
for (const file of listCssFiles(staticDir)) {
  const source = fs.readFileSync(file, "utf8");
  const root = postcss.parse(source, { from: file });
  root.walkAtRules("layer", (rule) => {
    if (rule.nodes?.length) {
      rule.replaceWith(...rule.nodes);
    } else {
      rule.remove();
    }
  });

  // Tailwind 4 targets modern engines. Android 11 emulator WebView 83 does
  // not understand inset shorthands or individual transform properties.
  root.walkDecls((declaration) => {
    const cloneBefore = (properties) => {
      for (const [property, value] of properties) {
        declaration.cloneBefore({ prop: property, value });
      }
      declaration.remove();
    };

    if (declaration.prop === "inset") {
      const parts = postcss.list.space(declaration.value);
      const sides = parts.length === 1
        ? [parts[0], parts[0], parts[0], parts[0]]
        : parts.length === 2
          ? [parts[0], parts[1], parts[0], parts[1]]
          : parts.length === 3
            ? [parts[0], parts[1], parts[2], parts[1]]
            : parts;
      cloneBefore([["top", sides[0]], ["right", sides[1]], ["bottom", sides[2]], ["left", sides[3]]]);
    } else if (declaration.prop === "inset-inline") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["left", parts[0]], ["right", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "inset-block") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["top", parts[0]], ["bottom", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "inset-inline-start") {
      declaration.prop = "left";
    } else if (declaration.prop === "inset-inline-end") {
      declaration.prop = "right";
    } else if (declaration.prop === "inset-block-start") {
      declaration.prop = "top";
    } else if (declaration.prop === "inset-block-end") {
      declaration.prop = "bottom";
    } else if (declaration.prop === "margin-inline") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["margin-left", parts[0]], ["margin-right", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "padding-inline") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["padding-left", parts[0]], ["padding-right", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "margin-block") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["margin-top", parts[0]], ["margin-bottom", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "padding-block") {
      const parts = postcss.list.space(declaration.value);
      cloneBefore([["padding-top", parts[0]], ["padding-bottom", parts[1] ?? parts[0]]]);
    } else if (declaration.prop === "margin-inline-start") {
      declaration.prop = "margin-left";
    } else if (declaration.prop === "margin-inline-end") {
      declaration.prop = "margin-right";
    } else if (declaration.prop === "padding-inline-start") {
      declaration.prop = "padding-left";
    } else if (declaration.prop === "padding-inline-end") {
      declaration.prop = "padding-right";
    } else if (declaration.prop === "margin-block-start") {
      declaration.prop = "margin-top";
    } else if (declaration.prop === "margin-block-end") {
      declaration.prop = "margin-bottom";
    } else if (declaration.prop === "padding-block-start") {
      declaration.prop = "padding-top";
    } else if (declaration.prop === "padding-block-end") {
      declaration.prop = "padding-bottom";
    } else if (declaration.prop === "inline-size") {
      declaration.prop = "width";
    } else if (declaration.prop === "min-inline-size") {
      declaration.prop = "min-width";
    } else if (declaration.prop === "max-inline-size") {
      declaration.prop = "max-width";
    } else if (declaration.prop === "block-size") {
      declaration.prop = "height";
    } else if (declaration.prop === "min-block-size") {
      declaration.prop = "min-height";
    } else if (declaration.prop === "max-block-size") {
      declaration.prop = "max-height";
    } else if (declaration.prop === "translate") {
      declaration.prop = "transform";
      declaration.value = declaration.value === "none"
        ? "none"
        : "translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0))";
    } else if (declaration.prop === "scale") {
      declaration.prop = "transform";
      declaration.value = declaration.value === "none"
        ? "none"
        : "scale(var(--tw-scale-x, 1), var(--tw-scale-y, 1))";
    } else if (declaration.prop === "rotate") {
      declaration.prop = "transform";
      declaration.value = declaration.value === "none" ? "none" : `rotate(${declaration.value})`;
    }
  });

  fs.writeFileSync(file, root.toString(), "utf8");
  transformed += 1;
}

console.log(`Legacy CSS compatibility: ${transformed} file(s) transformed in ${distDir}.`);
