/* ============================================================
 * NodeFM Station — Submit Music Page
 *
 * Public listener-facing submission entry point.
 * ============================================================ */

import { PageShell } from '../components/PageShell';
import { SubmitMusicForm } from '../features/listener-submissions/components/SubmitMusicForm';

export default function SubmitMusicPage() {
  return (
    <PageShell title="Submit Music">
      <SubmitMusicForm />
    </PageShell>
  );
}
