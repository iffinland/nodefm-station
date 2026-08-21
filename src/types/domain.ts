/* ============================================================
 * NodeFM Station — Core Domain Types
 *
 * Defines the domain entities specified in docs/QORTIUM-DATA-MODEL.md.
 * These are TypeScript representations of the data model contract.
 * Qortium service/identifier values are stubs until validated against
 * the current Qortium implementation in Phase 1+.
 * ============================================================ */

// ── QDN Resource Reference ──────────────────────────────────────────

export type QdnResourceRef = {
  service: string;
  name: string;
  identifier?: string;
};

// ── Station ─────────────────────────────────────────────────────────

export type Station = {
  schemaVersion: number;
  stationId: string;

  name: string;
  description?: string;

  /**
   * The registered Qortium name under which station-owned QDN resources
   * (station config, tracks, playlists, schedule, notices, etc.) are
   * published. This is intentionally distinct from `ownerName` (a display
   * label) and from the APP host identity (`APP / NodeFM / Radio-AutoDJ`).
   */
  publisherName: string;
  ownerName?: string;
  ownerAddress: string;

  logo?: QdnResourceRef;
  heroImage?: QdnResourceRef;

  timezone: string;
  defaultRotationPlaylistId: string;
  defaultRotationPlaylistVersionId: string;
  stationEpochUtc: string;

  messagingEnabled: boolean;
  tipsEnabled: boolean;

  createdAt: string;
  updatedAt: string;
};

// ── Track ───────────────────────────────────────────────────────────

export type TrackSource = 'station-upload' | 'qdn-existing';

export type Track = {
  schemaVersion: number;

  trackId: string;
  ownerAddress: string;

  title: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  description?: string;

  audio: QdnResourceRef;
  cover?: QdnResourceRef;

  durationMs: number;

  genres?: string[];
  tags?: string[];

  source: TrackSource;

  /**
   * Optional lineage for tracks accepted from a listener submission.
   * Kept optional so ordinary station uploads and QDN imports remain
   * unchanged. The accepted Track itself is still a normal Station Track;
   * these fields only preserve the source submission identity.
   */
  submissionId?: string;
  submissionRef?: QdnResourceRef;

  createdAt: string;
  updatedAt: string;
};

// ── Playlist ────────────────────────────────────────────────────────

export type PlaylistVisibility = 'public' | 'private';

export type Playlist = {
  schemaVersion: number;

  playlistId: string;
  ownerAddress: string;

  title: string;
  description?: string;
  cover?: QdnResourceRef;

  visibility: PlaylistVisibility;

  latestVersionId: string;

  createdAt: string;
  updatedAt: string;
};

// ── Playlist Version (immutable) ────────────────────────────────────

export type PlaylistVersionTrack = {
  trackId: string;
  durationMs: number;
};

export type PlaylistVersion = {
  schemaVersion: number;

  playlistId: string;
  versionId: string;
  versionNumber: number;

  createdBy: string;
  createdAt: string;

  tracks: PlaylistVersionTrack[];

  totalDurationMs: number;
};

// ── Schedule Event ──────────────────────────────────────────────────

export type ScheduleEventSourcePlaylist = {
  type: 'playlist';
  playlistId: string;
  playlistVersionId: string;
};

export type ScheduleEventSourceDynamic = {
  type: 'dynamic-program';
  programDefinitionId: string;
};

export type ScheduleEventSource = ScheduleEventSourcePlaylist | ScheduleEventSourceDynamic;

export type ScheduleEvent = {
  schemaVersion: number;

  eventId: string;
  title?: string;

  startUtc: string;
  endUtc: string;

  source: ScheduleEventSource;

  /**
   * Optional scheduler provenance. Concrete runtime behavior remains
   * driven only by the immutable UTC interval and source fields above.
   */
  recurrenceId?: string;
  recurrenceInstanceKey?: string;

  createdAt: string;
  updatedAt: string;
};

// ── Schedule Recurrence (admin intent, never runtime input) ────────

export type ScheduleRecurrenceFrequency = 'daily' | 'weekly';

/**
 * Recurrence is an admin-side authoring object. The runtime timeline
 * never consumes this type directly; it is compiled into concrete
 * ScheduleEvent instances before publication.
 *
 * `daysOfWeek` uses the JavaScript/ISO convention:
 * 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
 */
export type ScheduleRecurrence = {
  schemaVersion: number;

  recurrenceId: string;
  ownerAddress: string;

  title: string;
  source: ScheduleEventSource;

  timezone: string;
  frequency: ScheduleRecurrenceFrequency;
  localStartTime: string;
  durationMs: number;
  daysOfWeek?: number[];

  activeFromLocalDate: string;
  activeUntilLocalDate?: string;

  createdAt: string;
  updatedAt: string;
};

// ── Dynamic Program ─────────────────────────────────────────────────

export type DynamicProgramRanking = {
  strategy: 'most-liked';
};

export type DynamicProgramFallback = {
  enabled: true;
  source: 'station-library';
  strategy: 'deterministic-random';
};

export type DynamicProgramDefinition = {
  schemaVersion: number;

  programDefinitionId: string;
  type: 'request-show';

  title: string;

  targetDurationMs: number;

  ranking: DynamicProgramRanking;
  fallback: DynamicProgramFallback;

  updatedAt: string;
};

// ── Dynamic Program Occurrence ──────────────────────────────────────

export type OccurrenceTrack = {
  trackId: string;
  durationMs: number;
  source: 'liked' | 'fallback';
};

export type DynamicProgramOccurrence = {
  schemaVersion: number;

  occurrenceId: string;
  programDefinitionId: string;
  scheduleEventId: string;

  startUtc: string;
  endUtc: string;

  generatedAt: string;

  tracks: OccurrenceTrack[];

  seed: string;
};

// ── Like ────────────────────────────────────────────────────────────

export type TrackLike = {
  schemaVersion: number;

  trackId: string;
  userAddress: string;

  liked: boolean;
  updatedAt: string;
};

// ── Station Notice ──────────────────────────────────────────────────

export type StationNotice = {
  schemaVersion: number;

  noticeId: string;
  title?: string;
  message: string;

  activeFromUtc?: string;
  activeUntilUtc?: string;

  createdAt: string;
  updatedAt: string;
};

// ── Listener Track Submission ──────────────────────────────────────

/**
 * Immutable listener-owned source proposal for possible inclusion in the
 * station library. The submission itself never mutates between PENDING,
 * ACCEPTED, and REJECTED. Owner moderation is a separate station-owned
 * resource.
 */
export type ListenerTrackSubmission = {
  schemaVersion: number;

  submissionId: string;
  submitterName: string;
  submitterAddress: string;

  title: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  description?: string;

  audio: QdnResourceRef;
  cover?: QdnResourceRef;

  durationMs: number;

  genres?: string[];
  tags?: string[];

  submittedAt: string;
};

// ── Submission Moderation (station-owner authoritative) ────────────

export type SubmissionModerationDecision = 'accepted' | 'rejected';

export type SubmissionModeration = {
  schemaVersion: number;

  moderationId: string;
  submissionId: string;
  submissionRef: QdnResourceRef;

  decision: SubmissionModerationDecision;
  /** Required for accepted submissions and stored to make repeated Accept idempotent. */
  acceptedTrackId?: string;
  reason?: string;

  moderatorAddress: string;
  moderatedAt: string;
};
