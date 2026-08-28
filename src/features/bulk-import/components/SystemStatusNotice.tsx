/* ============================================================
 * NodeFM Station — System Status Notice
 *
 * One consistent block presentation for publication-state feedback.
 * Semantic tone is expressed with a text label and icon, not color
 * alone. Title and detail are always separate elements so they can
 * never visually run together.
 * ============================================================ */

import type { ReactNode } from 'react';

export type SystemStatusTone = 'info' | 'success' | 'warning' | 'error';

type SystemStatusNoticeProps = {
  tone: SystemStatusTone;
  title: string;
  detail?: string | null;
  children?: ReactNode;
};

const TONE_LABEL: Record<SystemStatusTone, string> = {
  info: 'INFO',
  success: 'SUCCESS',
  warning: 'WARNING',
  error: 'ERROR',
};

const TONE_ICON: Record<SystemStatusTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '!',
  error: '✕',
};

export function SystemStatusNotice({
  tone,
  title,
  detail = null,
  children,
}: SystemStatusNoticeProps) {
  return (
    <div
      className={`system-status system-status--${tone}`}
      role={tone === 'error' ? 'alert' : tone === 'warning' ? 'status' : undefined}
    >
      <div className="system-status__marker" aria-hidden="true">
        <span className="system-status__icon">{TONE_ICON[tone]}</span>
        <span className="system-status__label">{TONE_LABEL[tone]}</span>
      </div>
      <div className="system-status__body">
        <p className="system-status__title">{title}</p>
        {detail ? <p className="system-status__detail">{detail}</p> : null}
        {children}
      </div>
    </div>
  );
}
