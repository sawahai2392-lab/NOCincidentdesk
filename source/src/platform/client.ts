import { io as createSocket, type Socket } from "socket.io-client";

type ApiResponse<T> = { data: T };
type ApiError = Error & {
  status?: number;
  response?: { status: number; data: Record<string, unknown> };
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();

  if (!response.ok) {
    const payload =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : { message: String(data || response.statusText) };
    const nested =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : payload;
    const error = new Error(
      String(nested.message || nested.code || response.statusText || "Request failed")
    ) as ApiError;
    error.status = response.status;
    error.response = {
      status: response.status,
      data: {
        ...payload,
        error: nested.code || nested.error || payload.error || "request_failed"
      }
    };
    throw error;
  }

  return { data: data as T };
}

export const api = {
  get: <T = any>(path: string) => request<T>("GET", path),
  post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T = any>(path: string, body?: unknown) => request<T>("DELETE", path, body)
};

async function getSession() {
  const result = await request<{
    user?: { id?: string; name?: string; email?: string; image?: string };
    session?: { id?: string; token?: string };
  }>("GET", "/api/auth/get-session");
  return result.data;
}

export const auth = {
  async getAccessToken(): Promise<string | null> {
    const session = await getSession();
    return session.session?.token || session.session?.id || null;
  },
  async getUser() {
    const session = await getSession();
    if (!session.user) return null;
    return {
      userId: session.user.id || "",
      name: session.user.name || "",
      email: session.user.email || "",
      picture: session.user.image || undefined
    };
  },
  async signInWithEmail(input: { email: string; password: string }) {
    await request("POST", "/api/auth/sign-in/email", {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      callbackURL: window.location.origin
    });
    return await this.getUser();
  },
  async signUpWithEmail(input: { name: string; email: string; password: string }) {
    await request("POST", "/api/auth/sign-up/email", {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      callbackURL: window.location.origin
    });
    return await this.getUser();
  },
  async signIn(options?: { scope?: string }) {
    const result = await request<{ url?: string; redirect?: boolean; user?: unknown }>(
      "POST",
      "/api/auth/sign-in/social",
      {
        provider: "google",
        callbackURL: window.location.href,
        scopes: options?.scope?.split(/\s+/).filter(Boolean),
        disableRedirect: true
      }
    );
    if (!result.data.url) {
      throw new Error("Google OAuth belum dikonfigurasi atau URL login tidak tersedia.");
    }
    window.location.assign(result.data.url);
    return { user: result.data.user || null };
  },
  async signOut() {
    await request("POST", "/api/auth/sign-out", {});
  }
};

export const image = {
  async resizeIfNeeded(
    file: File,
    options: {
      maxDimension?: number;
      maxPixels?: number;
      quality?: number;
      mimeType?: string;
    } = {}
  ) {
    const maxDimension = options.maxDimension ?? 2200;
    const maxPixels = options.maxPixels ?? 3_600_000;
    const quality = options.quality ?? 0.95;
    const mimeType = options.mimeType ?? "image/jpeg";
    const bitmap = await createImageBitmap(file);

    try {
      const pixelScale = Math.sqrt(maxPixels / (bitmap.width * bitmap.height));
      const dimensionScale =
        maxDimension / Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, pixelScale, dimensionScale);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("image_canvas_unavailable");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);

      const dataUrl = canvas.toDataURL(mimeType, quality);
      return {
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        mimeType,
        width,
        height
      };
    } finally {
      bitmap.close();
    }
  }
};

const INVITE_QUERY_KEY = "invite";
const INVITE_STORAGE_KEY = "nocdesk.pendingInvite";

export const invitesClient = {
  getPendingCode(): string | null {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(INVITE_QUERY_KEY)?.trim();
    if (fromUrl) {
      sessionStorage.setItem(INVITE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(INVITE_STORAGE_KEY);
  },
  clearPendingCode() {
    sessionStorage.removeItem(INVITE_STORAGE_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete(INVITE_QUERY_KEY);
    window.history.replaceState({}, "", url);
  },
  buildJoinUrl(code: string, options: { path?: string } = {}) {
    const url = new URL(options.path || "/", window.location.origin);
    url.searchParams.set(INVITE_QUERY_KEY, code);
    return url.toString();
  }
};

type WorkspaceMessage = {
  type: string;
  payload?: Record<string, unknown>;
};

type WorkspaceSocket = {
  ready: Promise<void>;
  readonly connectionId: string | undefined;
  onMessage: (callback: (message: WorkspaceMessage) => void) => void;
  disconnect: () => void;
};

export const ws = {
  connect(): WorkspaceSocket {
    const socket: Socket = createSocket(window.location.origin, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 750,
      timeout: 10_000
    });

    const ready = new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (error) => reject(error));
    });

    return {
      ready,
      get connectionId() {
        return socket.id;
      },
      onMessage(callback) {
        socket.on("entity.update", callback);
      },
      disconnect() {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }
};

export const notifications = {
  async subscribe(): Promise<void> {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      throw new Error("Browser ini belum mendukung Web Push notification.");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Izin notifikasi browser belum diberikan.");
    }

    const { data } = await api.get<{ publicKey?: string }>("/api/notifications/public-key");
    if (!data.publicKey) {
      throw new Error("Server belum dikonfigurasi untuk Web Push.");
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js");
    const base64PublicKey = data.publicKey.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPublicKey = base64PublicKey.padEnd(
      Math.ceil(base64PublicKey.length / 4) * 4,
      "="
    );
    const applicationServerKey = Uint8Array.from(
      atob(paddedPublicKey),
      (character) => character.charCodeAt(0)
    );
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    await api.post("/api/notifications/subscribe", subscription.toJSON());
  }
};
