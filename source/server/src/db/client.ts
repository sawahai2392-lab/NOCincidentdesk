import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "noc-incident-desk"
});

pool.on("error", (error: Error) => {
  console.error("postgres_pool_error", error.message);
});

export const db = drizzle({ client: pool });
