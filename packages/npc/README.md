# @rpgsim/npc

Traits, needs, decisions, memory and goals: the interior of a person.

This package will own what an NPC is and how it chooses, including the
explainable action scoring behind the `WHY?` feature. It depends on `sim-core`
for time, randomness and events, and on `world` for where a person is.

**Status: not yet implemented.** This directory is a placeholder for Phase 1 (identity and basic traits) through Phase 5 (relationships and memory).

It has no `package.json` on purpose, so it is not yet an npm workspace member
and cannot be imported by accident before it exists. Adding one — with
`@rpgsim/npc` as the name and `./src/index.ts` as its entry — is the first
step of the phase that fills it in.

## Rules it will inherit

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`. All randomness comes from the simulation's seeded RNG
  streams (see [docs/DETERMINISM.md](../../docs/DETERMINISM.md)).
- Every significant state change emits a structured event through the bus.
- Balance numbers live in `data/`, not in these sources.
- Systems land with tests before they land in a running world.
