import type { Server as SocketServer } from "socket.io";

let realtimeServer: SocketServer | null = null;

export function setRealtimeServer(server: SocketServer) {
  realtimeServer = server;
}

export function sendRealtime(connectionIds: string[], payload: unknown) {
  if (!realtimeServer || connectionIds.length === 0) return;
  for (const connectionId of new Set(connectionIds)) {
    realtimeServer.to(connectionId).emit("entity.update", payload);
  }
}
