export interface IncidentPageCursor {
  updatedAt: number;
  id: string;
}

export function encodeIncidentPageCursor(cursor: IncidentPageCursor): string {
  if (!Number.isFinite(cursor.updatedAt) || !cursor.id.trim()) {
    throw new TypeError('Invalid incident page cursor.');
  }
  return String(Math.trunc(cursor.updatedAt)) + '~' + encodeURIComponent(cursor.id);
}

export function decodeIncidentPageCursor(token: string): IncidentPageCursor | null {
  if (typeof token !== 'string' || !token) return null;
  const separator = token.indexOf('~');
  if (separator <= 0 || separator === token.length - 1) return null;
  const updatedAt = Number(token.slice(0, separator));
  let id = '';
  try {
    id = decodeURIComponent(token.slice(separator + 1));
  } catch {
    return null;
  }
  if (!Number.isFinite(updatedAt) || updatedAt < 0 || !id.trim()) return null;
  return { updatedAt: Math.trunc(updatedAt), id };
}

export function mergeIncidentPage<T extends { id: string; updatedAt: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) =>
    b.updatedAt - a.updatedAt || b.id.localeCompare(a.id),
  );
}
