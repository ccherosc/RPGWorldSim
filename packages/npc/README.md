# @rpgsim/npc

Who the villagers are, and when they are up.

Identity first: this package answers who somebody *is*. On top of that sits the
smallest thing a person can *do* on their own — keep to a daily routine. What
they want, what they know and what they decide arrive in later slices, and will
read the traits stored here.

**Status: slices 3 and 5 of Phase 1 have landed.** People exist, generate from
a seed, keep a daily cycle of waking and sleeping, and persist. Needs, memory
and relationships come later.

## What is here

| Module | Owns |
| --- | --- |
| `traits.ts` | the twelve traits, their scale, and their one fixed order |
| `names.ts` | `NameBook`: a validated culture's worth of names |
| `person.ts` | `Person` as a frozen value, plus age arithmetic |
| `generate.ts` | the roll: one villager from an RNG stream |
| `population.ts` | `Population`: the register, and its serialization |
| `people.ts` | `PeopleSystem`: generation, removal, and four events |
| `invariants.ts` | the four rules a person obeys |
| `routine.ts` | the habit: rise and bed hours, the bands they come from, and the clock arithmetic around them |
| `rest.ts` | `RestSystem`: waking, walking home, sleeping, and the `rest` save module |
| `save.ts` | `installPeople`, and the `npc` save module |

```ts
const sim = new Simulation({ seed: 'world-zero' });
const people = installPeople(sim);      // persistence and invariants, no villagers

const names = makeNameBook(JSON.parse(readFileSync('data/world/names.json', 'utf8')));

people.generate({ names });             // rolls everything
people.generate({ names, sex: Sex.Female, familyName: 'Webb', age: 34 });

ageInYears(person.birth, sim.now());    // 34
person.traits.stubbornness;             // 0-100, always present
people.setHome(person.id, cottage);     // emits npc.home-changed, if it changed
```

The daily cycle needs a map and a way to walk about, so it is installed on top:

```ts
const map = installWorld(sim);
const travel = installTravel(sim, map);
const rest = installRest(sim, people.population, map, travel);

rest.begin(person.id, { role: 'apprentice', dayDestination: mill });

rest.isAsleep(person.id);               // true at midnight
rest.routineOf(person.id);              // { rise, bed }, as ticks into the day
rest.require(person.id).nextAt;         // the tick their next change is due
rest.forget(person.id);                 // cancels the alarm; death does this for you
```

`begin` needs them to have a home, and — if the hour means they start the day
asleep — to already be standing in it. From then on the system runs itself:
`npc.woke`, `npc.turning-in`, `npc.went-to-bed`, and `npc.could-not-rest` when
the way home is blocked.

## Seven decisions worth knowing before reading the code

**A birth date is `{ year, month, day }`, not a tick.** Almost everybody alive
on day one was born before tick 0. Storing a tick would mean negative ticks or
an epoch shifted back a century to hide them. Age is integer year arithmetic
with one adjustment: a birthday that has not come round yet this year means a
birth year one lower. Without it the whole village ages on the same day.

**The draw order in `generatePerson` is part of what a seed means.** It is
written out explicitly rather than falling out of an object literal, because
reordering two lines there silently produces a different village from every
existing seed. `test/golden.test.ts` pins the people a fixed seed produces, so
a reordering fails the build instead of quietly rewriting history.

**Fixing a field skips its draw.** `generate({ familyName: 'Webb' })` does not
roll a surname and throw it away. That is what lets slice 4 give a household
one name without shifting every villager generated after it, so the draw count
is tested, not just the result.

**A trait ships only if something will read it.** Twelve, not the 40-60
[NPC_MODEL.md](../../docs/NPC_MODEL.md) wants eventually, and none of them
encode behaviour directly - there is no `propensityToSteal`. A trait nobody
consults is a number that can drift, save wrong, and never be noticed. Adding
one later costs an entry and a save migration; carrying fifty unused numbers
through every save from now on does not get cheaper.

**Everybody in the cycle holds exactly one pending alarm, always.** Not zero,
not two. It is the whole design, because a villager holding none stops for good
while the world goes on hashing correctly around them, and nothing about the
save looks wrong. So bedtime is scheduled before the morning journey out rather
than after it, and anybody setting off to walk home is handed *tomorrow
night's* bedtime as a standing fallback before the first step. The invariant
`npc.rest-has-a-next-change` checks it, and the tests audit the whole
population after every single scheduled event rather than at the end of a run.

**Bedtime is a decision to go home, not an arrival.** The hour fires, and what
happens next is a walk that takes as long as the roads take. Sleep happens on
arrival, over in the travel handler. Anybody already on the road is
*interrupted* rather than redirected, because the map can only put people in
real places, not halfway down a lane — so they stop at the next node and start
for home from there. Somebody who cannot get home at all stays awake, says so
in `npc.could-not-rest`, and tries again tomorrow night; nobody falls asleep
standing in a field, which would be a directive 7 violation no type can catch.

**"Tomorrow night" and "the next time this hour comes round" are different
things, and the file shipped the bug that proves it.** Bedtime drifts by up to
twenty minutes either way. A villager whose bed hour fired *early* and who then
asked for the next bed hour got one later the same evening, and was sent home
again while still walking home — three bedtimes in one night. `nextTickOfDay`
is strictly-after; `tickOfDayTomorrow` is a whole day on. Where the intent is
tomorrow night, the code says tomorrow night.

## Rules it inherits

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`, and no file reads - the name book is loaded by the app
  and passed in. Enforced by `packages/sim-core/test/determinism-guard.test.ts`,
  which scans these sources.
- Invalid state is refused at construction and reported by an invariant, never
  silently corrected (sim-core rule 10). `makeTraits` refuses a value of 140
  rather than storing 100; `clampTrait` is for computed drift, where clamping
  is the intended behaviour.
- Balance numbers live in `data/`, not in these sources. The age bands, the
  trait distribution, the routine bands and the role shifts are code defaults
  until `data/world/village.json` exists in slice 6, on the same pattern as
  `DEFAULT_CALENDAR`.
- The founding transition is the one that spends no jitter draw. A drifted
  *first* bedtime can land behind the clock and cost a villager a whole day, so
  `begin` schedules the stated hour exactly. `test/golden.test.ts` pins that by
  pinning the draw count.
