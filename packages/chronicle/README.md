# @rpgsim/chronicle

The village's memory: what a place would still be talking about next year.

The day archive in `@rpgsim/sim-core` is exact and enormous — about 80 MB of
JSONL a simulated year — and it is a **cache**, not a record. The seed
reproduces it byte for byte, so it can be deleted and rebuilt at will. What
cannot be rebuilt from a seed is a *judgement* about what mattered. That
judgement is what this package makes, and it is small enough to keep forever.

**Status: slice 3 of [CHRONICLE_V1.md](../../docs/CHRONICLE_V1.md) has landed.**
Memory is recorded and exported. Nothing in the simulation reads it back yet —
villagers do not act on what they remember until the slice after the paper.

## What is here

| Module | Owns |
| --- | --- |
| `significance.ts` | the weights schema, `weightOf`, `isNotable` — the filter, as data |
| `table.ts` | the one formatting decision both files share: tab-separated cells, `-` for empty |
| `people.ts` | `PeopleRegister`: slug allocation and the people file |
| `annals.ts` | `distil`: one archived day in, one day's worth of memory out |
| `annals-store.ts` | the only thing that touches the disk |
| `portraits.ts` | `PortraitCatalog`: the sheets of drawn faces, merged and indexed |
| `casting.ts` | `Casting`: who wears which face, and whether that is still true |
| `persona.ts` | `PersonaBook`: how each villager comes across, read off their traits |
| `community.ts` | `Community`: the families, and what they are to each other |

```ts
const store = new AnnalsStore({ root: './memory' });
const day = distil({
  key: '1200-04-01',
  events: readEventDay('./history', '1200-04-01'),
  calendar,
  significance,          // loaded by the app from data/chronicle/significance.json
  people: store.people,  // advanced in place; new people are handed slugs
});
store.record(day);
```

Two files come out, and nothing else:

```
memory/people.txt        everyone who has ever existed, one line each
memory/annals/1200.txt   everything worth remembering, one line each
```

The last four modules are the **press side**: they read the record and give the
blog a face, a voice and a village to write about. They are checked against the
record rather than trusted, by `npm run sim -- cast`:

```ts
const catalog = new PortraitCatalog(loadPortraits());   // data/chronicle/portraits/P*.json
const casting = new Casting(loadCasting());             // data/chronicle/casting.json
const personas = new PersonaBook(loadPersonas());       // data/chronicle/personas.json
const village = new Community(loadCommunity());         // data/chronicle/community.json

casting.portraitFor('winifred-barrow', '1200-04-02');   // 'P03-F4'
casting.report(store.people.records(), catalog, '1200-04-02');
```

## Five decisions worth knowing before reading the code

**The simulation never knows it is being watched.** No simulation package may
import this one, and this one may import only `@rpgsim/shared`,
`@rpgsim/sim-core`, `zod` and `node:*`. Both directions are enforced by
`test/layering.test.ts` rather than intended. A world whose behaviour depended on
whether anybody was writing it down would not be reproducible from its seed; and
a chronicle that could reach into `@rpgsim/world` could ask the travel system
where somebody is, which would quietly stop Phase 1's honesty rule — a villager
may only be written about where the record shows they were — from being
enforceable at all.

**Only birth facts go in `people.txt`, because only birth facts never change.**
A death, a move, a marriage are all *events* and belong in the annals. Putting
them in a column would mean rewriting a line, and a line that can be rewritten
is a line that can be quietly rewritten. Who is alive on a given day is derived:
present in the people file, with no death in the annals before that day.

**The filter is data and the wording is code.** `data/chronicle/significance.json`
gives each event type a weight and sets the threshold a line must clear
(directive 10); `DETAIL` in `annals.ts` decides how a kept event reads. The
split is deliberate — opinions about what is interesting change far more often
than code should, and an unknown type defaults to weight zero so a system added
in Phase 2 cannot silently start filling the permanent record with its internals.

**Both files are append-only, and that is enforced.** The people file skips
anybody it already holds; the annals refuse a day at or before the last one
written. Appending is deliberately *not* atomic, unlike the archive's whole-file
writes: the annals grow a handful of lines at a time and a torn append leaves a
short final line the reader refuses loudly, whereas rewriting a thirty-year file
through a rename would put the entire record at risk every single day.

**Distilling takes two passes, because worldgen announces a person before the
roof they live under.** `npc.created` carries no household — the house is
founded afterwards — so the family column can only be filled once the whole day
has been read. A one-pass version writes every founding villager down as
belonging to nobody, which is a mutation the tests now catch.

## Four more, for the press side

**A portrait is named by its sheet and its square: `P04-C3`.** Not `#117`.
Numbering the faces one to two hundred and forty would mean that inserting a
sheet renumbers everything after it, and every casting in the file would then
point at a different person — silently, because the ids would all still be
valid. Sheet-plus-cell ids cannot collide and cannot shift, so adding portraits
is adding a file and touching nothing.

**Everything press-side is keyed by slug, not by entity id.** A slug is a pure
function of a name, so it survives the archive being deleted and rebuilt. Entity
ids are an artefact of the order worldgen happened to run in; keying a casting on
one would mean that inserting a system which allocates an id earlier handed every
villager a stranger's face.

**A persona is a reading of a person, never a replacement for one.** `Person` in
`@rpgsim/npc` has a name, a sex, a birth date, a culture, twelve traits, a
household and a home — no backstory, no appearance, no turn of phrase, and it
should stay that way: `TRAIT_NAMES` fixes the order the generator draws in, so
adding a field or nudging a value rewrites every world built from an existing
seed. So the persona lives here, and everything in it must be derivable from the
numbers the simulation already rolled. Walter Barrow agrees with you and then
does the other thing because his honesty is 17 and his empathy 18, not because
it made a better story.

**A tie is scenery, not state.** Households are islands in Phase 1 — the
simulation knows who lives under a roof and nothing about who owes whom — so the
connections between houses are declared in `community.json`, dated and visible.
Two rules keep that honest: a tie may never contradict the record, and a tie
never moves a person, a coin or an object, because directive 13 forbids any
feature that bypasses the economy. When Phase 2 gives the simulation
relationships of its own, those become events and this file shrinks to whatever
is still unmodelled.

## Tests

`people.test.ts` covers slugs and the file format, `annals.test.ts` the
judgement, `annals-store.test.ts` the promise about the bytes, and
`layering.test.ts` the dependency direction. The whole-village checks live in
`apps/simulator/test/annals.test.ts`, including the one that decides whether the
design is right: **delete the day archive, rebuild it from the seed, re-distil,
and get byte-identical annals.**

`portraits.test.ts`, `casting.test.ts` and `persona.test.ts` cover the press
side, and `apps/simulator/test/cast.test.ts` checks the **real** files in
`data/chronicle/` against a real World Zero run: every cast slug is somebody the
record holds, every villager has a persona, nobody wears a face of the wrong sex
or life stage, and no face is worn by two people. Every way those files can be
wrong is silent on the page, which is why they are tested against the record
rather than reviewed.

A sixteen-mutant sweep over the memory sources and a forty-four-mutant sweep
over the press side each leave no survivors. A test that passes with the code
broken is not a test yet.

## Rules it inherits

- `distil` is a pure function of its inputs: no clock, no filesystem, no
  randomness, no ambient state. Only `annals-store.ts` touches the disk.
- `packages/sim-core/test/determinism-guard.test.ts` scans these sources under
  `REPRODUCIBLE_SOURCES`. The chronicle does not run inside the simulation, so
  the guard's original reason does not cover it; the one that does is that the
  annals are never rewritten, so a `Math.random` here would break the rebuild
  quietly and permanently.
- An npc the record has never heard of throws rather than rendering a
  placeholder. A `?` written into a permanent record is permanent, and the usual
  cause is an archive missing the day the village was founded — exactly the
  failure this layer exists to make impossible.
