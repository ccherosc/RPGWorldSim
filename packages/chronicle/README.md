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

```ts
const store = new AnnalsStore({ root: './memory' });
const day = distil({
  key: '1200-04-01',
  events: readEventDay('./history', '1200-04-01'),
  calendar,
  significance,          // loaded by the app from data/world/significance.json
  people: store.people,  // advanced in place; new people are handed slugs
});
store.record(day);
```

Two files come out, and nothing else:

```
memory/people.txt        everyone who has ever existed, one line each
memory/annals/1200.txt   everything worth remembering, one line each
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

**The filter is data and the wording is code.** `data/world/significance.json`
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

## Tests

`people.test.ts` covers slugs and the file format, `annals.test.ts` the
judgement, `annals-store.test.ts` the promise about the bytes, and
`layering.test.ts` the dependency direction. The whole-village checks live in
`apps/simulator/test/annals.test.ts`, including the one that decides whether the
design is right: **delete the day archive, rebuild it from the seed, re-distil,
and get byte-identical annals.**

A sixteen-mutant sweep over these sources leaves no survivors. A test that
passes with the code broken is not a test yet.

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
