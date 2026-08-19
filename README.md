# NodeFM Station

Status: **Phase 7 — COMPLETE**

Phase 2 owner embedded Qortium Home validation: **PASSED**
Phase 3 owner embedded Qortium Home validation: **PASSED**
Phase 4 owner embedded Qortium Home validation: **PASSED**
Phase 5 owner embedded Qortium Home validation: **PASSED**
Phase 6 owner embedded Qortium Home validation: **PASSED**
Phase 7 owner embedded Qortium Home validation: **PASSED**
Application name: **NodeFM**
Priority: **Scheduled Auto-DJ radio station**
Future Q-Music/community platform: **separate project, explicitly out of scope**
Next phase: **Phase 8 — Hardening**

This package is the authoritative starting point for a new Qortium-native radio dApp built from scratch.

Implementation status is tracked in `docs/ROADMAP.md`. The Phase 0 documents
below remain the authoritative product, architecture, data-model, timeline,
player, and admin contracts.

## Core product idea

The app is a 24/7 scheduled auto-DJ radio station. The station does not depend on a centralized streaming process that must keep playing continuously. Instead, the current broadcast position is derived deterministically from:

- the current time;
- the active schedule event;
- the selected immutable playlist version;
- track durations;
- the station's default rotation when no scheduled event exists.

A listener opening the app at any moment joins the broadcast at the position that should be live at that exact time.

## Documentation order

1. `docs/PROJECT-VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/QORTIUM-DATA-MODEL.md`
4. `docs/RADIO-TIMELINE-SPEC.md`
5. `docs/PLAYER-SPEC.md`
6. `docs/ADMIN-SPEC.md`
7. `docs/ROADMAP.md`
8. `agents/AGENTS.md`
9. `agents/DEEPSEEK-BOOTSTRAP-PROMPT.md`

## Non-negotiable project rules

- Build the app as a new Qortium-native project.
- Do not port or reuse Q-Music code.
- Do not copy Q-Music architecture.
- Old Q-Music may later be inspected only for visual or functional inspiration.
- Keep Qortium/QDN integration isolated behind dedicated services/adapters.
- Avoid ordinary web2 assumptions such as a permanent centralized backend.
- The first implementation target is the radio station, not the future community music platform.
- The audio engine must be global and persistent across app navigation.
- Scheduled broadcast state must be deterministic and reconstructable from published data.
