# Determinism

> Prime Directive 3: *the same seed plus the same inputs must produce the same
> world history.*

This document explains how that is achieved, what can break it, and how the
repository catches a break. It is the reference for anyone adding a system to
the simulation.

Determinism is not a nice property here; it is the foundation. Without it,
save/load is a lie, bug reports are unreproducible, an NPC's `WHY?` explanation
cannot be trusted, and there is no way to tell a behaviour change from noise.

---

## 1. What "deterministic" means in this project

Two runs of the same world are *identical* when, at every tick, they have:

- the same state (compared by `sim.hash()`),
- the same event stream, in the same order, with the same event ids,
- the same pending scheduled events, in the same execution order,
- the same RNG draw counts in every stream.

That is stronger than "the same final state", and deliberately so. A world that
arrives at the same place by a different route has a bug that will surface
later.

Determinism is guaranteed **on one build of one engine**. Across V8 versions,
Node versions and platforms it holds as long as the rules in section 3 are
followed; the float rules exist precisely to make that true.

## 2. The sources of order

### The seed

One world seed (a string) is the only entropy the simulation ever gets.
Everything random is derived from it.

### Named RNG streams

Randomness is never drawn from a single global generator. `RngStreams` derives
an independent xoshiro128** generator per named stream, by hashing
`(worldSeed, streamName)` with FNV-1a and expanding that through splitmix32.

```ts
const rng = sim.rng(RngStream.Weather);
const roll = rng.nextIntInclusive(1, 6);
```

The stream names live in `packages/sim-core/src/rng-streams.ts`:
`worldgen`, `npc_decisions`, `npc_generation`, `weather`, `demographics`,
`health`, `combat`, `economy`, `social`, `ecology`, and `scratch` (tests only).

**Why streams matter.** If weather and NPC decisions shared a generator, adding
one extra weather roll would shift every subsequent decision in the world.
Every behavioural diff would be noise and bisecting would be impossible. With
streams, a change to weather perturbs weather.

**Add a stream name rather than reusing one.** Two unrelated systems sharing a
stream re-creates the coupling the design exists to prevent.

### The scheduler's total order

Events execute in a strict total order over the triple:

```
(tick, priority, sequence)
```

`tick` is when, `priority` is the phase within the tick (see `Priority` in
`scheduler.ts`: System, Environment, Ecology, Physiology, Movement,
ActionComplete, Perception, Decision, Economy, Social, Bookkeeping), and
`sequence` is a monotonic counter that breaks remaining ties by insertion
order. There are no ties left after `sequence`, so there is no room for a heap
or a sort to make an arbitrary choice.

Cancellation is lazy: cancelling marks a tombstone and the scheduler discards it
on pop. This keeps cancellation O(1) and, more importantly, keeps it from
disturbing the sequence numbering of anything else.

### The event bus

Handlers run in registration order. An event emitted from inside a handler is
**queued**, not dispatched recursively — the bus drains breadth-first. Two
worlds that register the same handlers in the same order therefore see the same
interleaving.

### The state hash

`sim.hash()` canonicalises state to JSON with sorted keys (`-0` normalised to
`0`, non-finite values rejected outright) and hashes it with FNV-1a-64. Two
worlds that disagree anywhere disagree in the hash. `createdAt` — the
wall-clock stamp on a save — is excluded, because it is the one field that is
legitimately different between two identical runs.

## 3. The rules

### Never `Math.random()`

Prime Directive 4. Use `sim.rng(stream)`.

### Never read the wall clock

`Date.now()`, `new Date()`, `performance.now()` — a world's behaviour must not
depend on when it was run. Simulation time comes from `sim.tick` and the
calendar. (`save.ts` stamps `createdAt` with `new Date()` for humans reading
save files; it is excluded from the hash, and the guard test has an explicit
allowlist entry recording that.)

### Only IEEE-exact float operations

`+`, `-`, `*`, `/` and `Math.sqrt` are exactly specified by IEEE 754 and
reproduce bit-for-bit everywhere. `Math.exp`, `log`, `pow`, `sin`, `cos`,
`atan2`, `hypot`, `cbrt`, `fround` and friends are **implementation-defined**:
V8 may compute them differently from another engine, or differently after an
upgrade. A one-ULP difference in a single NPC's utility score is enough to flip
a decision and fork world history.

Use the helpers in `@rpgsim/shared` (`deterministic-math.ts`). Gaussian noise
uses an Irwin–Hall sum rather than Box–Muller for this reason (and gets bounded
support in `[-6, +6]` as a bonus — no ten-sigma outlier can ever appear).

Prefer integers where you can. Money, ticks, counts and inventory quantities
are integers by design.

### Never iterate an unordered collection to produce state

`Set` and `Map` iterate in insertion order, which is well-defined but depends on
the order things were inserted — which can differ between a fresh world and a
loaded one. Sort by a stable key before iterating if the result feeds state, a
hash or an event.

Object key order has the same hazard; the canonical JSON serialiser sorts keys
so that saves and hashes cannot inherit it.

### Never do I/O inside a running simulation

No file reads, no network, no LLM calls on the tick path. Data is loaded at
world construction and passed in (see [../data/README.md](../data/README.md)).
Prime Directive 2: the simulation must never require an LLM to advance time,
and Prime Directive 15: it must run with no external AI API at all.

### Persist everything that affects the future

If a value influences what happens next, it belongs in a save module — including
handles to pending scheduled events. This is the subtle one: a system that
forgets to persist a cancellation handle still saves and loads with a matching
hash, and diverges only later, when something tries to cancel an event it no
longer knows about. See section 5.

## 4. How a break is caught

| Mechanism | Lives in | Catches |
| --- | --- | --- |
| `npm run verify` | `apps/simulator/src/verify.ts` | The five acceptance checks, in one command |
| Acceptance suite | `apps/simulator/test/determinism.test.ts` | Replay, scheduling, save/load, invariants, log bounds |
| Guard suite | `packages/sim-core/test/determinism-guard.test.ts` | Banned constructs, by scanning the source |
| Invariant registry | `packages/sim-core/src/invariants.ts` | Illegal state, at a boundary, without repairing it |
| Event budget | `simulation.ts` (`maxEventsPerRun`) | Same-tick reschedule loops, before they hang the process |

The five checks `npm run verify` runs:

1. **identical replay** — two fresh worlds, same seed, hashed at every day
   boundary, must agree at every one.
2. **seed sensitivity** — a different seed must produce a different history.
   Without this control, a kernel that ignored the seed entirely would pass
   every other check.
3. **save/load continuation** — run, save, load into freshly wired systems,
   continue; must land exactly where an uninterrupted run landed.
4. **saving is side-effect free** — the world that was saved must continue as if
   it had never been saved.
5. **invariants** — all registered invariants hold at the end of the run.

The guard suite is a source scanner, not a runtime check. It searches
`packages/shared/src`, `packages/sim-core/src` and `apps/simulator/src` for
`Math.random`, `Date.now`, `new Date`, `performance.now`, the
implementation-defined `Math` functions, unordered iteration feeding state, and
`fetch`/`XMLHttpRequest`/`WebSocket`. Exceptions require an entry in its
`ALLOWED` list with a written reason — the allowlist is the record of every
deliberate deviation.

## 5. Writing a determinism test that actually has teeth

A passing test suite is not evidence. During Phase 0 two mutations were
introduced deliberately to find out whether the suite could see them:

**Mutation A: remove the scheduler's canonical sort before serialisation.** The
whole acceptance suite still passed. Restoring a binary heap by pushing
elements that are already in valid heap order reproduces the identical array, so
hash equality survives. Only the scheduler unit test, which asserts the
serialised order is *execution* order rather than heap order, caught it. The
lesson: hash equality across a save/load boundary does not prove the save is
canonical, because the hash is computed from the save.

**Mutation B: drop a pending-cancellation handle from a save module.** Nothing
caught it at first, for the same reason — a symmetric omission is invisible to a
hash — and because behaviour only diverges in the narrow window where something
actually cancels the forgotten event. Two changes fixed that, and both are worth
copying:

- *Make the rare path common in the harness.* The cancellation path was tuned to
  fire roughly twice a month instead of twice a year. A path that fires once per
  simulated year is a path the tests cannot see.
- *Aim the test at the window instead of hoping to land in it.* The test now
  scouts the run for the first tick at which a cancellation actually occurs,
  then saves one tick before it.

So: when you add a system, ask what would still pass if this were broken, and
write the test that would not.

## 6. What is deliberately *not* guaranteed

- **Cross-engine determinism outside these rules.** Follow section 3 and it
  holds; reach for `Math.pow` and it does not.
- **Stability across data-file edits.** Changing `data/` changes the world. Data
  files are part of the save contract.
- **Stability across save-format migrations.** Migrations may change state by
  design; that is what they are for. What must hold is that a migrated world
  continues deterministically from where it is.
- **Wall-clock reproducibility.** Two runs take different amounts of real time.
  Only simulated time is reproducible.
