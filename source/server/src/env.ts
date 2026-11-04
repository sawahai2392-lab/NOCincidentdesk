import { config } from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:noc-admin@example.com"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("NOC Incident Desk <no-reply@example.com>")
});

export const env = envSchema.parse(process.env);
export type Environment = z.infer<typeof envSchema>;
