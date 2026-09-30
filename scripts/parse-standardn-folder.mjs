#!/usr/bin/env node
/**
 * Read-only parser for bounded Standard-N catalogue exports kept under a local
 * installation folder. Supports CSV/TSV/TXT and JSON/NDJSON without requiring
 * access to the live Firebird process. The result is written atomically.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOTS = [String.raw`C:\Standart-N`, String.raw`C:\Standart-N_DEMO`];
const MAX_DEPTH = 7;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const CANDIDATE_NAME = /(ware|product|goods|tovar|catalog|price|stock|остат|товар|прайс)/iu;
const SUPPORTED = new Set([".csv", ".tsv", ".txt", ".json", ".ndjson"]);

const ALIASES = {
  sku: ["sku", "id", "wareid", "ware_id", "goodid", "good_id", "partid", "part_id", "код", "кодтовара", "код_товара"],
  name: ["name", "sname", "title", "product", "ware", "наименование", "наименованиетовара", "наименование_товара", "товар"],
  price: ["price", "retailprice", "retail_price", "retailamount", "retail_amount", "цена", "розничнаяцена", "розничная_цена"],
  quantity: ["quantity", "qty", "stock", "availablequantity", "available_quantity", "остаток", "количество"],
  barcode: ["barcode", "barcode1", "bcode", "origbcodeizg", "orig_bcode_izg", "штрихкод", "штрих_код"],
  pharmacy: ["pharmacyid", "pharmacy_id", "locationid", "location_id", "apteka", "аптека", "кодаптеки", "код_аптеки"],
};

function text(value) {
  return value == null ? "" : String(value).normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
function key(value) {
  return text(value).toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9]+/giu, "");
}
function finite(value) {
  const normalized = text(value).replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 && number < 100_000_000_000 ? number : null;
}
function pick(row, names) {
  const entries = new Map(Object.entries(row || {}).map(([column, value]) => [key(column), value]));
  for (const name of names) if (entries.has(key(name))) return entries.get(key(name));
  return undefined;
}

export function normalizeStandardNRow(row, sourceFile = "") {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const standardSku = text(pick(row, ALIASES.sku));
  const name = text(pick(row, ALIASES.name));
  if (!standardSku || !name || standardSku.length > 160 || name.length > 1000) return null;
  const price = finite(pick(row, ALIASES.price));
  const quantity = finite(pick(row, ALIASES.quantity));
  return {
    standard_sku: standardSku,
    name,
    barcode: text(pick(row, ALIASES.barcode)).slice(0, 250),
    price,
    quantity,
    pharmacy_id: text(pick(row, ALIASES.pharmacy)).slice(0, 160),
    source_file: basename(sourceFile),
  };
}

function delimiterFor(header) {
  const candidates = [";", "\t", ",", "|"];
  return candidates.map((delimiter) => [delimiter, header.split(delimiter).length])
    .sort((left, right) => right[1] - left[1])[0][0];
}
function parseDelimitedLine(line, delimiter) {
  const fields = [];
  let current = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      fields.push(current); current = "";
    } else current += character;
  }
  fields.push(current);
  return fields;
}
function decodedText(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const replacements = (utf8.match(/�/g) || []).length;
  return replacements > 2 ? new TextDecoder("windows-1251").decode(buffer) : utf8;
}
export function parseDelimited(textContent) {
  const lines = textContent.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = delimiterFor(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(text);
  if (headers.length < 2) return [];
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function discoverFiles(root) {
  const found = [];
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length && found.length < MAX_FILES) {
    const { directory, depth } = queue.shift();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (found.length >= MAX_FILES) break;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) queue.push({ directory: path, depth: depth + 1 });
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (entry.isFile() && SUPPORTED.has(extension) && CANDIDATE_NAME.test(entry.name)) found.push(path);
    }
  }
  return found.sort((left, right) => left.localeCompare(right, "ru"));
}

async function fileRows(path) {
  const details = await stat(path);
  if (!details.isFile() || details.size < 2 || details.size > MAX_FILE_BYTES) throw new Error("unsupported_file_size");
  const buffer = await readFile(path);
  const content = decodedText(buffer);
  const extension = extname(path).toLowerCase();
  if (extension === ".ndjson") return content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (extension === ".json") {
    const payload = JSON.parse(content);
    if (Array.isArray(payload)) return payload;
    for (const field of ["products", "wares", "goods", "items", "rows", "data"]) {
      if (Array.isArray(payload?.[field])) return payload[field];
    }
    return [];
  }
  return parseDelimited(content);
}

export async function parseStandardNFolder(sourceRoot) {
  const root = resolve(sourceRoot);
  const details = await stat(root).catch(() => null);
  if (!details?.isDirectory() || root === parse(root).root) throw new Error("standardn_folder_invalid");
  const files = await discoverFiles(root);
  const products = new Map();
  const diagnostics = [];
  for (const path of files) {
    try {
      const rows = await fileRows(path);
      let accepted = 0;
      for (const raw of rows) {
        const row = normalizeStandardNRow(raw, path);
        if (!row) continue;
        const identity = `${row.pharmacy_id}\u0000${row.standard_sku}\u0000${row.barcode}`;
        const current = products.get(identity);
        if (!current || (row.quantity ?? -1) > (current.quantity ?? -1)) products.set(identity, row);
        accepted++;
      }
      diagnostics.push({ file: path.slice(root.length + 1), rows: rows.length, accepted });
    } catch (error) {
      diagnostics.push({ file: path.slice(root.length + 1), rows: 0, accepted: 0,
        error: error instanceof Error ? error.message : "parse_failed" });
    }
  }
  const rows = [...products.values()].sort((left, right) => left.standard_sku.localeCompare(right.standard_sku, "ru"));
  const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { source_root: root, generated_at: new Date().toISOString(), complete: files.length > 0,
    files_scanned: files.length, products: rows, product_count: rows.length, sha256: hash, diagnostics };
}

async function main(args = process.argv.slice(2)) {
  const sourceIndex = args.indexOf("--source"), outputIndex = args.indexOf("--output");
  let source = sourceIndex >= 0 ? args[sourceIndex + 1] : "";
  if (!source) {
    for (const candidate of DEFAULT_ROOTS) {
      if ((await stat(candidate).catch(() => null))?.isDirectory()) { source = candidate; break; }
    }
  }
  const output = outputIndex >= 0 ? args[outputIndex + 1] : source ? join(source, "standardn-local-catalog.json") : "";
  if (!source || !output || !isAbsolute(output)
      || args.some((arg, index) => !["--source", "--output"].includes(arg) && index !== sourceIndex + 1 && index !== outputIndex + 1)) {
    throw new Error("Usage: node scripts/parse-standardn-folder.mjs [--source C:\\Standart-N] --output C:\\safe\\standardn-local-catalog.json");
  }
  const result = await parseStandardNFolder(source);
  const destination = resolve(output), temporary = `${destination}.${process.pid}.tmp`;
  if (dirname(destination) === parse(destination).root) throw new Error("unsafe_output_path");
  await writeFile(temporary, JSON.stringify(result, null, 2), { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, destination); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  console.log(JSON.stringify({ output: destination, complete: result.complete, files: result.files_scanned,
    products: result.product_count, sha256: result.sha256 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "standardn_parse_failed"); process.exitCode = 1; });
}


