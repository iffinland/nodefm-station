/* ============================================================
 * NodeFM Station — Radio Public Copy Smoke Test
 *
 * Keeps the public schedule heading consistent with the corrected
 * "Upcoming Schedule" semantics without rendering the full page.
 * ============================================================ */

import { describe, expect, it } from 'vitest';

const radioPageSources = import.meta.glob('../pages/RadioPage.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const radioPageSource = radioPageSources['../pages/RadioPage.tsx'];

describe('public radio schedule copy', () => {
  it('uses the corrected Upcoming Schedule heading', () => {
    expect(radioPageSource).toContain('<h3>Upcoming Schedule</h3>');
  });

  it("no longer shows the misleading Today's Schedule heading", () => {
    expect(radioPageSource).not.toContain("Today's Schedule");
  });

  it('keeps the distinct Coming Up section unchanged', () => {
    expect(radioPageSource).toContain('<h3>Coming Up</h3>');
  });
});
