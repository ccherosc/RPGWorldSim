# Phase 1 — World Zero Skeleton

**Status: in progress.**

Phase 1 puts a village on the map and people in it. Roadmap deliverables: one
village, locations, buildings, ~100 NPCs, households, basic identity, basic
traits, basic state, movement, sleep/wake, event stream. Exit criteria: run
seven simulated days with every NPC spatially and temporally valid.

This document is the plan and the record. It is written before the code so the
state transitions, events, invariants and failure cases are decided in advance,
as CLAUDE.md's development philosophy requires.

---

## 1. Scope

### In

Space (locations, travel, buildings), people (identity, a first slice of
traits, current state), households, movement, and a day/night cycle with sleep
and waking. Enough event detail that a day can be read back and understood.

### Out — deliberately

Hunger, thirst and fatigue as *needs that drive choice* (Phase 2). Work,
money, goods and ownership of anything but buildings (Phase 3). The utility AI
(Phase 4) — Phase 1 NPCs follow habits, not scored decisions. Relationships
beyond household membership (Phase 5). Crops, animals, illness, crime.

The temptation will be to add hunger "because it's easy". It is not easy: food
without an economy means food from nowhere, which is Prime Directive 6. Sleep
is in scope only because it needs nothing but time and a bed.

### The bar for "done"

Seven simulated days in which every NPC is somewhere legal at every tick, no
one travels faster than the route allows, everyone sleeps roughly nightly, and
the event stream reads like a description of a village rather than a log.

## 2. Slices

Each slice lands complete — types, events, invariants, tests, save module —
before the next begins.

### Slice 1: `packages/world` — space

A graph of named locations with travel costs on the edges, per
[WORLD_MODEL.md](WORLD_MODEL.md) ("use a graph or lightweight coordinate model
before detailed graphics"). Locations carry a light coordinate for later
rendering and for plausible travel-time generation, but routing uses the graph.

- `Location`: id, name, type, coordinate, capacity, access rule, owner, parent
  region, connections.
- `Building`: id, name, type, location, owner, residents, condition.
- Travel cost per edge in ticks, on foot, adjusted later by weather and load.
- Occupancy: which entities are where, and the reverse index.

**Invariants.** Every entity is in exactly one location. Occupancy never
exceeds capacity. Every edge is symmetric and has a positive cost. The graph is
connected — a village with an unreachable building is a worldgen bug, and
finding it on day 300 is much worse than refusing to start.

**Failure cases.** Entering a location that is full, or that access rules
forbid; travelling along an edge that does not exist; being placed in a
location that does not exist.

### Slice 2: `packages/world` — movement

Travel as a scheduled event, not a teleport. Departure removes the traveller
from the origin and marks them in transit; arrival at `now + cost` places them
at the destination at `Priority.Movement`.

**Invariants.** A traveller is in transit for exactly the route's cost — never
less. No entity is in two places. An arrival cannot precede its departure.
Interrupting travel leaves the traveller somewhere legal, never nowhere.

This is the first system that can violate Prime Directive 7, so it gets the
most adversarial tests in the phase.

### Slice 3: `packages/npc` — identity

People, with names. Generated from `RngStream.NpcGeneration`: given name,
family name, sex, birth date (hence age), birthplace, and a first slice of
personality traits — ten or so from [NPC_MODEL.md](NPC_MODEL.md)'s list, chosen
for being legible in behaviour later, not the full 40–60 yet.

Names come from `data/world/names.json` so the culture is data, not code
(directive 10). Names matter now, not as polish: see
[CHRONICLE.md](CHRONICLE.md).

**Invariants.** Age is consistent with birth date and the current tick. Every
trait is within its declared range. Every NPC has a home and a household.

### Slice 4: `packages/society` — households

Households as entities: members, a dwelling, and family roles (parent, child,
spouse, dependent, apprentice). Generated to match the distribution in
[WORLD_ZERO_SPEC.md](WORLD_ZERO_SPEC.md): couples with children, widows, single
adults, elderly dependents, apprentices — 20–35 households over 80–120 people.

Relationships as a multidimensional model are Phase 5. Phase 1 needs only
kinship structure, because it is what makes the population a village rather
than a crowd.

**Invariants.** Every household has at least one member and exactly one
dwelling. Membership is symmetric with the NPC's household reference. No one
is their own parent; no cycles in descent. Every child has at least one parent
present in the world or recorded as absent for a stated reason.

### Slice 5: `packages/npc` — the daily cycle

Sleep and waking, as habit rather than decision. Each NPC has a rise time and a
bed time varying by age and household role, drawn once from
`RngStream.NpcGeneration` and perturbed slightly per day from
`RngStream.NpcDecisions`. Waking schedules the day's movement; nightfall sends
them home to bed.

This is deliberately the thinnest possible behaviour: it exercises the whole
stack — schedule, travel, arrive, emit, persist — without pretending to be a
decision model. Phase 4 replaces the habit with utility scoring, and the shape
of the code should expect that.

**Invariants.** Nobody sleeps two nights without waking. Nobody is asleep
outside a dwelling. Exclusive activities do not overlap (testing rule: Time).

### Slice 6: World Zero generation and the CLI

A `data/world/village.json` describing Ashford-or-whatever: locations, edges,
buildings, and the population parameters. Worldgen reads it, validates it
through the existing loader, and builds the world from `RngStream.Worldgen`.

`npm run sim -- run` switches from the probe world to the village. The probe
world stays exactly where it is, as the kernel's harness.

**Exit test.** Seven days, all invariants holding at every day boundary, a
save/load in the middle matching an uninterrupted run, and the same seed
producing the same village twice.

## 3. Events

Phase 1's event vocabulary. Every one carries actors, a location, and `causes`
linking to what prompted it — see [CHRONICLE.md](CHRONICLE.md) section 3 for
why this is not optional.

| Event | Emitted when |
| --- | --- |
| `world.generated` | Worldgen completes; carries the seed and the counts |
| `npc.born` | An NPC is created (at worldgen, with a backdated birth date) |
| `npc.woke` | An NPC wakes |
| `npc.slept` | An NPC goes to sleep |
| `travel.departed` | A traveller leaves a location for a destination |
| `travel.arrived` | A traveller reaches a destination |
| `travel.blocked` | A move is refused — full, forbidden, or no route |
| `household.formed` | A household is created |

`travel.blocked` exists because a refused action is as informative as a
successful one, both for debugging and for the `WHY?` view, which must be able
to explain "constraints that prevented other actions".

## 4. Decisions taken in advance

**Graph, not grid.** Per WORLD_MODEL. A coordinate grid is only needed for the
Phase 11 RPG view, and the coordinate field carried on each location is enough
to place things on a map later without routing through one now.

**Travel cost in ticks, on the edge.** Not derived from coordinates at runtime:
a road is not a straight line, and a river crossing is not a distance. Costs
are data.

**One package per concern, from the start.** `world`, `npc` and `society` are
separate packages even though Phase 1's slice of each is thin, because merging
them later is harder than keeping the seam.

**Habits, not decisions.** Phase 1 behaviour is deliberately dumb. The risk of
an early ad-hoc decision layer is that Phase 4 has to fight it.

**No NPC knows anything yet.** There is no knowledge model in Phase 1, so no
Phase 1 code may read global state on an NPC's behalf and call it perception.
Where a later phase would consult memory, Phase 1 consults nothing and acts on
habit alone. This keeps Prime Directive 5 un-violated by omission rather than
by accident.

## 5. Risks

- **Worldgen becoming a content project.** Thirty buildings and a hundred names
  is a lot of typing that feels like progress. The village file should be as
  small as the exit criteria allow.
- **Movement bugs hiding until Phase 2.** An NPC who arrives slightly early
  looks fine until hunger makes timing matter. Hence the adversarial tests in
  slice 2 rather than later.
- **Trait bloat.** The full 40–60 traits are tempting to enumerate now. Without
  a decision model consuming them, they would be untested numbers that later
  code inherits without justification. Ten, used, beats fifty, unused.
