export interface ParsedProgressUpdate {
    date: string;
    time: string;
    text: string;
    dayOffset: number;
}

export interface ProgressAutoparseResult {
    dispatchDate: string;
    updates: ParsedProgressUpdate[];
    dayRollovers: number;
    continuationLines: number;
    preambleLines: string[];
    ignoredLines: string[];
}

export const shiftIsoDate = (baseDate: string, dayOffset: number) => {
    const match = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !Number.isInteger(dayOffset)) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const base = new Date(Date.UTC(year, month - 1, day));

    if (
        base.getUTCFullYear() !== year ||
        base.getUTCMonth() !== month - 1 ||
        base.getUTCDate() !== day
    ) {
        return '';
    }

    const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
    return [
        String(shifted.getUTCFullYear()).padStart(4, '0'),
        String(shifted.getUTCMonth() + 1).padStart(2, '0'),
        String(shifted.getUTCDate()).padStart(2, '0')
    ].join('-');
};

export const parseProgressLog = (source: string, dispatchTime: string): ProgressAutoparseResult => {
    const candidateDate = dispatchTime.match(/^(\d{4}-\d{2}-\d{2})/);
    const dispatchDate = candidateDate ? shiftIsoDate(candidateDate[1], 0) : '';
    const updates: ParsedProgressUpdate[] = [];
    const preambleLines: string[] = [];
    const ignoredLines: string[] = [];

    let current: { time: string; dayOffset: number; text: string } | null = null;
    const dispatchClock = dispatchTime.match(/^\d{4}-\d{2}-\d{2}[T\s](\d{1,2}):([0-5]\d)/);
    const dispatchHour = dispatchClock ? Number(dispatchClock[1]) : -1;
    const dispatchMinute = dispatchClock ? Number(dispatchClock[2]) : -1;
    let previousMinute = dispatchHour >= 0 && dispatchHour <= 23 && dispatchMinute >= 0
        ? dispatchHour * 60 + dispatchMinute
        : -1;
    let dayOffset = 0;
    let continuationLines = 0;

    const flush = () => {
        if (!current) return;
        const text = current.text.trim();
        if (text) {
            updates.push({
                date: dispatchDate ? shiftIsoDate(dispatchDate, current.dayOffset) : '',
                time: current.time,
                text,
                dayOffset: current.dayOffset
            });
        }
        current = null;
    };

    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const match = line.match(/^(?:[-•▪◦]\s*)?(\d{1,2})[:.]([0-5]\d)(?::[0-5]\d)?\s*(?:[-–—|:]\s*)?(.*)$/);
        if (match) {
            const hour = Number(match[1]);
            const minute = Number(match[2]);
            const message = match[3].trim();

            if (hour > 23 || !message) {
                ignoredLines.push(line);
                continue;
            }

            flush();

            const minuteOfDay = hour * 60 + minute;
            if (previousMinute >= 0 && minuteOfDay < previousMinute) {
                dayOffset += 1;
            }
            previousMinute = minuteOfDay;

            current = {
                time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'),
                dayOffset,
                text: message
            };
            continue;
        }

        if (current) {
            current.text += '\n' + line;
            continuationLines += 1;
        } else {
            preambleLines.push(line);
        }
    }

    flush();

    return {
        dispatchDate,
        updates,
        dayRollovers: dayOffset,
        continuationLines,
        preambleLines,
        ignoredLines
    };
};