import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('noc-incident-desk-migrations'))");
    await client.query(`
      create table if not exists app_schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort((left, right) => left.localeCompare(right));

    for (const name of files) {
      const alreadyApplied = await client.query(
        "select 1 from app_schema_migrations where name = $1",
        [name]
      );
      if (alreadyApplied.rowCount) {
        console.info("migration_skipped", { name });
        continue;
      }

      const source = await readFile(join(migrationsDirectory, name), "utf8");
      await client.query("begin");
      try {
        await client.query(source);
        await client.query(
          "insert into app_schema_migrations (name) values ($1)",
          [name]
        );
        await client.query("commit");
        console.info("migration_applied", { name });
      } catch (cause) {
        await client.query("rollback");
        throw cause;
      }
    }

    console.info("database_migrations_complete", { count: files.length });
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext('noc-incident-desk-migrations'))");
    } catch {
      // Connection may already be invalid after a database failure.
    }
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(
    "database_migration_failed",
    error instanceof Error ? error.message : "unknown error"
  );
  process.exitCode = 1;
});
