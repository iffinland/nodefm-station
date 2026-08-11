# Architecture

## 1. Architectural principles

### Qortium-native first

The project must be built from scratch for Qortium.

Old Qortal/Q-Music code is not an architectural reference.

Qortium-specific network operations must be contained behind a service/adaptor layer so UI and domain logic do not depend directly on raw request shapes.

### Deterministic radio state

The live station state must be computable from published authoritative data plus current time.

Do not model the station as a server process that has to "keep playing".

### Domain separation

Keep these domains independent:

- radio/timeline;
- tracks/library;
- playlists;
- scheduling;
- audio playback;
- likes;
- messaging;
- tips;
- sharing;
- admin;
- Qortium/QDN infrastructure.

### Single global audio engine

Only one audio playback engine should exist in the app.

Navigation must not recreate the audio element or accidentally restart playback.

## 2. Recommended source layout

```text
src/
├── app/
│   ├── App.tsx
│   ├── AppRouter.tsx
│   └── providers/
│       ├── AppProviders.tsx
│       └── AuthProvider.tsx
│
├── audio/
│   ├── AudioEngine.ts
│   ├── AudioProvider.tsx
│   ├── playbackTypes.ts
│   └── useAudioPlayer.ts
│
├── features/
│   ├── radio/
│   │   ├── timeline/
│   │   │   ├── RadioTimelineEngine.ts
│   │   │   ├── timelineTypes.ts
│   │   │   └── timelineMath.ts
│   │   ├── player/
│   │   ├── now-playing/
│   │   ├── upcoming/
│   │   └── schedule/
│   │
│   ├── tracks/
│   │   ├── components/
│   │   ├── services/
│   │   └── types/
│   │
│   ├── library/
│   │   ├── upload/
│   │   ├── add-qdn/
│   │   └── components/
│   │
│   ├── playlists/
│   │   ├── editor/
│   │   ├── browser/
│   │   ├── services/
│   │   └── types/
│   │
│   ├── scheduling/
│   │   ├── week-view/
│   │   ├── agenda/
│   │   ├── conflict-detection/
│   │   └── services/
│   │
│   ├── dynamic-programs/
│   │   └── request-show/
│   │
│   ├── likes/
│   ├── messaging/
│   ├── tips/
│   └── sharing/
│
├── pages/
│   ├── RadioPage.tsx
│   ├── PlaylistsPage.tsx
│   ├── AboutPage.tsx
│   └── admin/
│       ├── AdminDashboard.tsx
│       ├── LibraryPage.tsx
│       ├── PlaylistsAdminPage.tsx
│       ├── PlaylistEditorPage.tsx
│       ├── SchedulePage.tsx
│       ├── MessagesPage.tsx
│       └── StationSettingsPage.tsx
│
├── qortium/
│   ├── client/
│   ├── auth/
│   ├── qdn/
│   │   ├── publish/
│   │   ├── read/
│   │   ├── search/
│   │   └── readiness/
│   ├── resources/
│   └── types/
│
├── components/
├── hooks/
├── utils/
└── types/
```

This is a target architecture, not a requirement to create every empty folder on day one.

## 3. Main runtime services

### `RadioTimelineEngine`

Pure/domain-first engine responsible for:

- resolving active schedule event;
- resolving fallback/default rotation;
- resolving playlist version;
- computing active track;
- computing current in-track offset;
- computing next tracks;
- handling program boundaries;
- handling playlist loops inside a fixed event window;
- generating a deterministic request-show lineup for a scheduled occurrence.

It should be as pure and testable as practical.

### `AudioEngine`

Responsible only for playback mechanics:

- load audio resource;
- play/pause;
- seek where allowed;
- switch tracks;
- volume;
- playback errors;
- buffering;
- live resync.

It should not decide what is scheduled.

### Qortium/QDN services

Responsible for:

- resource publishing;
- searching;
- fetching;
- readiness/status;
- authentication-linked actions;
- network retries;
- resource reference normalization.

UI components should not build raw QDN URLs or publish request payloads themselves.

## 4. State architecture

Separate:

### Network/source state

Published resources from QDN/Qortium.

### Derived domain state

Examples:

- current live track;
- current offset;
- next 5 tracks;
- today's agenda;
- current request-show lineup.

### UI state

Examples:

- modal open;
- playlist editor selection;
- drag state;
- calendar week;
- admin tabs.

Do not publish ephemeral UI state.

## 5. Routing

Public:

```text
/
 /playlists
 /playlists/:playlistId
 /about
```

Admin:

```text
/admin
/admin/library
/admin/playlists
/admin/playlists/:playlistId
/admin/schedule
/admin/messages
/admin/station
```

The exact router strategy must remain compatible with Qortium/qApp-style deployment and relative asset paths.

## 6. Admin authorization

Do not rely on hiding admin buttons.

The owner identity must be verified against station configuration or another authoritative ownership rule before admin actions are enabled.

Initial policy:

```text
authenticatedAddress === stationOwnerAddress
```

or an equivalent authenticated Qortium identity comparison.

Future roles may add:

- admin;
- DJ;
- moderator.

These are not required initially.

## 7. Publication/versioning principle

Objects whose historical content affects the radio timeline must not be silently mutated.

Use immutable/versioned records for:

- playlist snapshots used by schedule entries;
- schedule/event definitions when revision history matters;
- generated dynamic program lineups once a scheduled occurrence begins.

Mutable "latest configuration" resources are acceptable for objects where historical reconstruction is not required, provided the identifier/update model is defined safely.

## 8. Performance

Priorities:

1. Fast first screen.
2. Load metadata before heavy audio/cover resources.
3. Avoid pulling entire libraries on app startup.
4. Lazy-load admin pages.
5. Lazy-load public playlist browsing.
6. Cache metadata carefully.
7. Treat QDN resources as potentially not locally ready yet.
8. Provide loading/retry states rather than assuming instant availability.

## 9. Test strategy

At minimum, automated tests should cover:

- timeline position calculations;
- schedule boundaries;
- default rotation;
- playlist looping;
- exact event transition times;
- insufficient request-show liked tracks;
- deterministic fallback;
- clock drift/live resync thresholds;
- invalid/missing track duration handling;
- overlapping schedule conflict detection.
