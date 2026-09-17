# @rpgsim/simulator

The headless driver. Build a world, run it, save it, resume it, verify it.

Until the observer UI exists (Phase 8), this is the only way to drive the
simulation, which is why CLAUDE.md's development philosophy asks that every
system work here before any UI is written.

**Status: Phase 1 complete.** `npm run sim -- run` builds World Zero from
`data/world/village.json` — 86 people in 24 households across 38 places — and
runs it.

## Using it

```bash
npm run sim -- run --days 4 --every 2      # build World Zero and run four days
npm run sim -- verify                      # the five determinism checks
npm run sim -- help
```

```
village, seed "world-zero", 4 days

  Blossom 1, 1200 (Restday) 00:00:00  people=86  households=24  places=38  asleep=86  travelling=0  events=0
  Blossom 3, 1200 (Moonsday) 00:00:00  people=86  households=24  places=38  asleep=86  travelling=0  events=1320
  Blossom 5, 1200 (Midweek) 00:00:00  people=86  households=24  places=38  asleep=86  travelling=0  events=2640

final state: Blossom 5, 1200 (Midweek) 00:00:00  ...
state hash:  edc35fdf84c49af3
world time:  1200-04-05 00:00:00
```

Saving and resuming:

```bash
npm run sim -- run    --seed alder --days 6 --save --key alder
npm run sim -- resume --seed alder --days 4 --key alder
```

The resumed world lands on exactly the state a ten-day uninterrupted run would
have reached — same hash, same events, same pending schedule.

| Option | Means |
| --- | --- |
| `--world <name>` | `village` (default) or `probe` |
| `--seed <string>` | the world seed; the same seed builds the same world |
| `--days <n>` | simulated days to run |
| `--probes <n>` | probe agents, `--world probe` only |
| `--dir <path>` / `--key <name>` | where a save goes and what it is called |
| `--save` | write a save when the run finishes |
| `--every <n>` | print a status line every n simulated days, `0` for none |
| `--archive <path>` | write the durable event history there, one file per simulated day |
| `--rewrite` | let `--archive` replace days it finds already written |

## Keeping a durable history

`--archive` attaches an `EventArchive` to the run and writes every event to
disk, one file per simulated day:

```bash
npm run sim -- run --days 3 --archive ./history
```

```
history/
  manifest.json
  days/1200-04-01/events.jsonl
  days/1200-04-02/events.jsonl
  days/1200-04-03/events.jsonl
```

The sink is attached **before** worldgen runs, not to the world that comes
back. Worldgen announces every person and every household as it makes them, and
those announcements are the only record of who anybody is — an archive opened a
moment later holds a village of strangers. That is what `WorldFactory`'s
`beforePopulating` hook exists for, and it is the only place in the run where
the order matters.

The event log keeps only a bounded window in memory on purpose — unbounded
event growth is a named failure mode in CLAUDE.md — so this is where anything
that needs the whole of a day reads from instead. The Chronicle
([docs/CHRONICLE_V1.md](../../docs/CHRONICLE_V1.md)) is the first such reader.

Each day in `manifest.json` carries the world's state hash at the moment that
day ended. That is the evidence the launch freeze is checked against: a rebuild
that produces a different hash for a day already published has rewritten
history. The manifest also carries `complete`, which is `true` only once the run
closed the archive itself — so a publisher can tell a finished day from the
wreckage of a run that died halfway.

Days are written whole, through a temporary file and a rename, so a day file
that exists is a day that is final. Writing over a day this run did not write is
refused unless `--rewrite` says otherwise, because re-running an already
archived world is easy to do by accident and the silent result would be a day
whose events happened twice.

## What is here

| Module | Owns |
| --- | --- |
| `cli.ts` | argument parsing, the four commands, and reading `data/` |
| `data.ts` | the loaders: calendar, village, name book — each validated |
| `village-schema.ts` | the shape `data/world/village.json` must have |
| `village-world.ts` | `VillageWorld`: worldgen, and the wiring of five systems |
| `probe-world.ts` | the Phase 0 kernel harness, still reachable and still run |
| `verify.ts` | the five acceptance checks, against whichever world it is given |

## Four things worth knowing before reading the code

**This app reads the files; nothing downstream does.** Determinism rule 4
forbids simulation code from touching the filesystem, because a world that read
its own config would be a world whose history depended on the state of the disk.
So the loaders live here, every file is validated against a schema at the
boundary, and the parsed values are passed in. A typo in a data file fails
immediately with every reason listed, rather than producing a subtly wrong
world that runs for thirty days.

**Data names places by slug; the simulation allocates the ids.**
`village.json` says `"mill-lane"`, never `location:7`. Entity ids come from
`sim.newId` and are an artefact of the order worldgen runs in, so writing them
into data would make a file edit capable of renumbering an existing world.
Worldgen keeps a slug-to-id table for the length of one `populate()` call and
throws it away. Every collection in the file is a JSON **array**, because
determinism rule 5 forbids an iteration order that is not itself deterministic
— which also means the order of those arrays is part of what a seed means.

**Public places are authored; dwellings are generated.** The green, the lanes,
the church, the mill and the roads out are written down one by one with their
own travel costs, because a village's shape is a decision. The cottages are
not: the file says how many there are and which lanes they stand on, and
worldgen lays them out. Hand-writing twenty-four near-identical blocks would
put the house count and the household count in two places that can disagree.

**Both worlds go through the same `WorldFactory`.** `verify` does not know what
a village is; it is handed something that builds a world from a seed and checks
the five guarantees about whatever comes back. That is what lets `npm run
verify` prove them about World Zero rather than about a harness. It counts days
from the world's own starting tick, because the probe world opens at tick 0 and
the village opens on a date.

## The probe world, and why it stays

`--world probe` is the Phase 0 harness: a dozen agents with no economy, needs,
knowledge or spatial model, tuned so that cancellation, colliding priorities and
save/load edge cases happen often enough for tests to see them. It is not World
Zero and must not grow into one. It stays because it still covers ground the
village does not — a village nobody has yet given a reason to cancel anything
never exercises cancellation — and deleting it would lose that coverage on the
day the village stops exercising it.

## Rules it inherits

- No UI dependencies. The observer is a separate app.
- Everything it builds must run with no LLM and no network.
- `npm run check` (typecheck plus the full suite) and `npm run verify` both pass
  before anything here is called done.
