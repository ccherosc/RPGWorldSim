# Phase 1 — World Zero Skeleton

**Status: complete.** All six slices have landed. The village runs from
`data/world/village.json`, and `npm run verify` proves the five determinism
guarantees about it. Whether a day *reads* like a village rather than a log is
the one part of the bar below that a test cannot answer, and the crude daily
paper described in section 5 is what answers it.

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

A slice that adds a package also runs `npm install` and commits the updated
`package-lock.json`. Nothing local notices a stale lock, because module
resolution goes through tsconfig paths and vitest aliases rather than
`node_modules`; CI's `npm ci` refuses to install at all, so the first sign is a
red build that has nothing to do with the code.

### Slice 1: `packages/world` — space — **done**

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

**Landed as.** `location.ts` (validated, frozen value types), `map.ts` (the
graph, occupancy, entry rules, deterministic Dijkstra), `invariants.ts` (the
five above), `save.ts` (`installWorld`, save module `world` v1). 73 tests.

**Deviation from the plan above: `Location` has no `connections` field.**
Adjacency lives only in the graph. A location that carried its own edge list
could disagree with the location on the other end of an edge, and "every edge
is symmetric" would then be a rule the invariant enforces after the fact rather
than a property the data structure cannot violate. `WorldMap.connect` writes
both directions in one call, so the symmetric invariant is a net under a bad
save file, not a repair for ordinary code. The coordinate stayed; it is
decoration and worldgen input, and routing still never reads it.

### Slice 2: `packages/world` — movement — **done**

Travel as a scheduled event, not a teleport. Departure removes the traveller
from the origin and marks them in transit; arrival at `now + cost` places them
at the destination at `Priority.Movement`.

**Invariants.** A traveller is in transit for exactly the route's cost — never
less. No entity is in two places. An arrival cannot precede its departure.
Interrupting travel leaves the traveller somewhere legal, never nowhere.

This is the first system that can violate Prime Directive 7, so it gets the
most adversarial tests in the phase.

**Landed as.** `travel.ts` — `TravelSystem`, the `world.travel.arrive`
scheduled event at `Priority.Movement`, three invariants, and the `travel` save
module. 38 tests, checked against eight deliberate mutations; all eight die.

**Two refinements of the sketch above, both about where a person is.**

*A journey is walked leg by leg, not in one jump.* The sketch had a single
arrival at `now + routeCost`. Walking each edge separately costs the same total
and buys three things: a traveller is recorded passing through the places
between, so an observer can see where they went; a walk can be interrupted at
the next crossroads rather than only at its end; and every place a journey can
stop is a real location with a name.

*Departure takes the seat at the far end.* A traveller belongs to no location
while walking, which raises the question the invariants are really about: what
happens when they arrive and the room is full? Every answer that resolves it at
arrival — turn back, stand outside, wait — can fail in turn, and the failure is
a person who is nowhere. So the room is taken at departure: `WorldMap.reserve`
holds it, a third party trying to walk in is refused, and arrival cannot fail
for want of space. The seat is held one leg ahead, not for the whole route, so
a distant destination can still fill up while the traveller is on their way and
turn them away at the door — which is the truthful outcome, and the one that
leaves them standing in the last real place they reached.

A villager is *not* pre-checked against a door they have not reached. They can
walk to the vestry and be turned away at it. Knowing in advance would be
knowledge Prime Directive 5 does not let the simulation hand out for free.

**One change to `sim-core`.** Save modules load in sorted id order, so `travel`
loads before `world` and cannot compare a journey against a map that is still
empty. `SaveModule` gained an optional `verify()`, run in a second pass once
every block in the envelope has loaded. Cross-module save checks go there.

### Slice 3: `packages/npc` — identity — **done**

People, with names. Generated from `RngStream.NpcGeneration`: given name,
family name, sex, birth date (hence age), birthplace, and a first slice of
personality traits — ten or so from [NPC_MODEL.md](NPC_MODEL.md)'s list, chosen
for being legible in behaviour later, not the full 40–60 yet.

Names come from `data/world/names.json` so the culture is data, not code
(directive 10). Names matter now, not as polish: see
[CHRONICLE.md](CHRONICLE.md).

**Invariants.** Age is consistent with birth date and the current tick. Every
trait is within its declared range. Every NPC has a home and a household.

**Landed as.** `traits.ts` (twelve traits), `names.ts` (the name book),
`person.ts` (the frozen record), `generate.ts` (the roll), `population.ts` (the
register), `people.ts` (`PeopleSystem` and four events), `invariants.ts`, and
the `npc` save module. 62 tests, checked against fifteen deliberate mutations;
all fifteen die.

**Three departures from the sketch above.**

*A birth date is a calendar date, not a tick.* Most villagers on day one were
born before tick 0, and a tick cannot say so without either going negative or
moving the epoch back a century and making every other date harder to read. So
`birth` is `{ year, month, day }` and age is integer year arithmetic, with the
one adjustment that matters: somebody whose birthday has not come round yet this
year was born a year earlier than the subtraction suggests. Getting that wrong
gives a village where everyone ages on the same day — wrong, and almost
invisible.

*Twelve traits, not ten, and each one earns its place.* The rule was that a
trait ships in Phase 1 only if some Phase 1 or Phase 2 behaviour will visibly
read it. A trait nobody consults is a number that can drift, save wrong, and
never be noticed. The rest of [NPC_MODEL.md](NPC_MODEL.md)'s catalogue arrives
with the systems that read it. Their distribution is one default in code rather
than twelve invented per-trait skews; the skews are balance, so directive 10
puts them in `data/world/village.json` in slice 6.

*"Every NPC has a home and a household" moves to slice 4.* Households do not
exist yet, so the check has nothing to compare against. It is a cross-package
invariant, and `npc` sorts before `society`, so it belongs in that slice's
`verify()` rather than here.

**What the mutation sweep caught.** Two mutations survived the whole suite:
swapping the given-name and family-name draws, and rolling traits in declaration
order instead of sorted order. Both change every villager in every world, and
both passed — because the suite only ever compared two runs to each other,
and a reordering shifts both runs together. `packages/npc/test/golden.test.ts`
pins the actual people now. A third survivor was the documented promise that
fixing a field skips its draw rather than drawing and discarding it; that is
what will let slice 4 give a household a shared surname without shifting
everybody generated afterwards, and it now has a draw-count test.

### Slice 4: `packages/society` — households — **done**

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

**Landed as.** `household.ts` (the frozen household, six roles, exactly one
head), `kinship.ts` (`Parentage`, and `MIN_PARENT_AGE_GAP`), `generate.ts` (the
template table and the plan), `register.ts` (both registers and their
serialization), `system.ts` (`HouseholdSystem` and seven events),
`invariants.ts` (six rules), and the `society` save module. 64 tests — 55
behavioural and 9 golden — checked against twenty deliberate mutations; all
twenty die.

*Generation produces a plan, not people.* `generateHouseholdPlan` returns
roles, sexes, ages and surnames with parents referred to by position in the same
list, and allocates no id and touches no `Simulation`. That is what lets the
composition rules be tested as values — is a mother ever younger than her
daughter, does a widow's house ever contain a living husband — without standing
up a world. The plan-level age-gap test deliberately walks the plan itself
rather than calling the invariant's helper, so that a generator and its check
cannot be wrong in the same way.

*Households supersede `DEFAULT_AGE_BANDS` for anybody housed.* Slice 3 drew an
age from a band table. A villager generated as part of a household now takes
their age from the template instead — a head within the template's range, a
spouse skewed against them, children below the youngest parent by at least
`MIN_PARENT_AGE_GAP`. The band table still applies to anyone generated outside a
household, and both are balance values headed for
`data/world/village.json` in slice 6, along with `DEFAULT_HOUSEHOLD_TEMPLATES`,
`RESIDENT_PARENT_AGE_GAP` and `MIN_PARENT_AGE_GAP`.

*The dwelling check is deferred to slice 6, on purpose.* A household's dwelling
should be a building that exists, but this package holds no map and depends on
no `@rpgsim/world`; adding a dependency to check one id would couple family
structure to terrain. Save modules load in sorted id order, so `society` also
loads before any location exists. The check belongs in the worldgen wiring that
holds both, and is recorded there rather than left as a comment.

**Three corrections the slice found in its own code.**

*A forced template escaped validation entirely.* `generate({ template })` fed
the caller's table straight to the roll, so worldgen could hand in the one shape
the weighted draw could never have produced. A forced template is now validated
like any other.

*A live-in parent could be younger than the rule allows.* Clamping an elder's
age down to `MAX_FOUNDING_AGE` could leave them twelve years older than their
own child — a config the generator would happily build and
`society.parents-are-older-than-their-children` would then fire on. Fixed with
an assert on the template table rather than a silent clamp, which is sim-core
rule 10: a template whose head can be old enough for the arithmetic to fail is
refused at validation, not quietly repaired at generation.

*A dead branch in the child count.* `oldestChild` cannot be negative given the
validated ranges, so the guard against it was unreachable and hid the fact.

**Balance, measured rather than guessed.** The first table produced a village
too young to be believed: 6.7% over sixty and 8.5% in the 45–59 band. Three
changes — the family head's ceiling 49 → 52, `elder-couple` 9 → 11,
`elder-alone` 6 → 7 — land at, across eight seeds, 28.8 households and 96.8
people at an average size of 3.37, with 31.1% children under 14, 22.9% youths,
26.5% adults 25–44, 12.3% at 45–59 and 7.2% over sixty, and no invariant
violations. Those weights are pinned in `golden.test.ts`, because changing one
changes every village ever generated.

**What reading the golden roster caught.** The pinned roster is written as
names and ages rather than ids, and so it gets read — which is how a household
turned up with a mother and three living daughters all called Sabina. Legal,
deterministic, invariant-clean, and unreadable to anybody meant to follow the
village through their own posts; no invariant would ever have found it.
`avoidGivenNames` now narrows the pool before the draw rather than re-rolling on
a clash, so it costs no extra draws and changed no existing world — `npc`'s own
golden test, which does not pass the option, still passes untouched.

**What the mutation sweep caught.** Nothing that survived. Twenty mutations
across all six modules, including the two shapes that beat slice 3's suite —
swapping two draws (`M13`) and drawing names without regard to the house
(`M18`) — and both died against the golden roster and hash rather than against
any behavioural test, which is the whole reason that file exists.

### Slice 5: `packages/npc` — the daily cycle — **done**

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

**Two structural decisions taken before writing it.** Recorded here rather than
in the landed note, because the Source of Truth rule asks that the design
document change before the architecture does.

*`@rpgsim/npc` gains a dependency on `@rpgsim/world`.* Nightfall cannot send
somebody home without knowing where they are standing and how long the walk
takes. Directive 7 makes that a real dependency rather than a convenience, and
Phase 4's utility scoring will need the map, the buildings and the routes far
more heavily than this slice does. The alternative — a narrow "send them home"
callback handed in by the app — would keep the package graph thinner by making
one method's worth of indirection permanent, and would be undone in slice 6
anyway. The graph stays acyclic: `world` knows nothing of `npc`, and `society`
sits above both.

*The once-per-person draw moves to its own stream.* The sketch above says
`RngStream.NpcGeneration`, and determinism rule 6 says a new subsystem gets a
new name rather than reusing one. Sharing the stream would mean that retuning a
bed time shifts every trait rolled afterwards. So the habit is drawn from
`RngStream.Routines`, and the per-day jitter from `RngStream.NpcDecisions` as
sketched.

**Landed as.** `routine.ts` (the `Routine` value, the age-band table, the role
shifts, and the clock arithmetic) and `rest.ts` (`RestSystem`, four events,
three invariants, and the `rest` save module), wired by `installRest`. 47 tests
— 40 behavioural and 7 golden — checked against twenty-nine deliberate
mutations; all twenty-nine die.

*Exactly one pending transition per person, always.* This is the design, and
everything odd-looking in `rest.ts` follows from it. A villager holding none
stops for good, silently, while the world keeps hashing correctly around them;
a villager holding two wakes twice. So tonight's bedtime is scheduled before
the morning journey out rather than after it, and anybody who has to walk home
is handed *tomorrow night's* bedtime as a standing fallback before the first
step — the walk is asynchronous, and without the fallback the whole journey is
spent holding a transition that has already fired. `npc.rest-has-a-next-change`
checks it, and the tests audit the entire population after every scheduled
event rather than at the end of a run, because every interesting failure here
is transient by nature.

*Bedtime is a decision to go home, not an arrival.* Sleep happens in the
arrival handler, a walk later. Somebody already travelling is interrupted
rather than redirected, because `TravelSystem` runs one journey at a time and
can only stop people at real places. Somebody with no route home stays awake,
says so in `npc.could-not-rest`, and tries again tomorrow night — falling
asleep in a field would satisfy the invariant "nobody sleeps two nights without
waking" while violating directive 7, which is why the sleeper invariant is
written against location rather than against elapsed time.

*The founding transition spends no jitter draw.* `begin` schedules the habit's
stated hour exactly. A drifted first bedtime can land behind the clock, and the
villager loses a day before the cycle catches up. Every transition after it
drifts normally. `test/golden.test.ts` pins this by pinning the draw count, not
just the times.

**Two behaviour changes outside the slice's own files.** Recorded here because
the Source of Truth rule asks for it.

*`packages/world/src/travel.ts` now clears a finished journey before announcing
it.* `arrive()` emitted `travel.arrived` and then deleted the journey record.
Two consequences, both latent until this slice had a listener: a handler asking
`isTravelling` during the arrival got `true`, so the walk home was refused as
`already-travelling`; and a handler that *started* a new journey on arrival had
it deleted by the line below the emit, leaving a traveller with a pending
arrival and no record of where they were going. The daily cycle does exactly
that when bedtime catches somebody out of doors. The event now states a fact
that is already true when it is stated.

*`RngStream` gains `Routines`.* As set out above, per determinism rule 6.

### Slice 6: World Zero generation and the CLI — **done**

A `data/world/village.json` describing the settlement: locations, edges,
buildings, and the population parameters. Worldgen reads it, validates it
through the existing loader, and builds the world from `RngStream.Worldgen`.

**The village is deliberately unnamed for now.** It ships as `world-zero` in
data, with a `name` field that any later rename touches and nothing else —
naming it is a decision to make once the place has some character, and keeping
the name in exactly one data field is what keeps that cheap. The register is
settled even if the name is not: English medieval, matching the spec's own
`Edric Hale` and the calendar's `Harvestide` and `Emberfall`.

`npm run sim -- run` switches from the probe world to the village. The probe
world stays exactly where it is, as the kernel's harness.

**Exit test.** Seven days, all invariants holding at every day boundary, a
save/load in the middle matching an uninterrupted run, and the same seed
producing the same village twice.

**Five structural decisions taken before writing it.** Recorded here rather than
in the landed note, because the Source of Truth rule asks that the design
document change before the architecture does.

*Data names places by slug; the simulation allocates the ids.* `village.json`
says `"mill-lane"`, never `location:7`. Entity ids come from `sim.newId` and are
an artefact of the order worldgen runs in, so writing them into data would make
a file edit capable of renumbering an existing world. Worldgen keeps a
slug-to-id table for the length of its own run and throws it away; nothing in
the save refers to a slug. Every collection in the file is a JSON **array**, not
an object keyed by slug, because determinism rule 5 forbids iteration order that
is not itself deterministic.

*Public places are authored; dwellings are generated.* The green, the streets,
the church, the mill and the roads out are written down one by one with their
own travel costs, because a village's shape is a decision and "costs are data".
The twenty-odd cottages are not: the file says how many there are and which
lanes they stand on, and worldgen lays them out. Hand-writing twenty near
identical blocks would put the house count and the household count in two places
that can disagree.

*`WorldMap` gains a way to replace a building.* `Building` carries `owner` and
`residents`, and until now nothing could ever set them — slice 1 left them empty
with a note pointing here. A building is also the one thing in the map that
legitimately changes without moving: people are born into it, inherit it and
leave it. So `withBuilding` joins `withPerson` and `withHousehold`, and
`map.replaceBuilding` refuses any change to the building's `location`, because a
building that moved would be a different building.

*The deferred dwelling check lands here, as an invariant of the wiring.*
`world.dwelling-is-a-real-building` — every household's dwelling is a location
that exists, is of type `dwelling`, and is the interior of a building. Neither
`@rpgsim/society` nor `@rpgsim/world` can hold it without depending on the
other; the worldgen wiring holds both. Registered by the world builder, not by
either package.

*The probe world stays, and `verify` runs against both.* `--world village` is
the default for `run` and `resume`; `--world probe` keeps the Phase 0 harness
reachable. `verifyDeterminism` takes a world factory instead of hard-coding the
probe, so `npm run verify` proves the five guarantees about the *village* as
well — which is what the exit test above actually asks for.

**Landed as.** `data/world/village.json` (the whole settlement: 14 authored
places, 13 roads, 4 structures, 24 cottages, and the population tables),
`village-schema.ts` (the validator), `village-world.ts` (`VillageWorld`, the
builder, the deferred dwelling invariant) and two new loaders in `data.ts`.
The CLI grew `--world`, and `verify.ts` lost its knowledge of what a world is.
The shipped village is 86 people in 24 households across 38 places, running 26
invariants. 26 tests in `apps/simulator/test/village.test.ts` plus 9 in
`packages/world/test`, checked against twelve deliberate mutations; all twelve
die.

**Three corrections to the decisions above.** Recorded because the Source of
Truth rule asks that the document and the code not drift apart quietly.

*Three tables named for `village.json` stayed in code.* The plan was to move
the age bands, the culture tag and the minimum parent/child age gap into data
along with everything else. Nothing reads them on any path worldgen takes:
`ageBands` is consulted only when a person's age is *not* already fixed, and
every founding villager's age is fixed by the household template they belong
to; `culture` is already stated once at the top of `names.json`; and the age
gap is enforced by an invariant as well as used by the generator, so making it
data would let the rule and the check disagree. A knob in a data file that
changes nothing is worse than a constant in code, because it looks live. Each
moves on the day something reads it — `ageBands` when people are born into the
world rather than generated into it, in Phase 2.

*`WorldMap` gained a way to replace a **location**, not only a building.* A
cottage is private, and a private place whose `permitted` list is empty refuses
everybody — including the family who live there. The list cannot be written
when the cottage is laid out, because the family that goes in it does not exist
until worldgen has generated them, so the house has to be rewritten afterwards.
`withLocation` and `map.replaceLocation` are the symmetric pair to
`withBuilding`/`replaceBuilding`, and they refuse the two things the rest of the
map has already been built against: a place may not **move**, because every
travel cost on every road leading to it was set against that point, and it may
not be **shrunk below the people already inside it**, counting inbound
travellers as well as occupants.

*`verify` measures its days from the world's own starting tick.* The probe world
opens at tick 0 and the village opens on a date — `{1200, 4, 1}`, tick 7 776 000.
A run measured absolutely would ask the village to run until a moment ninety
days behind it and stop instantly, reporting five passes on a world that never
moved.

## 3. Events

Phase 1's event vocabulary. Every one carries actors, a location where one is
meaningful, and `causes` linking to what prompted it — see
[CHRONICLE.md](CHRONICLE.md) section 3 for why this is not optional. Five types
are allowed to carry no cause, and only five: the founding did not come from
anywhere, and the hours of the clock are not events. Which five, and the test
that pins the list, are in [CHRONICLE_V1.md](CHRONICLE_V1.md) slice 2.

The sketch below originally named `npc.born` and `household.formed`. Both ship
under the names the packages that own them use — `npc.created`, which carries an
`origin` so that a birth years from now is distinguishable from a founding, and
`society.household-founded`. The table is the shipped vocabulary.

| Event | Emitted when |
| --- | --- |
| `world.generated` | Worldgen completes; carries the seed and the counts |
| `npc.created` | An NPC enters the world; `origin` says whether by founding |
| `npc.household-changed` | An NPC joins or leaves a household |
| `npc.home-changed` | An NPC is given a roof, or loses one |
| `npc.woke` | An NPC wakes |
| `npc.turning-in` | Bedtime has come and an NPC sets off home |
| `npc.went-to-bed` | An NPC reaches their own bed and sleeps |
| `npc.could-not-rest` | Bedtime came and there was no way home; they stay up |
| `travel.departed` | A traveller leaves a location for a destination |
| `travel.arrived` | A traveller reaches a destination |
| `travel.blocked` | A move is refused — full, forbidden, or no route |
| `society.household-founded` | A household is created |
| `society.member-joined` / `-left` / `society.role-changed` | Its membership changes |
| `society.parentage-recorded` | Who somebody's parents were |

`travel.blocked` exists because a refused action is as informative as a
successful one, both for debugging and for the `WHY?` view, which must be able
to explain "constraints that prevented other actions". `npc.could-not-rest` is
the same idea one layer up: the sketch above had a single `npc.slept`, and
splitting it into a departure (`npc.turning-in`) and an arrival
(`npc.went-to-bed`) is what makes the walk home visible in the chronicle
instead of a villager teleporting into bed.

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

## 5. What comes immediately after

Not Phase 2. Once the village runs for seven days, the next thing built is the
crudest possible day-in-review generated from the real event stream — see
[CHRONICLE.md](CHRONICLE.md) for why, and [CHRONICLE_V1.md](CHRONICLE_V1.md)
for the plan it is being built to.

The reason is feedback, not features. A generated paper is the fastest way to
find out whether a simulated day is interesting to *read*, which is the actual
question this project is asking. If the day reads as thin, that is much cheaper
to learn before hunger, work, money and relationships are layered on top of it —
and a paper generated from a bare skeleton of a village sets the baseline
against which every later system can be judged.

**Landed so far.** Slices 1 to 3 of [CHRONICLE_V1.md](CHRONICLE_V1.md) are
built: the durable day archive (`npm run sim -- run --archive <path>`), the
`world.generated` event and the worldgen hook that makes the founding
observable, and the village's permanent memory (`npm run sim -- annals --archive
<in> --annals <out>`) — two tab-separated text files that survive the archive
being deleted. The paper itself is slices 4 to 7.

## 6. Risks

- **Worldgen becoming a content project.** Thirty buildings and a hundred names
  is a lot of typing that feels like progress. The village file should be as
  small as the exit criteria allow.
- **Movement bugs hiding until Phase 2.** An NPC who arrives slightly early
  looks fine until hunger makes timing matter. Hence the adversarial tests in
  slice 2 rather than later.
- **Trait bloat.** The full 40–60 traits are tempting to enumerate now. Without
  a decision model consuming them, they would be untested numbers that later
  code inherits without justification. Ten, used, beats fifty, unused.

## 7. Known debt

1. **Worldgen fails on roughly one seed in fifteen.** A household template can
   roll a couple, five children, two resident parents and an apprentice — ten
   people — and `village.json` gives a cottage a capacity of eight. Settling the
   ninth throws `entity may not enter this location … reason: full`, which is
   the map refusing correctly; the bug is that the generator was never told the
   size of the roof it is filling. Measured at **13 of 200 seeds** (`scan-6`,
   `scan-16` and `scan-50` are reproductions). The shipped seed `world-zero` is
   not affected, which is why this has been invisible.

   Two candidate fixes, and they are not equivalent. Raising the cottage
   capacity in `village.json` until it exceeds the largest possible household is
   a data change, but it makes the data file quietly dependent on constants in
   `packages/society/src/generate.ts` that nobody editing it can see. Passing
   the dwelling's capacity into `generateHouseholdPlan` and having it trim the
   optional members — the apprentice first, then the resident parents — keeps
   the constraint where the constraint is, and is the one to take. Either way it
   wants a build-time check that no household is larger than the roof it was
   given, because the current failure mode is an exception from three layers
   down rather than a sentence about the village.
