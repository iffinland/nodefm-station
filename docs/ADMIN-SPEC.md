# Admin and Scheduler Specification

## 1. Access

Admin routes are owner-only initially.

Requirements:

- authenticated identity required;
- authorization check required;
- hidden buttons alone are not authorization.

## 2. Admin sections

```text
Dashboard
Library
Playlists
Schedule
Messages
Station
```

## 3. Dashboard

Show:

- current on-air program;
- current track;
- remaining program time;
- next scheduled program;
- default rotation status;
- quick actions:
  - Add Track;
  - Create Playlist;
  - Schedule Playlist.

## 4. Library

### List fields

Useful columns/cards:

- cover;
- title;
- artist;
- duration;
- source;
- schedule eligibility/status.

### Add Track

Two flows:

#### Upload from computer

1. select audio;
2. resolve duration;
3. publish audio using validated Qortium/QDN flow;
4. optionally upload/publish cover;
5. create station Track metadata resource/reference;
6. verify publication/readiness sufficiently for user feedback.

#### Add QDN

1. search/browse existing QDN-compatible audio resources;
2. select resource;
3. inspect/enter metadata;
4. resolve duration;
5. store resource reference;
6. do not duplicate media unless required.

### Edit Track

Station metadata may be editable:

- title;
- artist;
- description;
- cover;
- tags/genre.

Edits must not corrupt playlist historical scheduling.

If playlist versions snapshot only `trackId` and duration while current display metadata changes, the product accepts metadata updates without changing historical sequence. If historical metadata must also be immutable later, versioning can be expanded.

## 5. Playlist editor

Functions:

- create;
- rename;
- description;
- cover;
- public/private;
- add tracks;
- remove tracks;
- drag-and-drop;
- total duration;
- duplicate;
- save draft;
- publish new immutable version.

Show:

```text
Track count
Total duration
Current published version
Unsaved changes state
```

## 6. Scheduler

Primary UI:

### Week View

Calendar-like week layout with time axis.

Capabilities:

- previous/next week;
- today;
- click empty slot to create event;
- drag event to another date/time;
- resize event duration;
- click event to edit;
- clear visual distinction for program types.

### Agenda View

Chronological list for precise review.

Example:

```text
Tuesday
18:00–20:00 Evening Rock
20:00–20:30 Request Show
20:30–22:00 Electronic Session
```

Month view is not an initial priority.

## 7. Schedule event editor

Fields:

- title;
- date;
- start time;
- end time;
- source type;
- playlist and playlist version; or
- dynamic program.

Validation:

- start < end;
- no overlaps;
- source is valid;
- referenced playlist version is schedule-valid;
- all static playlist tracks have valid durations.

## 8. Default rotation

Station settings must select:

- logical default playlist;
- specific published version used by the timeline;
- station epoch UTC.

Changing default rotation should be an explicit admin operation.

Avoid accidental timeline changes from merely editing a playlist draft.

## 9. Request Show admin configuration

Initial configuration:

```text
Enabled: yes
Target duration: 30 min
Ranking: Most Liked
Fallback: station music pool
Fallback selection: deterministic
```

Scheduling the Request Show should create a normal schedule event pointing to the dynamic program definition.

The resulting occurrence lineup must become canonical before/during the event so every listener hears the same sequence.

## 10. Station notices

Owner can:

- create notice;
- edit notice;
- enable/disable via active window;
- optionally set title;
- set start/end UTC through local-time admin UI.

Public radio page shows the currently active notice(s) in a compact box.

## 11. Time handling

Admin may operate in:

```text
Europe/Helsinki
```

or station-configured timezone.

Storage and timeline calculations must use UTC.

UI conversion must handle daylight saving time through proper timezone-aware date utilities, not fixed UTC offsets.

## 12. Conflict handling

Scheduler should block ordinary overlapping events before publish.

If remote/concurrent updates create a conflict anyway:

- runtime must detect it;
- do not choose arbitrarily without a documented deterministic policy;
- surface admin warning.

A later architecture decision may define revision precedence if QDN publication semantics require it.
