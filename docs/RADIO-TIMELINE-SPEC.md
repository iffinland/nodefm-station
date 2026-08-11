# Radio Timeline Specification

This document defines the most critical subsystem in the app.

## 1. Goal

Given an authoritative station configuration, schedule and playlist data plus a current UTC timestamp, compute:

- whether a scheduled program is active;
- what source should play;
- the current track;
- current offset inside that track;
- upcoming tracks;
- time until transitions.

The result should be deterministic across listeners.

## 2. Core rule

The station does not depend on a continuously running central audio process.

The "live position" is a function:

```text
liveState = f(nowUtc, stationConfig, schedule, playlistVersions, dynamicOccurrences)
```

## 3. Scheduled event resolution

At `nowUtc`:

1. Find an event satisfying:

```text
event.startUtc <= nowUtc < event.endUtc
```

2. If exactly one exists, it is active.
3. If none exists, use default rotation.
4. Overlaps are invalid configuration and must be prevented in admin UI.
5. Runtime must still fail safely if malformed overlap data exists.

## 4. Static scheduled playlist

Given:

```text
eventStart
eventEnd
playlistVersion
now
```

Calculate:

```text
elapsed = now - eventStart
```

If the playlist is shorter than the scheduled event, repeat it:

```text
playlistPosition =
  elapsed mod playlistTotalDuration
```

Then locate the track whose cumulative duration interval contains `playlistPosition`.

Example:

```text
Track A:   0s – 220s
Track B: 220s – 475s
Track C: 475s – 650s
Track D: 650s – 960s
```

At 680 seconds:

```text
current track = D
offset = 680 - 650 = 30 seconds
```

## 5. Default rotation

Default rotation is anchored to `stationEpochUtc`.

Given default playlist duration `D`:

```text
elapsed = nowUtc - stationEpochUtc
position = floorMod(elapsed, D)
```

The timeline must use a proper positive modulo/floor-mod implementation so dates before/after epoch behave predictably if ever encountered.

## 6. Scheduled event end

The event owns the timeline until `endUtc`.

Even if a track is mid-play at event end:

```text
nowUtc >= endUtc
```

the scheduled program ends.

The next state is determined by schedule resolution:

- another event; or
- default rotation.

This means a hard program boundary may interrupt a track.

That is intentional for schedule accuracy.

A future optional feature could add "finish current track", but it must not be the initial behavior because it makes later events drift.

## 7. Upcoming tracks

`getUpcomingTracks(count)` should traverse the same deterministic source timeline and return upcoming items with:

- track ID;
- expected start UTC;
- title/artist metadata when available;
- source/program context.

It must honor event boundaries.

If the current program ends before all requested tracks are filled, traversal continues into:

- the next event; or
- default rotation.

## 8. Client playback synchronization

On entering `LIVE` mode:

1. calculate live state;
2. load current audio;
3. wait until media metadata/playback readiness permits seeking;
4. seek to computed live offset;
5. play after user/browser permissions permit.

### Periodic resync

The player should periodically compare:

```text
expectedLiveOffset
vs
actualAudioCurrentTime
```

If drift is small, do nothing.

If drift exceeds a defined threshold, correct it.

Initial implementation target:

```text
soft tolerance: ~1–2 seconds
hard resync: configurable, e.g. > 3 seconds
```

Final values should be tuned by testing.

## 9. Network/buffering effects

Do not permanently move the station timeline because one listener buffered.

The expected timeline remains clock-based.

After sufficient buffering, the listener should resync toward the current live position.

## 10. Clock source

Initial implementation may use client system time, but the architecture must isolate clock access behind a function/service such as:

```ts
getNowUtcMs(): number
```

This makes it possible to introduce node/network time correction later if real-world testing shows client clock skew is a meaningful problem.

## 11. Invalid duration handling

Track duration is a scheduling invariant.

If a playlist version contains:

- `duration <= 0`;
- missing duration;
- non-finite duration;

it must be considered invalid for live scheduling.

Admin publishing should reject such a playlist version.

Runtime should fail gracefully and report a data error rather than enter an infinite loop.

## 12. Request Show timeline

The Request Show is dynamic before occurrence generation, but static during broadcast.

### At occurrence generation

Inputs:

- scheduled start/end;
- like state snapshot/query;
- eligible station tracks;
- deterministic seed.

Algorithm:

1. Rank eligible liked tracks by defined ranking rules.
2. Append liked tracks without exceeding reasonable slot rules.
3. If airtime remains, choose fallback tracks from eligible station library.
4. Fallback must be deterministic for the occurrence.
5. Persist/publish the occurrence lineup or otherwise make one canonical occurrence resolvable by all listeners.
6. The generated lineup becomes immutable for this occurrence.

### Deterministic fallback

Do not use raw `Math.random()` independently on each listener.

Use a seeded deterministic selection derived from stable occurrence data, for example conceptually:

```text
seed = hash(programDefinitionId + scheduleEventId + startUtc)
```

Exact hashing/selection implementation will be chosen in code.

## 13. Request Show fill policy

Initial desired duration:

```text
30 minutes
```

A practical policy:

- prioritize liked tracks;
- keep adding tracks until the next track would exceed the event end;
- use fallback tracks when liked content is insufficient;
- the radio event itself always ends exactly at the scheduled end time.

If the final track extends beyond event end, it is cut at the schedule boundary.

This preserves deterministic schedule timing.

## 14. Public API of the timeline engine

Conceptual interface:

```ts
type RadioTimelineEngine = {
  getLiveState(nowUtcMs: number): LiveState;
  getUpcomingTracks(nowUtcMs: number, count: number): UpcomingTrack[];
  getCurrentScheduleEvent(nowUtcMs: number): ScheduleEvent | null;
};
```

`LiveState` should include:

```ts
type LiveState = {
  mode: 'scheduled' | 'default-rotation';
  trackId: string;
  offsetMs: number;

  sourceStartUtcMs: number;
  sourceEndUtcMs?: number;

  scheduleEventId?: string;
  playlistVersionId?: string;
  dynamicOccurrenceId?: string;
};
```

## 15. Required unit tests

Must include exact boundary tests:

- one millisecond before event starts;
- exactly at event start;
- exactly at each track boundary;
- exactly at event end;
- one millisecond after event end;
- playlist shorter than event;
- playlist longer than event;
- zero schedule events;
- adjacent schedule events;
- invalid overlap data;
- 30-minute request show with enough liked tracks;
- not enough liked tracks;
- no liked tracks;
- deterministic fallback reproduces identical lineup.

## 16. Recurrence is not a timeline-engine concern

The timeline engine consumes only concrete schedule events with absolute UTC
start and end timestamps.

It must never calculate:

- daily recurrence;
- weekly recurrence;
- station-local recurring wall-clock rules;
- daylight-saving recurrence conversion.

Those concerns belong to the admin schedule-generation layer.

Architecture:

    recurrence definition
        -> schedule generator
        -> concrete UTC events
        -> RadioTimelineEngine

This is a core architecture invariant.
