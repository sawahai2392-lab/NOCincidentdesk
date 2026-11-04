import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { pool } from "./db/client.js";

const app = new Hono();

app.use("*", secureHeaders());
app.use("/api/*", logger());
app.use(
  "/api/*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"]
  })
);

// Better Auth owns its authentication routes; domain authorization remains in API services.
app.all("/api/auth/*", (context) => auth.handler(context.req.raw));

app.get("/api/health/live", (context) =>
  context.json({
    status: "ok",
    service: "noc-incident-desk-api",
    timestamp: new Date().toISOString()
  })
);

app.get("/api/health/ready", async (context) => {
  try {
    await pool.query("select 1");
    return context.json({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch {
    return context.json(
      {
        status: "not_ready",
        database: "unavailable"
      },
      503
    );
  }
});

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "not_found",
        message: "API route not found"
      }
    },
    404
  )
);

app.onError((error, context) => {
  console.error("api_unhandled_error", {
    method: context.req.method,
    path: context.req.path,
    message: error.message
  });

  return context.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected server error occurred"
      }
    },
    500
  );
});

const server = serve(
  {
    fetch: app.fetch,
    port: env.API_PORT,
    hostname: "127.0.0.1"
  },
  (info) => {
    console.log("noc_api_listening", {
      host: info.address,
      port: info.port,
      environment: env.NODE_ENV
    });
  }
);

const shutdown = (signal: string) => {
  console.log("noc_api_shutdown", { signal });
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

export { app };
