# NodeFM Station — Phase 0 Specification

Status: **Architecture / specification only**
Application name: **NodeFM**
Priority: **Scheduled Auto-DJ radio station**
Future Q-Music/community platform: **separate project, explicitly out of scope**

This package is the authoritative starting point for a new Qortium-native radio dApp built from scratch.

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
