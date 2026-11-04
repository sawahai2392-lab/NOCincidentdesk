import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { env } from "./env.js";
import { pool } from "./db/client.js";
import { sendRealtime } from "./realtime.js";

type LegacyRecord = Record<string, unknown> & { id: string };
type ListOptions = { limit?: number; nextToken?: string };
type StoredFile = { path: string; content: string; contentType?: string };
type AuthenticatedUser = { userId: string; email?: string; name?: string; picture?: string };

function asId(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function parseOffset(token?: string) {
  if (!token) return 0;
  try {
    const value = Number(Buffer.from(token, "base64url").toString("utf8"));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function responseJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function json(value: unknown, status = 200) {
  return responseJson(value, status);
}

export function error(code: string, status = 400) {
  return responseJson({ error: code, message: code }, status);
}

/**
 * Temporary document API adapter. This maps the former namespaced records
 * into PostgreSQL JSONB while the product's domain tables are migrated.
 */
export const db = {
  async list<T extends Record<string, unknown>>(namespace: string, options: ListOptions = {}) {
    const limit = Math.max(1, Math.min(2000, Math.floor(options.limit || 100)));
    const offset = parseOffset(options.nextToken);
    const result = await pool.query<{ document_id: string; payload: T }>(
      `select document_id, payload
         from legacy_documents
        where namespace = $1
        order by document_id asc
        limit $2 offset $3`,
      [namespace, limit + 1, offset]
    );
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((row) => ({
      ...row.payload,
      id: row.document_id
    })) as Array<T & { id: string }>;
    return {
      items,
      nextToken: hasMore ? Buffer.from(String(offset + limit)).toString("base64url") : undefined
    };
  },

  async get<T extends Record<string, unknown>>(namespace: string, ids: string[]) {
    if (!ids.length) return [] as Array<(T & { id: string }) | undefined>;
    const result = await pool.query<{ document_id: string; payload: T }>(
      `select document_id, payload
         from legacy_documents
        where namespace = $1 and document_id = any($2::text[])`,
      [namespace, ids]
    );
    const byId = new Map(result.rows.map((row) => [
      row.document_id,
      { ...row.payload, id: row.document_id } as T & { id: string }
    ]));
    return ids.map((id) => byId.get(id));
  },

  async add(namespace: string, records: Array<Record<string, unknown>>) {
    const ids: string[] = [];
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const record of records) {
        const id = randomUUID();
        const payload = { ...record };
        delete payload.id;
        await client.query(
          `insert into legacy_documents (namespace, document_id, payload)
           values ($1, $2, $3::jsonb)`,
          [namespace, id, JSON.stringify(payload)]
        );
        ids.push(id);
      }
      await client.query("commit");
      return ids;
    } catch (cause) {
      await client.query("rollback");
      throw cause;
    } finally {
      client.release();
    }
  },

  async update(namespace: string, updates: Array<{ id: string; record: Record<string, unknown> }>) {
    const results: boolean[] = [];
    for (const update of updates) {
      const payload = { ...update.record };
      delete payload.id;
      const result = await pool.query(
        `update legacy_documents
            set payload = $3::jsonb, updated_at = now()
          where namespace = $1 and document_id = $2`,
        [namespace, update.id, JSON.stringify(payload)]
      );
      results.push((result.rowCount || 0) > 0);
    }
    return results;
  },

  async delete(namespace: string, ids: string[]) {
    if (!ids.length) return [] as boolean[];
    const result = await pool.query<{ document_id: string }>(
      `delete from legacy_documents
        where namespace = $1 and document_id = any($2::text[])
        returning document_id`,
      [namespace, ids]
    );
    const removed = new Set(result.rows.map((row) => row.document_id));
    return ids.map((id) => removed.has(id));
  }
};

type RouteContext = {
  raw: Request;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  user?: AuthenticatedUser;
};

type RouteStep = (context: RouteContext) => Promise<Response | unknown> | Response | unknown;

export function requireAuth(): RouteStep {
  return async (context) => {
    const session = await auth.api.getSession({ headers: context.raw.headers });
    if (!session?.user) return error("auth_required", 401);
    context.user = {
      userId: session.user.id,
      email: session.user.email || "",
      name: session.user.name || "",
      picture: session.user.image || undefined
    };
    return null;
  };
}

export function router(routes: Record<string, RouteStep[]>) {
  // Import Hono lazily through the package's public API.
  const app = new (class {
    readonly instance: import("hono").Hono;
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.instance = new HonoRouter();
    }
  })();

  for (const [definition, steps] of Object.entries(routes)) {
    const separator = definition.indexOf(" ");
    const method = definition.slice(0, separator).toUpperCase();
    const path = definition.slice(separator + 1);
    app.instance.on(method, path, async (context) => {
      const url = new URL(context.req.url);
      const body =
        method === "GET" || method === "HEAD"
          ? {}
          : await context.req.json().catch(() => ({}));
      const routeContext: RouteContext = {
        raw: context.req.raw,
        params: context.req.param(),
        query: Object.fromEntries(url.searchParams.entries()),
        body
      };
      for (const step of steps) {
        const result = await step(routeContext);
        if (result instanceof Response) return result;
        if (result !== undefined && result !== null) return context.json(result);
      }
      return context.json({});
    });
  }

  return app.instance;
}

class InviteError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "InviteError";
  }
}

const hashInvite = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export const invites = {
  async create(input: {
    resourceType: string;
    authMode: string;
    actor: AuthenticatedUser;
    allowList: string[];
    expiresInSec: number;
    context: Record<string, unknown>;
  }) {
    if (input.resourceType !== "workspace") throw new InviteError("invalid_invite_resource");
    const workspaceId = asId(input.context.workspaceId);
    if (!workspaceId) throw new InviteError("invalid_workspace_invite");
    const email = (input.allowList[0] || "").trim().toLowerCase();
    if (!email) throw new InviteError("invite_email_required");
    const role = input.context.role === "supervisor" ? "supervisor" : "operator";
    await pool.query(
      `insert into workspaces (id, name, owner_user_id)
       values ($1, 'NOC Workspace', $2)
       on conflict (id) do nothing`,
      [workspaceId, input.actor.userId]
    );
    const code = randomBytes(32).toString("base64url");
    const tokenHash = hashInvite(code);
    await pool.query(
      `insert into workspace_invitations
        (token_hash, workspace_id, invited_email, invited_role, created_by, context, expires_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now() + ($7::int * interval '1 second'))`,
      [tokenHash, workspaceId, email, role, input.actor.userId, JSON.stringify(input.context), input.expiresInSec]
    );
    return { code };
  },

  async resolve(input: { code: string }) {
    const result = await pool.query<{
      workspace_id: string;
      invited_email: string;
      invited_role: string;
      context: Record<string, unknown>;
      expires_at: Date;
      redeemed_at: Date | null;
      revoked_at: Date | null;
    }>(
      `select workspace_id, invited_email, invited_role, context, expires_at, redeemed_at, revoked_at
         from workspace_invitations
        where token_hash = $1
        limit 1`,
      [hashInvite(input.code)]
    );
    const invite = result.rows[0];
    if (!invite) throw new InviteError("invite_not_found");
    if (invite.revoked_at) throw new InviteError("invite_revoked");
    if (invite.redeemed_at) throw new InviteError("invite_already_used");
    if (invite.expires_at.getTime() <= Date.now()) throw new InviteError("invite_expired");
    return {
      status: "active",
      resourceType: "workspace",
      allowList: [invite.invited_email],
      context: { ...invite.context, workspaceId: invite.workspace_id, role: invite.invited_role }
    };
  },

  async join(input: { code: string; actor: AuthenticatedUser }) {
    const tokenHash = hashInvite(input.code);
    const email = (input.actor.email || "").trim().toLowerCase();
    const result = await pool.query(
      `update workspace_invitations
          set redeemed_at = now()
        where token_hash = $1
          and lower(invited_email) = $2
          and redeemed_at is null
          and revoked_at is null
          and expires_at > now()
        returning workspace_id, invited_email, invited_role, context`,
      [tokenHash, email]
    );
    const invite = result.rows[0];
    if (!invite) throw new InviteError("invite_not_found");
    return {
      resourceType: "workspace",
      context: {
        ...(invite.context as Record<string, unknown>),
        workspaceId: invite.workspace_id,
        role: invite.invited_role
      }
    };
  }
};

export function isInviteError(value: unknown): value is InviteError {
  return value instanceof InviteError;
}

export const secrets = {
  async listSecretNames() {
    return env.GEMINI_API_KEY ? ["GEMINI_API_KEY"] : [];
  },
  async readSecret(name: string) {
    if (name !== "GEMINI_API_KEY" || !env.GEMINI_API_KEY) {
      throw new Error("secret_not_configured");
    }
    return env.GEMINI_API_KEY;
  }
};

function safeStoragePath(input: string) {
  const root = resolve(process.cwd(), env.STORAGE_LOCAL_DIR || ".data/uploads");
  const target = resolve(root, input);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new Error("invalid_storage_path");
  }
  return { root, target };
}

const signDownloadToken = (path: string, expiresAt: number) => {
  const payload = Buffer.from(JSON.stringify({ path, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

export async function readStoredFile(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("invalid_download_token");
  const expected = createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url");
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error("invalid_download_token");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    path: string;
    expiresAt: number;
  };
  if (!decoded.path || decoded.expiresAt <= Date.now()) throw new Error("expired_download_token");
  const { target } = safeStoragePath(decoded.path);
  const content = await readFile(target);
  const extension = extname(target).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return { content, contentType: mimeTypes[extension] || "application/octet-stream", fileName: basename(target) };
}

export const storage = {
  async write(files: StoredFile[]) {
    const written: boolean[] = [];
    for (const file of files) {
      const { target } = safeStoragePath(file.path);
      const content = Buffer.from(file.content.replace(/^data:[^;]+;base64,/, ""), "base64");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
      written.push(true);
    }
    return written;
  },
  async url(paths: string[]) {
    return paths.map((path) => ({
      url: `/api/files/download?token=${encodeURIComponent(signDownloadToken(path, Date.now() + 15 * 60 * 1000))}`
    }));
  },
  async delete(paths: string[]) {
    const deleted: boolean[] = [];
    for (const path of paths) {
      const { target } = safeStoragePath(path);
      await rm(target, { force: true });
      deleted.push(true);
    }
    return deleted;
  }
};

export const ws = {
  async send(connectionIds: string[], payload: unknown) {
    sendRealtime(connectionIds, payload);
  }
};

export const notifications = {
  async send(input: {
    userIds: string[];
    notification: { title: string; body: string };
    data?: Record<string, unknown>;
    ttlSeconds?: number;
  }) {
    if (!input.userIds.length) return;
    const rows = input.userIds.map((userId) => ({
      userId,
      title: input.notification.title.slice(0, 200),
      body: input.notification.body.slice(0, 500),
      payload: JSON.stringify({
        ...(input.data || {}),
        ttlSeconds: input.ttlSeconds || 3600
      })
    }));
    for (const row of rows) {
      await pool.query(
        `insert into user_notifications (user_id, title, body, payload)
         values ($1, $2, $3, $4::jsonb)`,
        [row.userId, row.title, row.body, row.payload]
      );
    }
  }
};

export const ai = {
  async extract(input: {
    content: string;
    prompt: string;
    schema: Record<string, unknown>;
    maxRetries?: number;
    maxTokens?: number;
    temperature?: number;
    thinkingMode?: string;
  }) {
    if (!env.GEMINI_API_KEY) {
      const failure = new Error("gemini_not_configured") as Error & { statusCode?: number };
      failure.statusCode = 503;
      throw failure;
    }
    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const maxAttempts = Math.max(1, Math.min(3, (input.maxRetries || 0) + 1));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await client.models.generateContent({
          model: env.GEMINI_MODEL,
          contents: [
            {
              role: "user",
              parts: [{ text: `${input.prompt}\n\nSOURCE:\n${input.content}` }]
            }
          ],
          config: {
            temperature: input.temperature ?? 0,
            maxOutputTokens: input.maxTokens ?? 4096,
            responseMimeType: "application/json",
            responseJsonSchema: input.schema
          } as Record<string, unknown>
        });
        const raw = result.text || "{}";
        return { data: JSON.parse(raw), attempts: attempt };
      } catch (cause) {
        lastError = cause;
        if (attempt === maxAttempts) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ai_extract_failed");
  }
};
