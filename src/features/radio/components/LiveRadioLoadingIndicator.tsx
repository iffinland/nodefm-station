/* ============================================================
 * NodeFM Station — Live Radio Loading Indicator
 *
 * Small, real-state loading indicator for the listener-facing radio
 * page. It is not a timer and never hides a genuine error/empty state;
 * it only reflects the actual station/timeline/player lifecycle.
 * ============================================================ */

import { useLiveRadioPlayerContext } from '../player';

export function LiveRadioLoadingIndicator() {
  const { timeline, playerState } = useLiveRadioPlayerContext();

  let label: string | null = null;

  if (timeline.stationLoading) {
    label = 'Connecting to station…';
  } else if (timeline.dataLoading) {
    label = 'Loading live radio…';
  } else if (
    playerState.playbackState === 'resolving' ||
    playerState.playbackState === 'preparing' ||
    playerState.playbackState === 'buffering'
  ) {
    label = 'Preparing live radio…';
  }

  if (!label) {
    return null;
  }

  return (
    <div className="live-radio-loading" role="status">
      <span className="live-radio-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
