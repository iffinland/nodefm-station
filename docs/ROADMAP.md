# Development Roadmap

The goal is to use the current low-cost DeepSeek development window efficiently without sacrificing architecture.

## Phase 0 — Specification

Status: **complete**

Deliverables:

- Project Vision
- Architecture
- Qortium Data Model
- Radio Timeline Spec
- Player Spec
- Admin Spec
- Roadmap
- Agent rules
- DeepSeek bootstrap prompt

No production feature implementation before these contracts are reviewed.

## Phase 1 — Foundation

Status: **implemented (local/automated verified)**

Build:

- new React + TypeScript Qortium project;
- Qortium-compatible app bootstrap;
- relative asset/build configuration;
- routing;
- app shell;
- global providers;
- auth integration;
- owner/admin authorization;
- Qortium/QDN service boundaries;
- global audio provider/engine skeleton;
- core domain TypeScript models;
- public pages;
- admin pages as functional shells/placeholders;
- error/loading primitives.

Exit criteria:

- app runs correctly inside Qortium dev environment;
- navigation works;
- authenticated owner is distinguishable from listener;
- one global audio engine survives route changes;
- no feature code depends directly on scattered raw QDN calls.

## Phase 2 — Music Library and Playlists

Status: **COMPLETE**

Owner embedded Qortium Home validation: **PASSED**

Build:

- local audio upload flow;
- Add QDN flow;
- track metadata;
- duration validation;
- cover handling;
- library browsing;
- playlist CRUD;
- drag/drop editor;
- playlist duration calculation;
- immutable playlist versions;
- public/private station playlists.

Exit criteria:

- owner can produce a valid published playlist version from QDN-backed tracks.

Phase 2 exit criterion status: **PASSED** — owner live embedded Qortium Home
evidence confirmed that previously and newly published tracks and playlists
remain visible after refresh/reopen.

## Phase 3 — Core Radio Timeline

Status: **COMPLETE**

Build:

- station config;
- default rotation;
- station epoch;
- `RadioTimelineEngine`;
- now-playing resolver;
- offset calculation;
- upcoming track resolver;
- live player;
- live progress;
- periodic resync;
- recovery from late QDN readiness;
- unit tests for timeline boundaries.

Exit criteria:

- opening the app at different times joins the expected current track at the expected offset;
- closing/reopening does not reset station sequence.

Phase 3 exit criterion status: **PASSED** — owner embedded Qortium Home
validation confirmed LIVE join, deterministic timeline progression,
refresh/reopen UTC state recovery, navigation-safe global playback, and
Return to Live behavior.

Scheduled-event engine semantics are implemented and automated-tested, but the
interactive scheduled-event owner smoke is deferred to Phase 4 because
scheduler authoring does not exist yet. This is not a Phase 3 blocker.

## Phase 4 — Scheduler

Status: **COMPLETE**

Build:

- schedule event data;
- CRUD;
- week view;
- agenda view;
- drag/move/resize;
- overlap validation;
- recurring schedule authoring;
- timezone-aware generation of concrete UTC ScheduleEvent instances;
- Daily and Weekly recurrence;
- bounded future event generation;
- static scheduled playlists;
- exact transitions back to default rotation;
- upcoming program list on public page.

Exit criteria:

- a full week can be scheduled visually;
- active program changes deterministically by clock time.

Phase 4 exit criterion status: **PASSED** — owner embedded Qortium Home
runtime validation confirmed the scheduler end-to-end chain:

```text
Scheduler
    -> concrete ScheduleEvent
    -> Phase 3 timeline
    -> AudioEngine
    -> scheduled playlist playback
```

Scheduler services, QDN persistence/discovery, timezone/DST compilation,
Daily/Weekly recurrence authoring, overlap prevention, immutable
PlaylistVersion selection, week/agenda views, account isolation, and production
timeline integration are implemented and automated-tested. Minor UI/UX polish
is deferred to the later global polish/hardening pass and is not a Phase 4
blocker.

## Phase 5 — Request Show / Likes

Status: **COMPLETE**

Build:

- user-specific track likes;
- like aggregation/query layer;
- dynamic Request Show definition;
- 30-minute recurring slot support;
- ranked liked-track selection;
- deterministic station-library fallback;
- immutable/canonical occurrence lineup;
- tests for:
  - enough likes;
  - insufficient likes;
  - zero likes;
  - identical lineup across clients.

Exit criteria:

- scheduled Request Show always fills the program window as well as available track durations allow and never depends on per-client random choice.

Phase 5 exit criterion status: **PASSED** — owner embedded Qortium Home
validation confirmed Like/Unlike behavior, per-account Like state, account
switching, Request Show definition/scheduling, generated occurrence
determinism, reload/reopen persistence, and Request Show playback integration.

Owner embedded Qortium Home validation: **PASSED**.

Minor visual/UI polish remains intentionally deferred to the later global
polish/hardening phase.

## Phase 6 — Social Station Features

Status: **COMPLETE**

Build:

- station direct message action;
- station tip/donation action;
- share app;
- share playlist;
- notices;
- public station information.

Use generic recipient abstractions where possible.

Exit criteria:

- all Phase 6 features implemented;
- production-path tests passing;
- reference-first Qortium contracts verified;
- no BLOCKER/HIGH adversarial findings;
- owner embedded runtime validation passed.

Phase 6 exit criterion status: **PASSED** — owner embedded Qortium Home
validation confirmed direct messages to the station owner, native tip/donation
flow, share app/public-playlist links, station notices and owner notice
management, public station information, account isolation, social modal
interaction, and stable LIVE playback during social actions.

Owner embedded Qortium Home validation: **PASSED**.

Verified Phase 6 architecture:

- `SEND_CHAT_MESSAGE` direct-recipient integration;
- `SEND_COIN` native tip integration through Home's normal approval path;
- canonical `qdn://` app/playlist sharing;
- `nodefm-notice-*` JSON QDN notice resources;
- `SEARCH_QDN_RESOURCES` mode `ALL` for notice discovery;
- owner authorization enforced in the production notice store;
- Home-selected account identity;
- no duplicate NodeFM inbox;
- no custom chat/transaction wire protocol;
- no automatic payment retry;
- explicit failure/cancel states.

Minor visual/UI polish remains deferred to the later project-wide
hardening/polish phase.

## Phase 7 — Public Playlist Listening

Status: **not started**

Build:

- playlist browser;
- playlist detail;
- player mode switch;
- play/pause;
- seek;
- previous/next;
- shuffle;
- loop;
- Return to Live.

Exit criteria:

- switching back to live recalculates actual current broadcast state.

## Phase 8 — Hardening

Status: **not started**

Perform:

- runtime audit;
- QDN slow-resource testing;
- mobile testing;
- large-library testing;
- schedule boundary tests;
- error recovery;
- accessibility review;
- bundle/lazy-loading review;
- Qortium-native integration audit;
- independent DeepSeek/Codex review if economically justified.

## Explicitly separate future project

A future Q-Music-like community platform is not a phase of this project.

It should be a new project with its own:

- vision;
- data model;
- user publishing rules;
- moderation;
- creator profiles;
- discovery;
- personal player.

The radio project may later interoperate with it through stable QDN resource references.
