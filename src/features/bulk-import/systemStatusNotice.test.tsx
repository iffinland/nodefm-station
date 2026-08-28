import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SystemStatusNotice } from './components/SystemStatusNotice';
import { ChecklistResourceItem } from './components/BulkImportWorkspace';

function renderTone(tone: 'info' | 'success' | 'warning' | 'error') {
  return renderToStaticMarkup(
    <SystemStatusNotice tone={tone} title="Publication status" detail="Supporting detail text" />,
  );
}

describe('SystemStatusNotice', () => {
  it('keeps title and detail in separate block elements', () => {
    const html = renderToStaticMarkup(
      <SystemStatusNotice
        tone="warning"
        title="Metadata publication is still required."
        detail="Export and select the metadata JSON file."
      />,
    );

    expect(html).toContain('class="system-status__title"');
    expect(html).toContain('class="system-status__detail"');
    expect(html).toContain('Metadata publication is still required.');
    expect(html).toContain('Export and select the metadata JSON file.');
    expect(html).not.toMatch(/still required\.Export/);
  });

  it('renders distinct semantic tones with text labels', () => {
    expect(renderTone('info')).toContain('system-status--info');
    expect(renderTone('info')).toContain('INFO');
    expect(renderTone('success')).toContain('system-status--success');
    expect(renderTone('success')).toContain('SUCCESS');
    expect(renderTone('warning')).toContain('system-status--warning');
    expect(renderTone('warning')).toContain('WARNING');
    expect(renderTone('error')).toContain('system-status--error');
    expect(renderTone('error')).toContain('ERROR');
  });

  it('supports long wrapping text without an adjacent text node', () => {
    const detail =
      'This is a deliberately long status message that should wrap safely on narrow mobile screens without overlapping nearby controls.';
    const html = renderToStaticMarkup(
      <SystemStatusNotice tone="info" title="Audio source ready" detail={detail} />,
    );

    expect(html).toContain(detail);
    expect(html).toContain('system-status__detail');
  });

  it('uses alert semantics for errors', () => {
    const html = renderToStaticMarkup(
      <SystemStatusNotice tone="error" title="Publication failed" detail="Try again." />,
    );
    expect(html).toContain('role="alert"');
  });
});

describe('publication checklist item', () => {
  it('shows the next required action for a pending cover step', () => {
    const html = renderToStaticMarkup(
      <ChecklistResourceItem
        label="Cover"
        state="native-source-required"
        message="Select the cover image you added to this Track."
        capabilityReady
        actionLabel="Select cover file"
        onAction={() => undefined}
      />,
    );

    expect(html).toContain('Select cover file');
    expect(html).toContain('system-status--warning');
    expect(html).toContain('Cover source required.');
  });
});
