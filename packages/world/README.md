# @rpgsim/world

Locations, buildings, terrain, routes and physical objects.

The spatial model. It answers where a thing is, how long it takes to get
there, who may enter, and what may be picked up — the questions Prime Directive
7 says no action may skip.

**Status: not yet implemented.** This directory is a placeholder for Phase 1 (World Zero skeleton).

It has no `package.json` on purpose, so it is not yet an npm workspace member
and cannot be imported by accident before it exists. Adding one — with
`@rpgsim/world` as the name and `./src/index.ts` as its entry — is the first
step of the phase that fills it in.

## Rules it will inherit

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`. All randomness comes from the simulation's seeded RNG
  streams (see [docs/DETERMINISM.md](../../docs/DETERMINISM.md)).
- Every significant state change emits a structured event through the bus.
- Balance numbers live in `data/`, not in these sources.
- Systems land with tests before they land in a running world.
