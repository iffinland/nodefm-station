# Player Specification

## 1. One player, multiple modes

Use one global audio engine with explicit playback mode.

```ts
type PlayerMode =
  | "LIVE"
  | "PLAYLIST"
```

The future community music project is separate and should not introduce `PERSONAL` mode here unless the radio product later has a real requirement.

## 2. Global persistence

Audio playback must survive internal page navigation.

The audio engine/provider belongs above route-level pages.

Do not create an independent `<audio>` element per page.

## 3. LIVE mode

### Controls

Allowed:

- play/pause;
- volume;
- mute;
- like;
- share;
- tip;
- return/reconnect to live if drifted or after an error.

Not normal controls:

- arbitrary seek backward/forward;
- shuffle;
- previous track;
- skip next.

### Progress UI

Show:

- track progress;
- elapsed/remaining if useful;
- a clear `LIVE` indicator.

The progress display is read-only in LIVE mode.

## 4. PLAYLIST mode

When a listener chooses a public station playlist:

- stop/suspend live playback;
- switch mode to `PLAYLIST`;
- load selected playlist independently from radio timeline.

Controls:

- play/pause;
- previous;
- next;
- seek;
- shuffle;
- loop/repeat;
- volume.

Always provide:

```text
RETURN TO LIVE
```

Returning to live must recalculate current live state from current time, not resume the old live audio position.

## 5. Track transitions

Prefer gap-minimizing playback.

However, correctness is higher priority than implementing crossfade.

Initial implementation:

- preload metadata/resource readiness where practical;
- move to next deterministic track;
- resync on transitions.

Crossfade is future scope unless implementation is simple and does not alter timeline semantics.

## 6. Audio resource readiness

Audio may be present as QDN resources not locally ready yet.

The player must support states such as:

```text
resolving
preparing
buffering
ready
playing
paused
error
```

Do not display a broken player merely because the first local QDN load needs time.

## 7. Live error recovery

If current audio cannot load:

1. show a calm recoverable state;
2. retry readiness/load according to controlled retry policy;
3. recalculate live state before retrying playback;
4. do not blindly retry the same stale offset forever.

If enough time elapsed to reach a different live track, load the new current track.

## 8. Browser autoplay policy

Do not assume audio can autoplay with sound.

The UI must remain valid if the user needs to press Play once.

After user interaction, continue normal LIVE behavior.

## 9. Player display

Primary public player should show:

- cover art;
- artist;
- track title;
- station/program context;
- live progress;
- like;
- share;
- tip;
- play/pause;
- volume.

## 10. Now Playing vs Upcoming

Player state and upcoming list should consume the same timeline source.

Do not implement duplicate timing logic inside UI components.
