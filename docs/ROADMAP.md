# Development Roadmap

The goal is to use the current low-cost DeepSeek development window efficiently without sacrificing architecture.

## Phase 0 — Specification

Status: **current**

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

## Phase 3 — Core Radio Timeline

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

## Phase 4 — Scheduler

Build:

- schedule event data;
- CRUD;
- week view;
- agenda view;
- drag/move/resize;
- overlap validation;
- static scheduled playlists;
- exact transitions back to default rotation;
- upcoming program list on public page.

Exit criteria:

- a full week can be scheduled visually;
- active program changes deterministically by clock time.

## Phase 5 — Request Show / Likes

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

## Phase 6 — Social Station Features

Build:

- station direct message action;
- station tip/donation action;
- share app;
- share playlist;
- notices;
- public station information.

Use generic recipient abstractions where possible.

## Phase 7 — Public Playlist Listening

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
