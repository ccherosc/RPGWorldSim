# @rpgsim/world

Locations, buildings, routes and occupancy.

The spatial model. It answers where a thing is, how long it takes to get
there, and who may enter — the questions Prime Directive 7 says no action may
skip.

**Status: slices 1, 2 and 6 of Phase 1 have landed.** Space exists, persists,
takes time to cross, and now holds an actual village built from
`data/world/village.json`. Objects and terrain come later.

## What is here

| Module | Owns |
| --- | --- |
| `location.ts` | `Location` and `Building` as validated, frozen values |
| `map.ts` | `WorldMap`: the graph, occupancy, entry rules, routing |
| `invariants.ts` | the five rules space obeys |
| `travel.ts` | `TravelSystem`: journeys, arrivals, and the rules movement obeys |
| `save.ts` | `installWorld`, and the `world` save module |

```ts
const sim = new Simulation({ seed: 'world-zero' });
const map = installWorld(sim);          // persistence and invariants, no village

map.addLocation(makeLocation({ id, name: 'The Green', type: 'square', coordinate: { x: 0, y: 0 } }));
map.connect(green, millRoad, 60);       // 60 ticks, both directions, in one call
map.place(npc, cottage);

map.canEnter(npc, tavern);              // { allowed: false, reason: 'full' }
map.findRoute(green, cottage);          // { path: [...], cost: 90 } | undefined

const travel = installTravel(sim, map);
travel.begin(npc, tavern);              // { started: true, journey } | a refusal
sim.runUntil(90);                       // they arrive when the roads say so
```

## Five decisions worth knowing before reading the code

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

**A place can be rewritten, but it cannot move or shrink underneath anybody.**
`withLocation` and `withBuilding` copy a value with changes, back through the
same constructor, so a copy cannot route around a construction rule.
`replaceLocation` and `replaceBuilding` put the copy on the map. Worldgen needs
this: a cottage is laid out before the family who live in it exists, so the
house learns its name, its owner and who may walk in afterwards. What they
refuse is the part everything else was built against — a building's interior,
a location's coordinate (every road leading there was costed against that
point), and any capacity below the number of people already inside, counting
the ones walking towards it.

**A traveller takes the seat before they take the road.** While walking they
are in no location at all, so the place they are walking to holds their room —
the last stool in the tavern is taken by the man coming up the lane. That is
what makes arrival unable to fail, and it is the answer to the only question
this package really has to get right: where is somebody who is not anywhere?

## Rules it inherits

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`, and no file reads — worldgen loads `data/` in the app and
  passes it in. Enforced by `packages/sim-core/test/determinism-guard.test.ts`,
  which scans these sources.
- Invalid state is refused at construction and reported by an invariant, never
  silently corrected (sim-core rule 10).
- Balance numbers live in `data/`, not in these sources.
