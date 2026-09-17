# Phase 0 — Constitution

**Status: complete.** Exit criteria met: the same seed produces identical
histories, and save/load resumes identically.

This document is the implementation record for Phase 0: what was built, why it
was built that way, where the implementation deviates from the design documents,
and what was knowingly left undone.

Phase 0 builds the kernel and nothing else. There is no village, no NPC, no
economy, no psychology, no combat, no politics, no UI and no LLM here, by
design. What exists is the machinery every one of those will be built on:
time, randomness, ordering, events, identity, persistence, and the tests that
prove they behave.

---

## 1. What exists

### `packages/shared` — primitives with no simulation knowledge

| File | Responsibility |
| --- | --- |
| `assert.ts` | `assert` / `fail` with structured context; the standard way to refuse invalid state |
| `binary-heap.ts` | Comparator-driven binary heap, used by the scheduler |
| `brand.ts` | Nominal typing helper, so an `EntityId` cannot be passed where a `string` is meant |
| `canonical-json.ts` | Deterministic serialisation: sorted keys, `-0` normalised, non-finite rejected |
| `deterministic-math.ts` | Clamping, lerp, integer helpers, Irwin–Hall Gaussian — only IEEE-exact operations |
| `hash.ts` | FNV-1a 32 and 64-bit hashing |
| `json.ts` | `JsonValue` / `JsonObject` types, the wire format for all persisted state |

### `packages/sim-core` — the simulation kernel

| File | Responsibility |
| --- | --- |
| `rng.ts` | xoshiro128\*\* PRNG with splitmix32 seeding; integer, float, bool, choice, shuffle, Gaussian; save/restore including a draw counter |
| `rng-streams.ts` | Named independent streams derived from the world seed |
| `clock.ts` | Tick counter; the only source of "now" |
| `calendar.ts` | Tick to date arithmetic; months, seasons, weekdays, formatting |
| `scheduler.ts` | Priority queue over `(tick, priority, sequence)`, lazy cancellation, canonical serialisation |
| `events.ts` | `SimEvent`, the event bus, subscriptions and filters |
| `event-log.ts` | Bounded ring buffer of history, causal tracing, sinks |
| `ids.ts` | Typed, stable, deterministic entity identifiers |
| `invariants.ts` | Registry of read-only checks; reports violations, never repairs them |
| `save.ts` | Versioned per-module save envelope, migrations, canonical hashing, `MemorySaveStore` |
| `save-file-store.ts` | `JsonFileSaveStore`: the same interface backed by files on disk |
| `simulation.ts` | The `Simulation` facade that wires all of the above together |

### `apps/simulator` — the headless driver

| File | Responsibility |
| --- | --- |
| `probe-world.ts` | The Phase 0 test harness: minimal agents that exist to exercise the kernel |
| `verify.ts` | The five acceptance checks, as runnable code |
| `data.ts` | Schema-validated loading of `data/` files |
| `cli.ts` | `run`, `resume`, `verify`, `help` |

### Commands

```bash
npm run check     # typecheck + full test suite
npm run verify    # the five determinism acceptance checks
npm run sim -- run     --seed world-zero --days 30 --save
npm run sim -- resume  --seed world-zero --days 30
```

### Test coverage

227 tests across 11 files — roughly 2,700 lines of test against 3,650 lines of
source. Of those, the suites that exist purely to prove the kernel's central
claim are `determinism.test.ts` (19), `determinism-guard.test.ts` (12) and the
save/load sections of `simulation.test.ts` and `save.test.ts`.

---

## 2. Architectural decisions

### The tick is one simulated second

A tick is the smallest unit of simulated time. At 1 second, a 360-day year is
31,104,000 ticks — comfortably inside `Number.MAX_SAFE_INTEGER` for centuries of
simulated history, so ticks stay ordinary integers with no BigInt anywhere.

Crucially, **nothing is polled per tick**. The scheduler jumps straight to the
next scheduled event, so the cost of a run is proportional to how much happens,
not to how much time passes. A fine-grained tick is therefore free: it buys
precision in action durations without costing anything at rest.

### Scheduled intents and recorded facts are different types

`ScheduledEvent` is a *future intent* — it has a target tick, a priority, a
payload, and it can be cancelled. `SimEvent` is a *past fact* — it has an id, a
tick, actors, data, and causes, and it is immutable.

Merging the two is the most common way an event log becomes untrustworthy as
history: a log that contains cancellable entries is a log of what might have
happened. Keeping them separate means the event stream is exactly the record of
what did happen, which is what the `WHY?` feature and the observer will read.

### Ordering is a total order, not a heuristic

`(tick, priority, sequence)` leaves no ties. Priority gives the intra-tick
phase ordering that the world model needs — environment resolves before
physiology, physiology before decisions, bookkeeping last — and `sequence` is a
monotonic counter that breaks everything else by insertion order. No comparison
ever falls through to heap position or object identity.

### Randomness is split into named streams

Deriving an independent generator per subsystem from `(worldSeed, streamName)`
means adding a weather roll cannot shift NPC decisions. Without this, every
behavioural diff is noise and bisecting a change is impossible. The cost is one
hash per stream at first use; the benefit is that behaviour stays attributable.

### Only IEEE-exact float operations, ever

`+ - * /` and `Math.sqrt` are the only float operations specified to the bit.
Everything transcendental is implementation-defined and can change between
engine versions. Gaussian noise therefore uses Irwin–Hall rather than
Box–Muller: no `log`, no `sqrt` of a random, no `cos`. It has bounded support in
`[-6, +6]`, which is a second benefit — the simulation can never produce a
ten-sigma outlier that a designer never considered.

This is enforced by a test that scans the source, not by convention.

### Saves are per-module and versioned

Each system registers a save module with an id, a version, `save()`, `load()`
and optional `migrate()`. The envelope stores modules independently, so adding
the economy in Phase 3 does not touch the format of anything else, and an old
save missing a module is a recognisable, reportable condition rather than a
crash.

Loading refuses outright when the world seed differs, when a module is missing,
or when the save contains a module nothing has registered. Prime Directive 16
asks for backward compatibility where practical; migrations are the mechanism,
and refusing loudly is what happens when it is not practical.

### Invariants report; they never repair

The registry runs read-only checks and returns violations.
`assertInvariants()` throws on anything of `error` severity. Nothing silently
corrects state — sim-core rule 10. A world that has reached an impossible state
has a bug, and hiding it converts a findable bug into an unfindable one.

### The event log is bounded, with an unbounded escape hatch

`event-log.ts` keeps a ring buffer of recent events for causal tracing, with
`EventSink` for anything that wants the full stream (a file, a database, a test
recorder). CLAUDE.md's first objective names unbounded event growth as a failure
mode; a 1,000-NPC world running for a simulated year would otherwise exhaust
memory on history alone.

### `sim-core` touches no files and no clock

Data loading lives in the app layer (`apps/simulator/src/data.ts`) and passes
plain validated objects in. The kernel has no filesystem dependency, which keeps
Prime Directive 1's spirit (no dependency on anything outward-facing) and makes
replay independent of the state of the disk.

---

## 3. Deviations from the design documents

CLAUDE.md requires that deviations be recorded rather than made silently.

### SQLite is not used yet

**Design says:** SQLite via `better-sqlite3` in the recommended stack.
**Phase 0 has:** a `SaveStore` interface with two implementations,
`MemorySaveStore` and `JsonFileSaveStore`.

**Why.** `better-sqlite3` is a native module requiring a per-platform build
toolchain, which is real friction to impose before there is anything to store.
More importantly, Phase 0's saves are small and whole-world, so SQLite would
contribute nothing the JSON store does not: canonical serialisation, versioning,
migrations and the round-trip tests are all format-independent.

**Why this is not a trap.** `SaveStore` is a two-method interface
(`read(key)` / `write(key, envelope)`). A `SqliteSaveStore` implements it
without touching the kernel, and the existing store tests can be run against
both implementations. The decision to switch is a decision about performance, to
be made with a profile in hand, not in advance.

**When to revisit.** When whole-world saves get large enough that rewriting the
file hurts, or when the observer wants to query history rather than replay it —
realistically around Phase 3 (economy) or Phase 8 (observer).

### Zod is used only at the data boundary

**Design says:** Zod or equivalent runtime schema validation.
**Phase 0 has:** Zod schemas for data files; internal state uses TypeScript
types plus `assert`.

**Why.** Validating a data file protects against a human typo, which is a real
and frequent hazard. Validating internal state on every transition would cost
per-tick performance to protect against a class of bug the type system already
catches. Save loading validates structurally through `assert`, which is where
untrusted input actually enters.

### No build step

Both packages resolve through tsconfig `paths` and vitest `resolve.alias`
directly to `src/index.ts`, and the CLI runs under `tsx`. There is no `dist/`,
no build ordering and no stale-artifact class of bug. When the observer app
needs bundling, Vite will handle its own build; the simulation packages can stay
source-only indefinitely.

---

## 4. The probe world

`apps/simulator/src/probe-world.ts` is a **test harness, not World Zero**. It
contains a handful of "probes" that wake at dawn, act, tire, rest, and get
interrupted by storms. They have no needs model, no knowledge model, no economy
and no location, and they must not grow one. Phase 1 builds the village in
`packages/world` and `packages/npc`; the probe world stays what it is.

It exists because the kernel's guarantees are about *interaction* — scheduling
plus cancellation plus randomness plus save/load — and those cannot be tested
with unit tests over each piece alone. It is deliberately tuned so that its
awkward paths are common: storms are far more frequent than any plausible
climate, because the storm branch is the only cancellation path in the harness,
and a path that fires twice a simulated year is a path no test can see.

That tuning was not guesswork. It came from deliberately breaking the code to
find out what the tests could not see; see section 5 of
[DETERMINISM.md](DETERMINISM.md).

---

## 5. Technical debt and known gaps

Listed so that nothing here is a surprise later. Nothing in this list blocks
Phase 1.

1. **`JsonFileSaveStore` writes are not atomic.** A crash mid-write can leave a
   truncated save. The fix is write-to-temp-then-rename; it was skipped because
   Phase 0 saves are small and disposable. Fix before any save the user would
   mind losing.
2. **No SQLite store.** See section 3. The seam exists; the implementation does
   not.
3. **No compression or delta saves.** Whole-world JSON per save. Fine for 12
   probes; a 1,000-NPC world with a thousand objects will want revisiting around
   Phase 10 (scale).
4. **No wall-clock performance budget.** The kernel is measured for correctness,
   not speed. There is no benchmark suite and no regression guard on tick
   throughput. Phase 10 will need one; adding it earlier would be optimising
   against a world that does not exist.
5. **The event log has no persistent sink implementation.** The `EventSink`
   interface exists and is used by tests; nothing writes history to disk yet.
   The observer will need one. *Being closed now:* the Chronicle needs the whole
   of a day and weeks of continuing story, which the in-memory ring buffer
   cannot hold, so slice 1 of [CHRONICLE_V1.md](CHRONICLE_V1.md) implements it.
6. **Migrations are untested against real old saves.** The migration mechanism
   is tested with synthetic version bumps. Until there is a genuine v1 save to
   migrate, that is the best available evidence.
7. **The determinism guard is a source scanner.** It greps for banned
   constructs, so it can be defeated by indirection (`globalThis['Math']['random']`).
   It is a guard rail against accident, not an adversary. Strengthening it to an
   AST or ESLint rule is worthwhile once there is a linter in the repo.
8. **No linter or formatter.** Style is consistent by hand. ESLint plus a
   formatter should land before the codebase has more than one author.
9. **No CI.** `npm run check` is run manually. It should run on push.
10. **`allowImportingTsExtensions` is on.** Imports carry `.ts` specifiers,
    which is correct for a `noEmit` project run through tsx and vitest, but
    means these packages cannot be `tsc`-emitted as-is. If a package ever needs
    to ship compiled output, that is the constraint to revisit.
11. **The calendar is the only data file.** `data/` has the directory shape for
    occupations, items, recipes, plants, animals and diseases, and nothing in
    them. Each arrives with the phase that needs it.

---

## 6. Phase 0 exit criteria

| Criterion | Evidence |
| --- | --- |
| Seeded RNG reproducibility | `rng.test.ts`; `verify` check 1 |
| Stable event ordering | `scheduler.test.ts`, `events.test.ts`; acceptance suite |
| Deterministic scheduler execution | `determinism.test.ts` — same state whether run by day, in one jump, in ragged chunks, or one event at a time |
| Save/load continuation | `verify` check 3; six-cycle save/reload chain; JSON file round-trip; CLI run-then-resume |
| Identical replay from identical inputs | `verify` checks 1 and 2 |

`npm run check`: 227 tests passing. `npm run verify`: 5/5 checks passing.

**Phase 0 ends here.** Phase 1 (World Zero skeleton: village, locations,
buildings, ~100 NPCs, households, movement, sleep/wake) begins in
`packages/world` and `packages/npc`.
