# Determinism Rules

These rules apply to every line of code that can affect world state. The full
reasoning is in [docs/DETERMINISM.md](../../docs/DETERMINISM.md); this file is
the checklist.

## Never

1. `Math.random()`. Use `sim.rng(RngStream.X)`.
2. `Date.now()`, `new Date()`, `performance.now()`. Use `sim.tick`.
3. `Math.exp`, `log`, `log2`, `log10`, `log1p`, `pow`, `sin`, `cos`, `tan`,
   `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`,
   `atanh`, `cbrt`, `hypot`, `fround`. These are implementation-defined and may
   differ between engine versions. Only `+ - * /` and `Math.sqrt` are
   IEEE-exact. Use `@rpgsim/shared` (`deterministic-math.ts`).
4. `fetch`, `XMLHttpRequest`, `WebSocket`, or any file read from simulation
   code. Load data at construction and pass it in.
5. Iteration over a `Set`, `Map` or object whose insertion order is not itself
   deterministic, where the result feeds state, a hash or an event. Sort by a
   stable key first.

These are enforced by `packages/sim-core/test/determinism-guard.test.ts`, which
scans the sources. A genuine exception goes in that test's `ALLOWED` list with a
written justification — never in a comment alone.

## Always

6. Draw from a **named** stream. Add a new name to `RngStream` for a new
   subsystem rather than reusing an existing one; sharing a stream couples two
   systems so that a change to one silently perturbs the other.
7. Schedule with an explicit `Priority`. Two events at the same tick must be
   ordered by phase, not by luck.
8. Persist everything that affects the future — including handles to pending
   scheduled events. A missing handle saves and loads with a matching hash and
   diverges later.
9. Prefer integers. Money, ticks, counts and quantities are integers by design.
10. Add a deterministic replay test with any new scheduler or RNG behaviour
    (sim-core rule 12) and an invariant for any new core concept (rule 11).

## Before calling a determinism test done

Ask what would still pass if the system were broken, then write the test that
would not. Hash equality across a save/load boundary does **not** prove a save
is complete or canonical — the hash is computed from the save, so a symmetric
omission is invisible to it. Mutate the code on purpose and confirm a test goes
red.

If a code path only fires once per simulated year, the test suite cannot see it.
Either tune the harness so the path is common, or aim a test directly at the
tick where it fires.

## Before merging

- `npm run check` (typecheck plus the full suite).
- `npm run verify` — the five acceptance checks — passes.
