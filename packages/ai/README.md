# @rpgsim/ai

Optional LLM adapters: biography prose, dialogue, chronicles and
long-horizon intention suggestions.

This package is advisory by construction. It may propose; it may never mutate.
Every proposal is parsed into a structured request, validated by simulation
rules, accepted or rejected, and persisted if it affects replay. **The
simulation must run, and pass every test, with this package absent.**

**Status: not yet implemented.** This directory is a placeholder for Phase 9 (AI layer).

It has no `package.json` on purpose, so it is not yet an npm workspace member
and cannot be imported by accident before it exists. Adding one — with
`@rpgsim/ai` as the name and `./src/index.ts` as its entry — is the first
step of the phase that fills it in.

## Rules it will inherit

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`. All randomness comes from the simulation's seeded RNG
  streams (see [docs/DETERMINISM.md](../../docs/DETERMINISM.md)).
- Every significant state change emits a structured event through the bus.
- Balance numbers live in `data/`, not in these sources.
- Systems land with tests before they land in a running world.
