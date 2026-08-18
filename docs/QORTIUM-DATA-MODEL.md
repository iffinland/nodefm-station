# Qortium Data Model

Status: **Domain contract draft**

Important: this document defines domain entities first. Exact Qortium service
names, identifiers, and publish/search conventions were validated against the
current Qortium Home/Core implementation during Phase 2; the concrete Phase 2
values are noted in the identifier policy below.

## 1. Resource-reference rule

Whenever an existing QDN audio or cover resource can be reused, prefer storing a reference rather than duplicating media.

Conceptual reference:

```ts
type QdnResourceRef = {
  service: string;
  name: string;
  identifier?: string;
};
```

Add extra fields only when Qortium requires them.

## 2. Station

```ts
type Station = {
  schemaVersion: number;
  stationId: string;

  name: string;
  description?: string;

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
```

Rules:

- timestamps stored in UTC;
- station timezone is presentation/admin scheduling context;
- `stationEpochUtc` anchors deterministic fallback rotation.

## 3. Track

A station track is metadata plus references to media.

```ts
type Track = {
  schemaVersion: number;

  trackId: string;
  ownerAddress: string;

  title: string;
  artist?: string;
  description?: string;

  audio: QdnResourceRef;
  cover?: QdnResourceRef;

  durationMs: number;

  genres?: string[];
  tags?: string[];

  source: 'station-upload' | 'qdn-existing';

  createdAt: string;
  updatedAt: string;
};
```

### Duration is mandatory for scheduled playback

A track without a trustworthy duration cannot safely participate in deterministic radio scheduling.

Import/upload flow must therefore resolve and store duration before a track becomes schedule-eligible.

## 4. Playlist identity

Logical playlist:

```ts
type Playlist = {
  schemaVersion: number;

  playlistId: string;
  ownerAddress: string;

  title: string;
  description?: string;
  cover?: QdnResourceRef;

  visibility: 'public' | 'private';

  latestVersionId: string;

  createdAt: string;
  updatedAt: string;
};
```

## 5. Immutable playlist version

```ts
type PlaylistVersion = {
  schemaVersion: number;

  playlistId: string;
  versionId: string;
  versionNumber: number;

  createdBy: string;
  createdAt: string;

  tracks: Array<{
    trackId: string;
    durationMs: number;
  }>;

  totalDurationMs: number;
};
```

Schedule events reference `versionId`, never "whatever the playlist currently contains".

## 6. Schedule event

```ts
type ScheduleEvent = {
  schemaVersion: number;

  eventId: string;
  title?: string;

  startUtc: string;
  endUtc: string;

  source:
    | {
        type: 'playlist';
        playlistId: string;
        playlistVersionId: string;
      }
    | {
        type: 'dynamic-program';
        programDefinitionId: string;
      };

  createdAt: string;
  updatedAt: string;
};
```

Rules:

- `startUtc < endUtc`;
- normal admin workflow prevents overlapping events;
- schedule execution is deterministic.

## 7. Dynamic program definition

Initial implementation: Request Show.

```ts
type DynamicProgramDefinition = {
  schemaVersion: number;

  programDefinitionId: string;
  type: 'request-show';

  title: string;

  targetDurationMs: number;

  ranking: {
    strategy: 'most-liked';
  };

  fallback: {
    enabled: true;
    source: 'station-library';
    strategy: 'deterministic-random';
  };

  updatedAt: string;
};
```

Initial target:

```text
targetDurationMs = 30 minutes
```

## 8. Dynamic program occurrence / lineup

A crucial rule: a dynamic program must not keep changing while it is already on air.

Before or at occurrence start, resolve it into an immutable lineup:

```ts
type DynamicProgramOccurrence = {
  schemaVersion: number;

  occurrenceId: string;
  programDefinitionId: string;
  scheduleEventId: string;

  startUtc: string;
  endUtc: string;

  generatedAt: string;

  tracks: Array<{
    trackId: string;
    durationMs: number;
    source: 'liked' | 'fallback';
  }>;

  seed: string;
};
```

Once generated for that occurrence, all listeners must resolve the same lineup.

## 9. Likes

Do not store a mutable aggregate count directly as the source of truth on the track.

Conceptual event/state:

```ts
type TrackLike = {
  schemaVersion: number;

  trackId: string;
  userAddress: string;

  liked: boolean;
  updatedAt: string;
};
```

The implementation should use an identifier scheme that allows one user's current like state for one track to be resolved safely.

Aggregate likes are derived from user-specific records or a validated index/cache.

## 10. Station notice

```ts
type StationNotice = {
  schemaVersion: number;

  noticeId: string;
  title?: string;
  message: string;

  activeFromUtc?: string;
  activeUntilUtc?: string;

  createdAt: string;
  updatedAt: string;
};
```

## 11. Messages and tips

Messaging and payment/tip objects must use current Qortium-native actions and identity/payment capabilities.

Do not invent a custom centralized message database.

Do not hardcode the station owner's name/address inside generic UI components.

Use recipient-based abstractions.

## 12. Identifier policy

Before implementation, define and document:

- service;
- name;
- identifier prefix;
- ownership;
- mutability/versioning;
- searchability;
- collision behavior;
- delete/update behavior.

Example conceptual namespaces only:

```text
radio-station-
radio-track-
radio-playlist-
radio-playlist-version-
radio-schedule-
radio-like-
radio-program-
radio-program-occurrence-
radio-notice-
```

These are not yet canonical Qortium identifier choices. Phase 2 currently uses
these working QDN identifiers:

- `nodefm-track-<trackId>`
- `nodefm-audio-<id>`
- `nodefm-cover-<id>`
- `nodefm-playlist-<playlistId>`
- `nodefm-playlist-version-<versionId>`

## 13. Recurring schedule authoring model

Recurring scheduling is separated from canonical broadcast events.

A recurrence definition is an admin-side authoring object.

Conceptually:

    type ScheduleRecurrence = {
      recurrenceId: string
      timezone: string
      frequency: "daily" | "weekly"
      localStartTime: string
      durationMs: number
      daysOfWeek?: number[]
      activeFromLocalDate: string
      activeUntilLocalDate?: string
    }

This object must not be consumed directly by RadioTimelineEngine.

Flow:

    ScheduleRecurrence
        -> timezone-aware schedule generator
        -> concrete ScheduleEvent[]
        -> RadioTimelineEngine

Concrete ScheduleEvent resources remain the canonical runtime timeline.

This separation is mandatory because it keeps recurrence and daylight-saving
logic out of live playback calculations.
