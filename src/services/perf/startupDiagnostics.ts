/* ============================================================
 * NodeFM Station — Startup Diagnostics
 *
 * Opt-in, bounded, redacted startup/performance telemetry used for
 * measurement-first runtime work. Disabled by default and enabled only
 * with `?debugStartup=1`.
 *
 * Adapted conceptually from the current Discussion Boards reference
 * (`src/services/perf/startupDiagnostics.ts`), but this module owns the
 * NodeFM lifecycle and request vocabulary.
 * ============================================================ */

export type StartupEventName =
  | 'APP_START'
  | 'BRIDGE_INIT_START'
  | 'BRIDGE_READY'
  | 'STATION_CONFIG_START'
  | 'STATION_CONFIG_READY'
  | 'TIMELINE_DATA_START'
  | 'TIMELINE_DATA_READY'
  | 'APP_SHELL_VISIBLE'
  | 'COMING_UP_USABLE'
  | 'SCHEDULE_USABLE'
  | 'FIRST_PLAYABLE_LIVE_SOURCE'
  | 'REQUEST_START'
  | 'REQUEST_END'
  | 'STARTUP_STATE';

export type StartupCompletion = 'success' | 'partial' | 'empty' | 'timeout' | 'cancelled' | 'error';

export type StartupDiagnosticEvent = {
  sequence: number;
  name: StartupEventName;
  elapsedMs: number;
  durationMs?: number;
  requestId?: string;
  caller?: string;
  trigger?: string;
  action?: string;
  service?: string;
  nameFilter?: string;
  identifier?: string;
  offset?: number;
  limit?: number;
  resultCount?: number;
  retry?: number;
  completion?: StartupCompletion;
  detail?: string;
};

export type StartupDiagnosticsReport = {
  schemaVersion: 1;
  generatedAt: string;
  enabled: boolean;
  totalElapsedMs: number;
  currentState: string;
  events: StartupDiagnosticEvent[];
  duplicateRequests: Array<{
    signature: string;
    count: number;
    cumulativeDurationMs: number;
  }>;
};

const MAX_MILESTONE_EVENTS = 400;
const MAX_REQUEST_EVENTS = 2400;

const canUseWindow = () => typeof window !== 'undefined';
const monotonicNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const startedAt = monotonicNow();
let enabled =
  canUseWindow() && new URLSearchParams(window.location.search).get('debugStartup') === '1';

let sequence = 0;
let requestSequence = 0;
let currentState = 'app-start';
let milestoneEvents: StartupDiagnosticEvent[] = [];
let requestEvents: StartupDiagnosticEvent[] = [];
let snapshotVersion = 0;
const listeners = new Set<() => void>();

const notify = () => {
  snapshotVersion += 1;
  listeners.forEach((listener) => listener());
};

const finiteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const safeText = (value: unknown, maxLength = 220) =>
  typeof value === 'string' && value.trim()
    ? value
        .trim()
        .replace(
          /(private.?key|seed|secret|password|auth(?:entication)?(?:token)?|signature)\s*[:=]\s*[^\s,;]+/gi,
          '$1=[redacted]',
        )
        .slice(0, maxLength)
    : undefined;

export const isStartupDiagnosticsEnabled = () => enabled;

export const configureStartupDiagnosticsForTest = (nextEnabled: boolean) => {
  // Test-only hook. Production remains query-gated.
  enabled = nextEnabled;
};

export const resetStartupDiagnosticsForTest = () => {
  milestoneEvents = [];
  requestEvents = [];
  sequence = 0;
  requestSequence = 0;
  currentState = 'app-start';
  notify();
};

export const recordStartupEvent = (
  name: StartupEventName,
  input: Omit<StartupDiagnosticEvent, 'sequence' | 'name' | 'elapsedMs'> = {},
) => {
  if (!enabled) return;

  const event: StartupDiagnosticEvent = {
    sequence: ++sequence,
    name,
    elapsedMs: Number((monotonicNow() - startedAt).toFixed(1)),
    ...(finiteNumber(input.durationMs) !== undefined
      ? { durationMs: finiteNumber(input.durationMs) }
      : {}),
    ...(safeText(input.requestId) ? { requestId: safeText(input.requestId) } : {}),
    ...(safeText(input.caller) ? { caller: safeText(input.caller) } : {}),
    ...(safeText(input.trigger) ? { trigger: safeText(input.trigger) } : {}),
    ...(safeText(input.action) ? { action: safeText(input.action) } : {}),
    ...(safeText(input.service) ? { service: safeText(input.service) } : {}),
    ...(safeText(input.nameFilter) ? { nameFilter: safeText(input.nameFilter) } : {}),
    ...(safeText(input.identifier) ? { identifier: safeText(input.identifier) } : {}),
    ...(finiteNumber(input.offset) !== undefined ? { offset: finiteNumber(input.offset) } : {}),
    ...(finiteNumber(input.limit) !== undefined ? { limit: finiteNumber(input.limit) } : {}),
    ...(finiteNumber(input.resultCount) !== undefined
      ? { resultCount: finiteNumber(input.resultCount) }
      : {}),
    ...(finiteNumber(input.retry) !== undefined ? { retry: finiteNumber(input.retry) } : {}),
    ...(input.completion ? { completion: input.completion } : {}),
    ...(safeText(input.detail) ? { detail: safeText(input.detail) } : {}),
  };

  if (event.name === 'REQUEST_START' || event.name === 'REQUEST_END') {
    requestEvents = [...requestEvents, event].slice(-MAX_REQUEST_EVENTS);
  } else {
    milestoneEvents = [...milestoneEvents, event].slice(-MAX_MILESTONE_EVENTS);
  }
  notify();
};

export const setStartupState = (state: string, completion?: StartupCompletion) => {
  currentState = state;
  recordStartupEvent('STARTUP_STATE', {
    detail: state,
    ...(completion ? { completion } : {}),
  });
};

export const beginStartupSpan = (
  name: StartupEventName,
  input: Omit<StartupDiagnosticEvent, 'sequence' | 'name' | 'elapsedMs' | 'durationMs'> = {},
) => {
  const spanStartedAt = monotonicNow();
  recordStartupEvent(name, input);

  return (
    endName: StartupEventName,
    result: Omit<StartupDiagnosticEvent, 'sequence' | 'name' | 'elapsedMs' | 'durationMs'> = {},
  ) => {
    recordStartupEvent(endName, {
      ...input,
      ...result,
      durationMs: Number((monotonicNow() - spanStartedAt).toFixed(1)),
    });
  };
};

export const beginStartupRequest = (input: {
  caller: string;
  trigger?: string;
  action: string;
  service?: string;
  nameFilter?: string;
  identifier?: string;
  offset?: number;
  limit?: number;
  retry: number;
}) => {
  const requestId = `startup-request-${++requestSequence}`;
  const requestStartedAt = monotonicNow();
  recordStartupEvent('REQUEST_START', { ...input, requestId });

  return (completion: StartupCompletion, result?: { resultCount?: number; detail?: string }) => {
    recordStartupEvent('REQUEST_END', {
      ...input,
      requestId,
      completion,
      durationMs: Number((monotonicNow() - requestStartedAt).toFixed(1)),
      ...result,
    });
  };
};

const requestSignature = (event: StartupDiagnosticEvent) =>
  [
    event.action ?? '',
    event.service ?? '',
    event.nameFilter ?? '',
    event.identifier ?? '',
    event.offset ?? '',
    event.limit ?? '',
  ].join('|');

export const getStartupDiagnosticsReport = (): StartupDiagnosticsReport => {
  const duplicateMap = new Map<string, { count: number; cumulativeDurationMs: number }>();

  requestEvents
    .filter((event) => event.name === 'REQUEST_END')
    .forEach((event) => {
      const signature = requestSignature(event);
      const current = duplicateMap.get(signature) ?? {
        count: 0,
        cumulativeDurationMs: 0,
      };
      current.count += 1;
      current.cumulativeDurationMs += event.durationMs ?? 0;
      duplicateMap.set(signature, current);
    });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    enabled,
    totalElapsedMs: Number((monotonicNow() - startedAt).toFixed(1)),
    currentState,
    events: [...milestoneEvents, ...requestEvents].sort(
      (left, right) => left.sequence - right.sequence,
    ),
    duplicateRequests: [...duplicateMap.entries()]
      .filter(([, value]) => value.count > 1)
      .map(([signature, value]) => ({
        signature,
        count: value.count,
        cumulativeDurationMs: Number(value.cumulativeDurationMs.toFixed(1)),
      }))
      .sort((left, right) => right.count - left.count),
  };
};

export const getStartupDiagnosticsSnapshotVersion = () => snapshotVersion;

export const subscribeStartupDiagnostics = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const installWindowStartupDiagnostics = () => {
  if (!canUseWindow()) return;

  (
    window as Window & {
      __NODEFM_STARTUP__?: { getReport: typeof getStartupDiagnosticsReport };
    }
  ).__NODEFM_STARTUP__ = {
    getReport: getStartupDiagnosticsReport,
  };
};

recordStartupEvent('APP_START', { completion: 'success' });
