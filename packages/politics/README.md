# @rpgsim/politics

Rulers, factions, diplomacy, taxation and succession.

The layer above the village: who holds power over a place, how that power is
inherited or lost, and what it costs the people underneath it.

**Status: not yet implemented.** This directory is a placeholder for the kingdom-scale phases after World Zero.

It has no `package.json` on purpose, so it is not yet an npm workspace member
and cannot be imported by accident before it exists. Adding one — with
`@rpgsim/politics` as the name and `./src/index.ts` as its entry — is the first
step of the phase that fills it in.

## Rules it will inherit

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`. All randomness comes from the simulation's seeded RNG
  streams (see [docs/DETERMINISM.md](../../docs/DETERMINISM.md)).
- Every significant state change emits a structured event through the bus.
- Balance numbers live in `data/`, not in these sources.
- Systems land with tests before they land in a running world.
