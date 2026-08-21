/* ============================================================
 * NodeFM Station — Submit Music Page
 *
 * Public listener-facing submission entry point.
 * ============================================================ */

import { useState } from 'react';
import { PageShell } from '../components/PageShell';
import { useAuth } from '../app/providers/authContext';
import { SubmitMusicForm } from '../features/listener-submissions/components/SubmitMusicForm';
import { BulkImportWorkspace } from '../features/bulk-import';

type SubmitMode = 'single' | 'bulk';

export default function SubmitMusicPage() {
  const [mode, setMode] = useState<SubmitMode>('single');
  const { auth } = useAuth();
  const submitterScope = auth.status === 'authenticated' ? (auth.address ?? auth.name ?? '') : '';

  return (
    <PageShell title="Submit Music">
      <div className="submit-music__mode-switch">
        <button
          className={`button ${mode === 'single' ? 'button--primary' : 'button--secondary'}`}
          type="button"
          onClick={() => setMode('single')}
        >
          Submit One Track
        </button>
        <button
          className={`button ${mode === 'bulk' ? 'button--primary' : 'button--secondary'}`}
          type="button"
          onClick={() => setMode('bulk')}
        >
          Bulk Submit Music
        </button>
      </div>

      {mode === 'single' ? (
        <SubmitMusicForm />
      ) : (
        <BulkImportWorkspace role="listener" scope={submitterScope} />
      )}
    </PageShell>
  );
}
