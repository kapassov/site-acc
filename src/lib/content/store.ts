/**
 * Серверное хранилище витринного контента (общее для сайта и мобилки).
 *
 *  • Если задан DATABASE_URL (Postgres) — храним в ОБЩЕЙ БД (таблица cms_content,
 *    одна строка с JSON). Это боевой режим: переживает рестарты/несколько инстансов,
 *    общий с любым числом серверов. Подходит и под базу Medusa, и под отдельную/облачную.
 *  • Иначе (локальная разработка) — пишем .data/content.json рядом с проектом.
 *
 *  Загруженные медиа лежат в public/uploads (файловой системой). На одном VPS это ок;
 *  для нескольких инстансов вынести в объектное хранилище (S3) — см. DEPLOY.md.
 */
import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_CONTENT, normalizeContent, type Content } from "./defaults";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "content.json");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const ORPHAN_GRACE_MS = 60 * 60 * 1000; // не трогаем файлы свежее часа (вдруг загружены, но ещё не сохранены)

let cache: Content | null = null;
// Сериализуем записи, чтобы параллельные POST не побили хранилище на полузаписи.
let writeChain: Promise<void> = Promise.resolve();

// ── Postgres-бэкенд (общая БД) ──────────────────────────────────────────────
type PgPool = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ data: unknown }> }> };
let pool: PgPool | null = null;
let ensured: Promise<void> | null = null;

async function getPool(): Promise<PgPool> {
  if (pool) return pool;
  const { Pool } = await import("pg");
  // Облачные БД (Neon/Supabase/…) обычно требуют TLS; для своего VPS — без него.
  const needSsl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(DATABASE_URL);
  pool = new Pool({ connectionString: DATABASE_URL, ssl: needSsl ? { rejectUnauthorized: true } : undefined }) as unknown as PgPool;
  return pool;
}

async function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const p = await getPool();
      await p.query(
        "CREATE TABLE IF NOT EXISTS cms_content (id int PRIMARY KEY DEFAULT 1, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT cms_singleton CHECK (id = 1))",
      );
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

async function dbRead(): Promise<Content> {
  await ensureTable();
  const p = await getPool();
  const { rows } = await p.query("SELECT data FROM cms_content WHERE id = 1");
  return rows.length ? normalizeContent(rows[0].data as Partial<Content>) : DEFAULT_CONTENT;
}

async function dbWrite(c: Content): Promise<void> {
  await ensureTable();
  const p = await getPool();
  await p.query(
    "INSERT INTO cms_content (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
    [JSON.stringify(c)],
  );
}

// ── Файловый бэкенд (локальная разработка / без БД) ─────────────────────────
async function fileRead(): Promise<Content> {
  try {
    return normalizeContent(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return DEFAULT_CONTENT; // файла ещё нет — отдаём дефолт
  }
}

async function fileWrite(c: Content): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(c, null, 2), "utf8");
}

/** Удаляет из public/uploads файлы, на которые контент больше не ссылается
 *  (и которые старше grace-периода) — чтобы заменённые баннеры/сторис не копили мусор. */
async function cleanupOrphans(content: Content, now: number): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(UPLOAD_DIR);
  } catch {
    return; // папки нет — чистить нечего
  }
  const referenced = new Set<string>();
  for (const m of JSON.stringify(content).matchAll(/\/(?:api\/)?uploads\/([A-Za-z0-9._-]+)/g)) {
    referenced.add(m[1]);
  }
  await Promise.all(
    files.map(async (name) => {
      if (referenced.has(name)) return;
      const fp = path.join(UPLOAD_DIR, name);
      try {
        const st = await fs.stat(fp);
        if (now - st.mtimeMs < ORPHAN_GRACE_MS) return; // слишком свежий — пропускаем
        await fs.unlink(fp);
      } catch {/* гонка/занят — пропускаем */}
    }),
  );
}

export async function readContent(): Promise<Content> {
  if (cache) return cache;
  try {
    cache = DATABASE_URL ? await dbRead() : await fileRead();
  } catch (e) {
    console.error("[content/store] readContent failed, using defaults:", e);
    cache = DEFAULT_CONTENT; // БД/файл недоступны — отдаём дефолт, сайт не падает
  }
  return cache;
}

export async function writeContent(input: unknown): Promise<Content> {
  const c = normalizeContent(input as Partial<Content>);
  const currentWrite = writeChain.then(async () => {
    if (DATABASE_URL) await dbWrite(c);
    else await fileWrite(c);
    await cleanupOrphans(c, Date.now()); // подмести заменённые медиа
  });
  // Keep later writes serial even if this one fails, but let the current caller
  // observe the failure instead of returning a false-positive 200 response.
  writeChain = currentWrite.catch((e) => {
    console.error("[content/store] writeContent persist failed:", e);
  });
  await currentWrite;
  cache = c;
  return c;
}
