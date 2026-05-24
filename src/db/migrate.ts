import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool, closePool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(__dirname, "../../migrations/001_init.sql");

async function migrate() {
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
  console.log("Database migration complete");
}

migrate()
  .catch((error) => {
    console.error("Database migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
