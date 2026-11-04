import { read, utils, type WorkBook } from 'xlsx';

export type RouteMasterPair = {
  systemKey: string;
  routeSegment: string;
};

export type SheetHeaderDetection = {
  systemKeyColumn?: string;
  routeSegmentColumn?: string;
};

const excelText = (value: unknown) => String(value ?? '').trim();

const normalizeHeader = (value: unknown) =>
  excelText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const systemKeyHeaderScore = (value: unknown) => {
  const normalized = normalizeHeader(value);

  if (normalized === 'system key' || normalized === 'sytem key') return 100;
  if (normalized === 'main system key') return 20;
  if (normalized.includes('system key') || normalized.includes('sytem key')) return 50;

  return 0;
};

const isSystemKeyHeader = (value: unknown) => systemKeyHeaderScore(value) > 0;

const isRouteSegmentHeader = (value: unknown) => {
  const normalized = normalizeHeader(value);

  return normalized === 'segment route'
    || normalized === 'segmen route'
    || normalized === 'route segment'
    || normalized.includes('segment route');
};

const columnIndexToLetter = (index: number) => {
  let value = '';

  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    value = String.fromCharCode(65 + ((current - 1) % 26)) + value;
  }

  return value;
};

const columnLetterToIndex = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return -1;

  return normalized.split('').reduce(
    (sum, char) => sum * 26 + char.charCodeAt(0) - 64,
    0,
  ) - 1;
};

const workbookParseOptions = {
  type: 'array' as const,
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  bookDeps: false,
  bookVBA: false,
  WTF: false,
};

export const parseWorkbookSheet = (buffer: ArrayBuffer, sheetName: string) =>
  read(buffer, { ...workbookParseOptions, sheets: sheetName });

export const worksheetRowCount = (workbook: WorkBook, sheetName: string) => {
  const ref = workbook.Sheets[sheetName]?.['!ref'];
  if (!ref) return 0;

  const range = utils.decode_range(ref);
  return Math.max(0, range.e.r - range.s.r + 1);
};

export const detectSheetHeaders = (
  workbook: WorkBook,
  sheetName: string,
): SheetHeaderDetection => {
  const sheet = workbook.Sheets[sheetName];
  const ref = sheet?.['!ref'];
  if (!sheet || !ref) return {};

  const range = utils.decode_range(ref);
  let systemKeyColumn: string | undefined;
  let systemKeyScore = 0;
  let routeSegmentColumn: string | undefined;

  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 60); row += 1) {
    for (let col = range.s.c; col <= Math.min(range.e.c, range.s.c + 120); col += 1) {
      const cell = sheet[utils.encode_cell({ r: row, c: col })] as
        | { w?: string; v?: unknown }
        | undefined;
      const value = cell?.w ?? cell?.v;
      const score = systemKeyHeaderScore(value);

      if (score > systemKeyScore) {
        systemKeyScore = score;
        systemKeyColumn = columnIndexToLetter(col);
      }

      if (!routeSegmentColumn && isRouteSegmentHeader(value)) {
        routeSegmentColumn = columnIndexToLetter(col);
      }
    }
  }

  return { systemKeyColumn, routeSegmentColumn };
};

export const chooseInitialMasterSheet = (sheetNames: string[]) =>
  sheetNames.find((name) => /^foa active$/i.test(name.trim()))
  || sheetNames.find((name) => /foa\s*active/i.test(name))
  || sheetNames.find((name) => /foa/i.test(name))
  || sheetNames[0]
  || '';

export const extractRouteMasterPairs = (
  workbook: WorkBook | null,
  sheetName: string,
  systemKeyColumn: string,
  routeSegmentColumn: string,
): RouteMasterPair[] => {
  const sheet = workbook?.Sheets[sheetName];
  const ref = sheet?.['!ref'];
  const systemIndex = columnLetterToIndex(systemKeyColumn);
  const routeIndex = columnLetterToIndex(routeSegmentColumn);
  if (!sheet || !ref || systemIndex < 0 || routeIndex < 0) return [];

  const range = utils.decode_range(ref);
  const seen = new Set<string>();
  const pairs: RouteMasterPair[] = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const systemCell = sheet[utils.encode_cell({ r: row, c: systemIndex })] as
      | { w?: string; v?: unknown }
      | undefined;
    const routeCell = sheet[utils.encode_cell({ r: row, c: routeIndex })] as
      | { w?: string; v?: unknown }
      | undefined;
    const systemKey = excelText(systemCell?.w ?? systemCell?.v);
    const routeSegment = excelText(routeCell?.w ?? routeCell?.v);

    if (
      !systemKey
      || !routeSegment
      || isSystemKeyHeader(systemKey)
      || isRouteSegmentHeader(routeSegment)
    ) {
      continue;
    }

    const key = `${systemKey}\u0001${routeSegment}`;
    if (seen.has(key)) continue;

    seen.add(key);
    pairs.push({ systemKey, routeSegment });
    if (pairs.length >= 20000) break;
  }

  return pairs;
};
