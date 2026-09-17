# @rpgsim/society

Who lives with whom, and who came from whom.

The structures people belong to rather than the people themselves. Phase 1
needs two of them: the household, which is who sleeps under one roof and what
each of them is to it, and descent, which is who your parents were. Affection,
obligation, grievance, law, crime and religion are later phases and are not
here.

**Status: slice 4 of Phase 1 has landed.** A village generates as households
rather than as a hundred unrelated adults. Marriage, birth, death and
inheritance move families around in Phases 3 and 5; nothing here changes on its
own yet.

## What is here

| Module | Owns |
| --- | --- |
| `household.ts` | `Household` as a frozen value: members, roles, one roof, one head |
| `kinship.ts` | `Parentage`: a mother and a father, each a person or a stated absence |
| `generate.ts` | the roll: a household *plan* from a template and an RNG stream |
| `register.ts` | `SocietyRegister`: both registers, and their serialization |
| `system.ts` | `HouseholdSystem`: generation, membership, and seven events |
| `invariants.ts` | the six rules a village obeys |
| `save.ts` | `installSociety`, and the `society` save module |

```ts
const sim = new Simulation({ seed: 'world-zero' });
const people = installPeople(sim);
const households = installSociety(sim, people);   // no families yet, on purpose

const names = makeNameBook(JSON.parse(readFileSync('data/world/names.json', 'utf8')));

// Roll a whole family: shape, ages, sexes, surname, people, descent, events.
households.generate({ dwelling: cottage, names });

// Or state one exactly.
households.found({ name: 'Webb', dwelling: cottage, members: [{ npc: alice, role: 'head' }] });

headOf(household);                      // total, by construction
households.register.householdOf(npc);   // the house that claims somebody
households.register.childrenOf(npc);    // scanned, not indexed
```

## Five decisions worth knowing before reading the code

**A household is who sleeps here; descent is who your parents were.** They are
two registers with two lifetimes, not one table with more columns. A household
dissolves when the last member leaves. A parentage record is true forever and
outlives every house its people ever lived in, which is what Phase 3
inheritance will read. Conflating them would make "who is in charge here"
unanswerable for every household that is not a nuclear family — an apprentice
is not kin, and a widowed mother-in-law is kin without being a dependent.

**A parent slot is a person or a stated reason there is nobody.** Not
`EntityId | null`. A null parent reads as "unrecorded" and "nobody" at the same
time, and the Chronicle would have to invent which. `dead`, `departed` and
`unknown` are the three reasons, and the invariant that every child's parents
are accounted for is therefore mostly a fact about the type rather than a
runtime check.

**Generation produces a plan, not people.** `generateHouseholdPlan` returns
roles, sexes, ages and surnames with parents referred to by position in the
same list. It allocates no id, touches no `Simulation` and creates no villager.
That is what lets the composition rules be tested directly — is a mother ever
younger than her daughter, does a widow's household ever contain a living
husband — without standing up a world. `HouseholdSystem.generate` turns a plan
into people.

**The generator and the rule that checks it do not share code.** The plan-level
age-gap test walks the plan itself rather than calling the invariant's helper,
so that a generator and its check cannot be wrong in the same way. Where the
generator would otherwise produce something the invariant refuses — a live-in
parent clamped down to `MAX_FOUNDING_AGE` and therefore only twelve years older
than their own child — the fix is a validation assert on the template table,
not a silent clamp (sim-core rule 10). A *forced* template is validated like
any other: skipping the check because a caller named the shape would let
worldgen hand in the one table the weighted draw could never have produced.

**Every membership change writes both sides.** A household records its members
and each person records their household, and the two must never disagree, so
the write goes through `HouseholdSystem` and never through the register alone.
That is what makes `society.membership-is-symmetric` a check on old saves
rather than a check on this code's discipline.

## The six rules

| Invariant | Catches |
| --- | --- |
| `society.household-is-coherent` | filed under another id, no head, two heads, a member who is not a person |
| `society.membership-is-symmetric` | a house and a person who disagree about each other, or two houses claiming one roof |
| `society.everybody-is-housed` | a villager no household claims, or one sleeping somewhere their household does not live |
| `society.descent-has-no-cycles` | somebody who is their own ancestor |
| `society.parents-are-older-than-their-children` | a father younger than his son, or one under `MIN_PARENT_AGE_GAP` years older |
| `society.children-have-recorded-parents` | a parent slot that is neither a person nor a stated absence |

All six are read-only. An invariant that repaired a membership would hide
whichever write only did half its job.

## Tests

`test/society.test.ts` is the behaviour; `test/golden.test.ts` pins the world.
The split matters, and slice 3 learned why the hard way: a test that generates
the same village twice and compares the hashes passes even when the draw order
changes, because both runs shift together — while every world ever saved now
replays as different people. So the golden file compares against constants
instead: the roles, the template table, the draw counts per stream, the exact
roster of a fixed seed, the save block character for character, and the world
hash. If one of those fails, the constant is not what needs changing.

The roster is pinned as readable text rather than ids for a second reason: it
gets read. That is how a household turned up with a mother and three living
daughters all called Sabina — legal, deterministic, invariant-clean, and
unreadable to anybody meant to follow the village through their own posts.
`avoidGivenNames` now narrows the pool before the draw, which costs no extra
draws and so changed no existing world.

Both files are backed by a mutation sweep: twenty deliberate breakages of these
sources, each run against the suite. A test that passes with the code broken is
not a test yet.

## Rules it inherits

- No UI dependencies, and no dependency on `@rpgsim/observer`.
- No `Math.random()`, and no file reads — the name book is loaded by the app
  and passed in. Enforced by `packages/sim-core/test/determinism-guard.test.ts`,
  which scans these sources.
- Composition and people draw from separate streams (`RngStream.Households` and
  `RngStream.NpcGeneration`), so adding a household template does not reshuffle
  every personality in the village.
- Invalid state is refused at construction and reported by an invariant, never
  silently corrected (sim-core rule 10).
- Balance numbers live in `data/`, not in these sources. Since slice 6 the
  village states its own household templates in `data/world/village.json`, and
  `DEFAULT_HOUSEHOLD_TEMPLATES` is the default for tests and for a world built
  without one, on the pattern of `DEFAULT_CALENDAR`. `MIN_PARENT_AGE_GAP` and
  `RESIDENT_PARENT_AGE_GAP` stay in code on purpose: an invariant enforces them,
  and a data file holding the rule the check is written against would let the
  two disagree.
