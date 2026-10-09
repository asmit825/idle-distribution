import { useEffect, useRef, useState } from 'react';
import { roundService } from '../../storage/roundService';

export function DataPortabilityModal({ close }: { close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const run = async (operation: () => Promise<string>) => {
    setBusy(true); setMessage(''); setError('');
    try { setMessage(await operation()); setConfirmation(0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Saved data could not be updated. Please try again.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="storage-modal data-modal hud-panel" aria-label="Saved data"
    onCancel={event => { if (busy) event.preventDefault(); else close(); }}>
    <div className="storage-heading"><div><span className="eyebrow">BACKUP & RESTORE</span><h2>Saved data</h2></div>
      <button type="button" onClick={close} disabled={busy} autoFocus>Close saved data</button></div>
    <p>Your rounds, pallet builds, and personal bests live on this browser. Keep a backup to move them to another device.</p>
    <div className="data-actions">
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        const backup = await roundService.exportData();
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'idleDistribution-backup.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return `Exported ${backup.rounds.length} round${backup.rounds.length === 1 ? '' : 's'}.`;
      })}>Export All Data (.json)</button>
      <label className="import-file">Import Data (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void run(async () => {
          const count = await roundService.importData(await file.text());
          return `Imported ${count} round${count === 1 ? '' : 's'}.`;
        });
      }} /></label>
    </div>
    <p className="storage-note">Import merges new rounds into your history. Existing round IDs stay unchanged; personal bests are rebuilt from the combined history. Unsupported or invalid files leave your data untouched.</p>
    <div className="data-reset">
      {confirmation === 0 ? <button type="button" disabled={busy} onClick={() => setConfirmation(1)}>Clear All Saved Data</button>
        : <div role="group" aria-label="Confirm saved data deletion">
          <h3>{confirmation === 1 ? 'Clear your saved history?' : 'Permanently delete all saved rounds and bests?'}</h3>
          <p>{confirmation === 1 ? 'This removes every saved pallet and personal best on this browser. Export a backup first if you want to keep them.'
            : 'This cannot be undone without a backup. Your current game continues; future completed rounds will save normally.'}</p>
          <div className="data-actions">{confirmation === 1
            ? <button type="button" disabled={busy} onClick={() => setConfirmation(2)}>Continue to final confirmation</button>
            : <button type="button" disabled={busy} onClick={() => void run(async () => { await roundService.clear(); return 'All saved data cleared.'; })}>Delete saved rounds and bests</button>}
            <button type="button" disabled={busy} onClick={() => setConfirmation(0)}>Keep saved data</button></div>
        </div>}
    </div>
    <p role="status">{busy ? 'Working…' : message}</p>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
