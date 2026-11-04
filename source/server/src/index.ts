import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono";
import { Server as SocketServer } from "socket.io";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { pool } from "./db/client.js";
import { setRealtimeServer } from "./realtime.js";
import { readStoredFile } from "./standalone-sdk.js";
import { handler as legacyApi } from "../../backend/index.js";
import { removeSubscriptionsByConnection } from "../../backend/realtime-subscribers.js";
import { startStandaloneJobs } from "./jobs.js";

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

// Better Auth routes use the same origin and cookie session as the web application.
app.all("/api/auth/*", (context) => auth.handler(context.req.raw));

// Health and readiness are deliberately public for container orchestration.
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

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

app.get("/api/notifications/public-key", async (context) => {
  const session = await getSession(context.req.raw);
  if (!session?.user) {
    return context.json({ error: "auth_required" }, 401);
  }
  return context.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
});

app.post("/api/notifications/subscribe", async (context) => {
  const session = await getSession(context.req.raw);
  if (!session?.user) {
    return context.json({ error: "auth_required" }, 401);
  }

  const body = await context.req.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = body.keys && typeof body.keys === "object" ? body.keys : null;
  const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh : "";
  const authKey = keys && typeof keys.auth === "string" ? keys.auth : "";

  if (
    !endpoint.startsWith("https://") ||
    endpoint.length > 4096 ||
    !p256dh ||
    !authKey
  ) {
    return context.json({ error: "invalid_push_subscription" }, 400);
  }

  await pool.query(
    `insert into web_push_subscriptions (user_id, endpoint, subscription)
     values ($1, $2, $3::jsonb)
     on conflict (endpoint)
     do update set
       user_id = excluded.user_id,
       subscription = excluded.subscription,
       updated_at = now()`,
    [session.user.id, endpoint, JSON.stringify(body)]
  );

  return context.json({ subscribed: true }, 201);
});

app.delete("/api/notifications/subscribe", async (context) => {
  const session = await getSession(context.req.raw);
  if (!session?.user) {
    return context.json({ error: "auth_required" }, 401);
  }
  const body = await context.req.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (endpoint) {
    await pool.query(
      "delete from web_push_subscriptions where user_id = $1 and endpoint = $2",
      [session.user.id, endpoint]
    );
  }
  return context.json({ unsubscribed: true });
});

// Attachment links are short-lived HMAC tokens created only after the legacy
// endpoint has verified workspace membership and the attachment record.
app.get("/api/files/download", async (context) => {
  const token = context.req.query("token") || "";
  try {
    const file = await readStoredFile(token);
    const inline = file.contentType.startsWith("image/") || file.contentType === "application/pdf";
    const safeName = file.fileName.replace(/["\\r\\n]/g, "_");
    return new Response(file.content, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return context.json({ error: "attachment_link_invalid_or_expired" }, 404);
  }
});

// Existing NOC domain routes now execute on Hono and the local PostgreSQL
// adapter. Business validation remains in the domain modules.
app.route("/", legacyApi);

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

const socketServer = new SocketServer(server, {
  path: "/socket.io",
  cors: {
    origin: env.WEB_ORIGIN,
    credentials: true
  },
  transports: ["websocket", "polling"]
});

setRealtimeServer(socketServer);

let backgroundJobs: Awaited<ReturnType<typeof startStandaloneJobs>> | null = null;
void startStandaloneJobs().then((jobs) => {
  backgroundJobs = jobs;
}).catch((error: unknown) => {
  console.error("background_jobs_start_failed", error instanceof Error ? error.message : "unknown");
});

socketServer.use(async (socket, next) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(socket.handshake.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.userId = session.user.id;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

socketServer.on("connection", (socket) => {
  console.info("realtime_connected", {
    socketId: socket.id,
    userId: socket.data.userId
  });
  socket.on("disconnect", () => {
    void removeSubscriptionsByConnection(socket.id).catch((error: unknown) => {
      console.warn(
        "realtime_subscription_cleanup_failed",
        error instanceof Error ? error.message : "unknown"
      );
    });
  });
});

const shutdown = (signal: string) => {
  console.log("noc_api_shutdown", { signal });
  socketServer.close(() => {
    void (async () => {
      if (backgroundJobs) await backgroundJobs.stop();
      await pool.end();
      process.exit(0);
    })();
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

export { app, socketServer };
