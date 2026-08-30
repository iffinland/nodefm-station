# NodeFM Station

NodeFM is a Qortium-native scheduled 24/7 Auto-DJ radio dApp. A listener joins
the deterministic broadcast position derived from current time, schedule,
immutable playlist versions, verified track durations, and default rotation;
the station does not require a continuously running streaming backend.

## Current status

The original specification phases 0–7 were implemented and owner-validated,
after which the project entered active beta/hardening and continued through
listener playlists, listener submissions/moderation, resilience, transaction
UX, and cold-start optimization work.

Do not use the old phrase “Phase 8 not started” as current status. The roadmap
now records Phase 8 as active and points to current source, Git state, and
canonical reports for task-level evidence. The latest local working tree may
contain owner changes and must be inspected before work.

## Product scope

- deterministic live radio timeline and default rotation;
- station schedules and immutable playlist versions;
- global audio engine with live and playlist modes;
- music library and QDN media flows;
- listener likes, uploads/submissions, and owned playlists;
- Request Show, station messages, tips/donations, and admin workflows.

The future Q-Music-style creator/community platform is a separate product. Do
not port or reuse old Q-Music/Qortal architecture as NodeFM's foundation.

## Durable specifications

1. [`docs/PROJECT-VISION.md`](docs/PROJECT-VISION.md)
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
3. [`docs/QORTIUM-DATA-MODEL.md`](docs/QORTIUM-DATA-MODEL.md)
4. [`docs/RADIO-TIMELINE-SPEC.md`](docs/RADIO-TIMELINE-SPEC.md)
5. [`docs/PLAYER-SPEC.md`](docs/PLAYER-SPEC.md)
6. [`docs/ADMIN-SPEC.md`](docs/ADMIN-SPEC.md)
7. [`docs/ROADMAP.md`](docs/ROADMAP.md)
8. [`docs/RELEASE.md`](docs/RELEASE.md)

Current source is authoritative for implemented behavior. The roadmap is a
product-plan/history document, not a substitute for a fresh source and Git
baseline.

## Development

```bash
npm ci
npm run dev
npm run test
npm run build
npm run lint
npm run format:check
```

Local preview, mocks, tests, and build output do not prove embedded Home,
deployed QDN, playback, persistence, or transaction behavior.

## Agent routing and reports

- [`AGENTS.md`](AGENTS.md) — project entry point for AI-assisted work.
- Canonical project context:
  `/home/iffi/VsCodec-Projects/Qortium/qortium-dev-workspace/projects/nodefm-station.md`
- AI work reports belong under
  `/home/iffi/VsCodec-Projects/Qortium/docs/nodefm-station/`.

The application `docs/` directory is reserved for durable specifications and
operator/release documentation.

## Release boundary

Build, commit, push, tag, release, deployment, signing, payments, moderation,
and QDN publication require explicit owner authorization. Follow
[`docs/RELEASE.md`](docs/RELEASE.md) and record exact source/artifact/deployment
provenance.
