# Agent Rules — NodeFM Station

These rules apply to AI agents working on this project.

## 1. Authority order

Read in this order:

1. `docs/PROJECT-VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/QORTIUM-DATA-MODEL.md`
4. `docs/RADIO-TIMELINE-SPEC.md`
5. `docs/PLAYER-SPEC.md`
6. `docs/ADMIN-SPEC.md`
7. `docs/ROADMAP.md`
8. this file

If implementation conflicts with the specifications, stop and report the conflict instead of silently redesigning the product.

## 2. Do not use old Q-Music architecture

Never:

- copy old Q-Music code;
- port old Q-Music services;
- preserve old Q-Music data patterns merely because they already exist;
- treat Qortal-specific historical implementation as canonical for Qortium.

Old Q-Music may later be inspected only when explicitly requested for visual/feature inspiration.

## 3. Qortium-native integration

Before implementing publish/search/auth/resource APIs:

- inspect current Qortium-compatible reference code;
- prefer current Qortium/QDN mechanisms;
- isolate integration behind `src/qortium` or equivalent;
- do not scatter raw network request details across components.

## 4. No centralized radio daemon assumption

Do not introduce:

- a streaming server;
- a server-side continuously running player;
- a hidden required backend process;

unless the user explicitly changes the architecture later.

Live state is deterministic and clock-derived.

## 5. Timeline is sacred

Changes affecting:

- schedule semantics;
- playlist versioning;
- duration handling;
- event boundaries;
- default rotation;
- Request Show selection;

must be checked against `RADIO-TIMELINE-SPEC.md`.

Write tests before or alongside complex timeline changes.

## 6. Playlist versions

A scheduled event references an immutable playlist version.

Do not make scheduled historical playback depend on the latest mutable playlist contents.

## 7. Track duration

A track without valid duration is not schedule-eligible.

Never work around missing duration by guessing.

## 8. Dynamic Request Show

Do not compute the Request Show with independent client-side random selection.

A scheduled occurrence must resolve to one deterministic/canonical lineup.

Fallback tracks are allowed and required when liked tracks are insufficient.

## 9. UI architecture

Keep:

- domain logic out of components;
- timeline calculations out of player UI;
- raw QDN logic out of visual components;
- one global audio engine.

## 10. Incremental implementation

Implement one roadmap phase at a time.

At the end of each phase report:

- files changed;
- decisions made;
- tests run;
- remaining known issues;
- any spec ambiguities discovered.

Do not opportunistically build the future Q-Music/community project.
