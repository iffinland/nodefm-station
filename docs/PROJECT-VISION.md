# Project Vision — NodeFM Station

## 1. Product definition

NodeFM Station is a Qortium-native scheduled auto-DJ radio dApp.

The first product is a **radio station**, not a general music publishing platform.

The listener opens the app and sees:

- the live player;
- current track metadata and cover art;
- the next tracks that will play;
- today's/upcoming schedule;
- station notices/information;
- a direct-message action to the station owner;
- like, share and tip/donation actions;
- public station playlists that can optionally be listened to outside the live broadcast.

The station owner has an authenticated admin area for managing tracks, playlists, schedule, notices and station settings.

## 2. Primary user experiences

### Listener

A listener should be able to:

1. Open the dApp and immediately determine what is live now.
2. Start listening at the correct live position.
3. See what tracks are coming next.
4. View the schedule.
5. Like the current track.
6. Tip the station owner.
7. Share the app or a public playlist.
8. Send a direct message to the station owner.
9. Browse public station playlists.
10. Leave the live station temporarily and listen to a selected playlist with normal player controls.
11. Return to live radio with one clear action.
12. Submit music for possible inclusion in the station Library. A submission
    remains listener-owned until the station owner explicitly accepts it.

### Station owner

The station owner should be able to:

1. Upload new audio from the local computer.
2. Add existing QDN audio/resources into the station library without unnecessary duplication.
3. Edit station-side track metadata:
   - title;
   - artist;
   - description;
   - cover art;
   - tags/genres where used.
4. Create playlists.
5. Reorder tracks using drag-and-drop.
6. Save and publish playlist versions.
7. Schedule playlist versions by date and time.
8. Manage the default 24/7 rotation.
9. Create and manage station notices.
10. Read/manage messages directed to the station where supported.
11. Configure station identity and owner/payment information.
12. Review and moderate listener-submitted music from the Library admin area.

## 3. Critical invariant: the station always advances

The live station must not restart from the beginning when the app is reopened.

Example:

- Listener opens the app while Track A is live.
- Listener closes the app.
- Ten minutes later, the listener opens the app again.
- The dApp calculates the actual current broadcast state.
- If the station timeline has advanced to Track D, Track D begins at the correct in-track offset.

The radio timeline exists independently of whether any listener has the dApp open.

## 4. Default rotation

The station has a default rotation that acts as the 24/7 fallback.

Rules:

- If a scheduled program is active, it overrides default rotation.
- When the scheduled program ends, the station returns to:
  - the next scheduled program if one begins immediately; or
  - default rotation.
- Default rotation must itself be deterministic and reconstructable from a fixed epoch and playlist version.

## 5. Request Show / Liked Tracks Show

A special scheduled program will function like a listener request show.

Initial target:

- duration: **30 minutes**;
- planned as a recurring scheduled program;
- source: tracks liked by listeners;
- ordering policy: most-liked first or another deterministic ranking defined later.

If there are not enough liked tracks to fill the 30-minute slot:

1. use available eligible liked tracks first;
2. fill remaining airtime using deterministic fallback selection from the station's eligible music pool;
3. avoid breaking the timeline or ending the show early merely because likes are insufficient.

This feature should be modeled as a **dynamic playlist/program source**, not as a manually maintained static playlist.

Potential future dynamic programs:

- Most Liked;
- Trending This Week;
- New Releases;
- Most Played;
- Station Favorites.

Only the Request Show / liked-based program is an initial priority.

## 6. Public playlist listening

Public playlists are separate from live radio.

When a listener selects a playlist:

- live audio stops;
- player mode changes from `LIVE` to `PLAYLIST`;
- the listener receives normal controls:
  - play/pause;
  - previous/next;
  - seek;
  - shuffle;
  - repeat/loop;
- a clear `Return to Live` action is available.

The live station timeline continues independently while the listener is in playlist mode.

## 7. Future music platform boundary

A future Q-Music-like community music app is intentionally **not part of this radio project**.

That future project may include:

- user uploads;
- creator profiles;
- user playlists;
- music discovery;
- public browsing;
- likes;
- creator tipping;
- personal player;
- social discovery.

This radio dApp must not pre-implement that platform.

It should only avoid architectural choices that make interoperability impossible later.

## 8. Explicit non-goals for the first radio project

- Rebuilding old Q-Music.
- Importing old Q-Music code.
- Acting as a Spotify/Q-Music clone.
- Requiring a centralized streaming server.
- Requiring a backend daemon to keep one global `<audio>` element playing.
- Implementing a full creator/user music publishing ecosystem.
