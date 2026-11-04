import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardPaste, Clock3, Plus } from 'lucide-react';
import { newId, type ProgressItem } from './domain';
import { parseProgressLog, type ParsedProgressUpdate } from './progress-autoparse';

type Props = {
    dispatchTime: string;
    progress: ProgressItem[];
    onApply: (items: ProgressItem[]) => void;
};

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const progressKey = (item: { date: string; time: string; text: string }) => [
    item.date,
    item.time,
    normalizeText(item.text)
].join('|');

const formatDate = (value: string) => {
    if (!value) return 'Menunggu Dispatch Time';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

export default function ProgressAutoparsePanel({ dispatchTime, progress, onApply }: Props) {
    const [source, setSource] = useState('');

    const parsed = useMemo(
        () => parseProgressLog(source, dispatchTime),
        [source, dispatchTime]
    );

    const additions = useMemo(() => {
        const seen = new Set(progress.map(progressKey));
        const unique: ParsedProgressUpdate[] = [];

        for (const row of parsed.updates) {
            const key = progressKey(row);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(row);
        }

        return unique;
    }, [parsed.updates, progress]);

    const duplicateCount = parsed.updates.length - additions.length;
    const hasSource = Boolean(source.trim());

    const applyUpdates = () => {
        if (!parsed.dispatchDate || !additions.length) return;

        const batchId = newId();
        const items: ProgressItem[] = additions.map(row => ({
            id: newId(),
            date: row.date,
            time: row.time,
            text: row.text,
            pic: '',
            milestone: '',
            autoparseBatchId: batchId,
            autoparseDayOffset: row.dayOffset
        }));

        onApply(items);
        setSource('');
    };

    return (
        <section className='progress-autoparse' aria-label='Progress Update Autoparse'>
            <header className='progress-autoparse-head'>
                <div className='progress-autoparse-brand'>
                    <span className='progress-autoparse-icon'><ClipboardPaste size={16} /></span>
                    <div>
                        <strong>Progress Update Autoparse</strong>
                        <p>Paste banyak update sekaligus. Tanggal mengikuti Dispatch Time dan pergantian hari dibaca otomatis.</p>
                    </div>
                </div>
                <span className='progress-autoparse-tag'>DISPATCH-BASED</span>
            </header>

            <textarea
                className='progress-autoparse-input'
                rows={4}
                value={source}
                onChange={event => setSource(event.target.value)}
                placeholder={'17:10 Team OTW lokasi, ETA 180 menit\n19:31 Team prepare check JC\n00:38 Hasil OTDR di JC: putus di 500m\nMTI CIREBON-SUMEDANG\n✅ DWDM HUAWEI\n❌ HSP'}
                aria-label='Paste progress log untuk diparse'
                spellCheck={false}
            />

            {hasSource ? (
                <>
                    <div className='progress-autoparse-footer'>
                        <div className='progress-autoparse-stats'>
                            <span><b>{parsed.updates.length}</b> update terdeteksi</span>
                            <span><b>{parsed.dayRollovers}</b> pergantian hari</span>
                            <span><b>{parsed.continuationLines}</b> baris lanjutan</span>
                        </div>
                        <button
                            type='button'
                            className='progress-autoparse-add'
                            onClick={applyUpdates}
                            disabled={!parsed.dispatchDate || additions.length === 0}
                        >
                            <Plus size={14} />
                            Tambah {additions.length} update
                        </button>
                    </div>

                    {!parsed.dispatchDate ? (
                        <div className='progress-autoparse-note warning'>
                            <AlertCircle size={14} />
                            Isi Dispatch Time yang valid terlebih dahulu agar tanggal update bisa ditentukan.
                        </div>
                    ) : null}

                    {duplicateCount > 0 ? (
                        <div className='progress-autoparse-note'>
                            <CheckCircle2 size={14} />
                            {duplicateCount} update duplikat akan dilewati.
                        </div>
                    ) : null}

                    {parsed.preambleLines.length > 0 ? (
                        <div className='progress-autoparse-note warning'>
                            <AlertCircle size={14} />
                            {parsed.preambleLines.length} baris sebelum timestamp pertama tidak dimasukkan.
                        </div>
                    ) : null}

                    {parsed.ignoredLines.length > 0 ? (
                        <div className='progress-autoparse-note warning'>
                            <AlertCircle size={14} />
                            {parsed.ignoredLines.length} baris memiliki timestamp atau deskripsi yang tidak valid.
                        </div>
                    ) : null}

                    {parsed.updates.length > 0 ? (
                        <details className='progress-autoparse-preview' open>
                            <summary>Preview hasil parsing · {parsed.updates.length} update</summary>
                            <div className='progress-autoparse-preview-list'>
                                {parsed.updates.map((row, index) => (
                                    <article className='progress-autoparse-preview-row' key={row.time + '-' + index}>
                                        <div className='progress-autoparse-preview-meta'>
                                            <strong>{row.time}</strong>
                                            <span>{formatDate(row.date)}</span>
                                        </div>
                                        <p>{row.text}</p>
                                    </article>
                                ))}
                            </div>
                        </details>
                    ) : (
                        <div className='progress-autoparse-note'>
                            <Clock3 size={14} />
                            Belum ada baris dengan timestamp HH:MM yang dikenali.
                        </div>
                    )}
                </>
            ) : (
                <div className='progress-autoparse-hint'>
                    <Clock3 size={14} />
                    Tempel log berformat jam seperti 17:10. Preview akan muncul otomatis sebelum ditambahkan ke timeline.
                </div>
            )}
        </section>
    );
}