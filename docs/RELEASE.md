# NodeFM Release and Deployment Runbook

## Status and identity

The current minimal `qortium-app.json` names NodeFM at version `0.1.0`; it does
not by itself establish a complete release identity, permissions contract, live
URI, or deployed provenance. Confirm all of these before release.

## Required authority

Commit, push, tag, release, signing, payments, moderation, deployment, and QDN
publication require explicit owner authorization. Preserve existing live station
data and owner working-tree changes.

## Pre-release gates

1. Record Git branch, HEAD, remote relation, and full working tree.
2. Define the exact source scope and confirm manifest/version/identity,
   publisher authority, services/identifiers, compatibility, and migrations.
3. Review current known issues and owner-live-validation gates in canonical
   dated reports.
4. Run:

   ```bash
   npm ci
   npm run test
   npm run build
   npm run lint
   npm run format:check
   git diff --check
   ```

5. Inspect `dist/`, relative assets/routes, secrets, and unintended files.
6. Create a deterministic complete artifact and record source commit plus
   SHA-256. The repository currently defines no canonical publication command.

## Deployment validation

Publish only through an owner-approved Home/QDN flow and record the resulting
transaction/resource reference. Validate the exact deployed app in embedded
Home: cold/warm start, live join position, continuous playback, refresh/resume,
schedule boundaries, immutable playlist readback, missing-track recovery,
listener playlists/submissions/moderation, Request Show, media, selected
account, transaction UX, and direct routes affected by the release.

Use read-only Core/QDN evidence for resource status and provenance. Tests,
local preview, build, and artifact hashes do not prove playback or deployed
compatibility. Retain owner-live-validation-required until the full gate passes.
