# data/

Everything the world is made of that is a *number* or a *name* rather than a
rule. CLAUDE.md directive 10: balance values belong in configuration and data
files, not scattered through application code.

A useful test for whether something belongs here: if changing it would change
how the world feels but not how it works, it is data. If changing it would
change what is possible, it is code.

## Layout

| Directory      | Holds                                                     | Arrives in |
| -------------- | --------------------------------------------------------- | ---------- |
| `world/`       | calendar, village layout, locations, buildings, terrain    | Phase 0/1  |
| `occupations/` | trades, their tools, inputs and outputs                    | Phase 3    |
| `items/`       | physical objects: weight, durability, value, use           | Phase 1/3  |
| `recipes/`     | production: inputs, outputs, time, skill and tool required | Phase 3    |
| `plants/`      | crops and wild flora, growth cycles, yields                | Phase 7    |
| `animals/`     | livestock and wildlife, needs, products, lifespans         | Phase 7    |
| `diseases/`    | illnesses, transmission, course, outcomes                  | Phase 2+   |

Only `world/calendar.json` exists so far. The empty directories are the shape
of the thing, kept so that the first file of each kind has an obvious home.

## Rules for files in here

**Every file is validated against a schema when it is loaded.** Loaders live in
`apps/simulator/src/data.ts` and use the Zod schemas exported from
`@rpgsim/shared` and `@rpgsim/sim-core`. A malformed file fails at load with a
message naming the field, rather than producing a world that is subtly wrong.
This is sim-core rule 10: never hide invalid state with silent correction.

**Data is read at world construction and never during a run.** A mid-run read
would make world history depend on the state of the filesystem, and replay
would stop being reproducible. If a system needs a value, it needs it loaded
into the world before tick 0.

**`sim-core` never reads files.** It has no filesystem dependency at all; the
loaders live in the app layer and pass plain objects in. Where a data file has
an in-code counterpart — as `world/calendar.json` has `DEFAULT_CALENDAR` — a
test asserts the two are identical so they cannot drift
(`apps/simulator/test/data.test.ts`).

**Data files are part of the save contract.** A world saved under one set of
data files and reloaded under another may not replay identically. Treat an edit
to a file here the way you would treat a schema change: see the versioning
notes in [../docs/PHASE_0.md](../docs/PHASE_0.md).

## world/calendar.json

The World Zero calendar: 12 months of 30 days, a 360-day year, a 7-day week,
epoch year 1200. The year length is deliberately round — it makes seasonal
arithmetic exact and keeps tick counts free of leap-year special cases.
