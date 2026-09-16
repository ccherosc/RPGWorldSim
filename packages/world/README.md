# @rpgsim/world

Locations, buildings, routes and occupancy.

The spatial model. It answers where a thing is, how long it takes to get
there, and who may enter — the questions Prime Directive 7 says no action may
skip.

**Status: slice 1 of Phase 1 has landed.** Space exists and persists. Movement
through it — travel as a scheduled event rather than a teleport — is slice 2,
and is not here yet. Objects and terrain come later still.

## What is here

| Module | Owns |
| --- | --- |
| `location.ts` | `Location` and `Building` as validated, frozen values |
| `map.ts` | `WorldMap`: the graph, occupancy, entry rules, routing |
| `invariants.ts` | the five rules space obeys |
| `save.ts` | `installWorld`, and the `world` save module |

```ts
const sim = new Simulation({ seed: 'world-zero' });
const map = installWorld(sim);          // persistence and invariants, no village

map.addLocation(makeLocation({ id, name: 'The Green', type: 'square', coordinate: { x: 0, y: 0 } }));
map.connect(green, millRoad, 60);       // 60 ticks, both directions, in one call
map.place(npc, cottage);

map.canEnter(npc, tavern);              // { allowed: false, reason: 'full' }
map.findRoute(green, cottage);          // { path: [...], cost: 90 } | undefined
```

## Three decisions worth knowing before reading the code

**Adjacency lives in the graph, never on a `Location`.** `connect(a, b, cost)`
writes both directions at once, so an edge cannot disagree with itself. The
coordinate on a location is decoration and worldgen input; routing never reads
it, because a road is not a straight line.

**Capacity is `number | null`, never `Infinity`.** Canonical JSON refuses
non-finite numbers, so an infinite capacity would build fine and then make the
whole world unsaveable.

**A route is a fact about the map, not about the traveller.** `findRoute`
ignores access and capacity; whether a particular person may walk a path is
`canEnter`'s question, asked per step at the moment of arrival.

## Rules it inherits

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`, and no file reads — worldgen loads `data/` in the app and
  passes it in. Enforced by `packages/sim-core/test/determinism-guard.test.ts`,
  which scans these sources.
- Invalid state is refused at construction and reported by an invariant, never
  silently corrected (sim-core rule 10).
- Balance numbers live in `data/`, not in these sources.
