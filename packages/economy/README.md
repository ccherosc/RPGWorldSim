# @rpgsim/economy

Labor, production, markets, currency, ownership and trade.

Goods must come from somewhere and money must come from someone. This package
owns the bookkeeping that makes that true, and the market pricing that makes it
interesting.

**Status: not yet implemented.** This directory is a placeholder for Phase 3 (work and economy).

It has no `package.json` on purpose, so it is not yet an npm workspace member
and cannot be imported by accident before it exists. Adding one — with
`@rpgsim/economy` as the name and `./src/index.ts` as its entry — is the first
step of the phase that fills it in.

## Rules it will inherit

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`. All randomness comes from the simulation's seeded RNG
  streams (see [docs/DETERMINISM.md](../../docs/DETERMINISM.md)).
- Every significant state change emits a structured event through the bus.
- Balance numbers live in `data/`, not in these sources.
- Systems land with tests before they land in a running world.
