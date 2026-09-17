# @rpgsim/npc

Who the villagers are: names, sex, age, and personality.

Identity, and nothing that acts on it. This package answers who somebody *is*.
What they want, what they know and what they do arrive in later slices, and
will read the traits stored here.

**Status: slice 3 of Phase 1 has landed.** People exist, generate from a seed,
and persist. Needs, schedules, memory and relationships come later.

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

## Four decisions worth knowing before reading the code

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

## Rules it inherits

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`, and no file reads - the name book is loaded by the app
  and passed in. Enforced by `packages/sim-core/test/determinism-guard.test.ts`,
  which scans these sources.
- Invalid state is refused at construction and reported by an invariant, never
  silently corrected (sim-core rule 10). `makeTraits` refuses a value of 140
  rather than storing 100; `clampTrait` is for computed drift, where clamping
  is the intended behaviour.
- Balance numbers live in `data/`, not in these sources. The age bands and the
  trait distribution are code defaults until `data/world/village.json` exists
  in slice 6, on the same pattern as `DEFAULT_CALENDAR`.
