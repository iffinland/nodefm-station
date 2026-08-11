# DeepSeek Bootstrap Prompt

Use this prompt when starting the first implementation phase.

---

You are implementing a brand-new Qortium-native dApp with the working title **Qortium Radio Station**.

This is NOT a port and NOT a refactor of the old Q-Music/Qortal project.

## Mandatory first action

Before writing feature code, read all project specification files in this order:

1. `docs/PROJECT-VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/QORTIUM-DATA-MODEL.md`
4. `docs/RADIO-TIMELINE-SPEC.md`
5. `docs/PLAYER-SPEC.md`
6. `docs/ADMIN-SPEC.md`
7. `docs/ROADMAP.md`
8. `agents/AGENTS.md`

Then inspect current Qortium-compatible reference implementations available in this workspace/repositories.

Do not assume old Qortal/Q-Music patterns are correct for Qortium.

## Current assignment

Implement **Phase 1 — Foundation only**.

Do not implement the full radio yet.

### Required Phase 1 work

Build or bootstrap the new React + TypeScript project so it:

- runs correctly in the Qortium development environment;
- uses Qortium-compatible relative asset/build behavior;
- has a clear public/admin route structure;
- has centralized Qortium/QDN integration boundaries;
- has authentication wiring;
- can distinguish station owner/admin from ordinary listener;
- has one global audio provider/engine skeleton above route-level pages;
- defines the core domain TypeScript types required by the specification;
- creates public page shells:
  - Radio;
  - Playlists;
  - About;
- creates admin page shells:
  - Dashboard;
  - Library;
  - Playlists;
  - Playlist Editor route;
  - Schedule;
  - Messages;
  - Station Settings;
- provides reusable loading/error states suitable for slow QDN resources;
- does not introduce centralized backend assumptions.

### Important architectural restrictions

1. Do not copy Q-Music code.
2. Do not implement a continuously running backend radio player.
3. Do not put timeline calculations inside React UI components.
4. Do not scatter raw QDN calls throughout the app.
5. Do not implement Request Show, scheduler or full library yet unless a tiny interface/type stub is necessary for Phase 1 architecture.
6. Do not invent canonical Qortium `service` or `identifier` values without checking current Qortium reference patterns.
7. If a Qortium API/action is uncertain, inspect current reference code and document the decision.
8. Keep heavy sections lazy-loadable where appropriate.
9. Preserve a clean feature-based architecture.

## Deliverable

At the end:

1. run available typecheck/build/tests;
2. fix Phase 1 errors;
3. summarize:
   - created/changed files;
   - architecture implemented;
   - Qortium-specific decisions;
   - commands/tests run;
   - unresolved questions;
4. stop before Phase 2.

Do not redesign the product beyond the supplied specifications.
