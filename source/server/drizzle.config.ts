import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy source/.env.example to source/.env first.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl
  },
  strict: true,
  verbose: true
});
