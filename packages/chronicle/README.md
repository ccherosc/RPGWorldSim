# @rpgsim/chronicle

The village's memory: what a place would still be talking about next year.

The day archive in `@rpgsim/sim-core` is exact and enormous — about 80 MB of
JSONL a simulated year — and it is a **cache**, not a record. The seed
reproduces it byte for byte, so it can be deleted and rebuilt at will. What
cannot be rebuilt from a seed is a *judgement* about what mattered. That
judgement is what this package makes, and it is small enough to keep forever.

**Status: slices 3 to 5 of [CHRONICLE_V1.md](../../docs/CHRONICLE_V1.md) have
landed.** Memory is recorded and exported, the record is read back as a scored
day, and the villagers write posts from it. Nothing in the simulation reads its
own memory yet — villagers do not act on what they remember until the slice
after the paper.

## What is here

| Module | Owns |
| --- | --- |
| `significance.ts` | the weights schema, `weightOf`, `isNotable` — the filter, as data |
| `table.ts` | the one formatting decision both files share: tab-separated cells, `-` for empty |
| `people.ts` | `PeopleRegister`: slug allocation and the people file |
| `places.ts` | `PlaceRegister`: the same, for everywhere that exists |
| `annals.ts` | `distil`: one archived day in, one day's worth of memory out |
| `annals-store.ts` | the only thing that touches the disk |
| `day.ts` | `ChronicleDay`: one day, indexed by actor, place and type |
| `score.ts` | `scoreOf`, `rank`: how newsworthy something is, in whole numbers |
| `select.ts` | `select`: what leads the edition, and whose turn it is to post |
| `witness.ts` | `Whereabouts`: where everybody was, and when — the honesty rule |
| `post.ts` | `writePost`, `writePosts`: a villager's day, assembled from event ids |
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
  places: store.places,  // the same, for everywhere `place.created` announced
});
store.record(day);
```

Three files come out, and nothing else:

```
memory/people.txt        everyone who has ever existed, one line each
memory/places.txt        everywhere that exists, one line each
memory/annals/1200.txt   everything worth remembering, one line each
```

Reading the record back is `ChronicleDay` plus the two picks:

```ts
const today = new ChronicleDay({ key, events, people: store.people, places: store.places });
const edition = select({
  day: today,
  scoring,     // data/chronicle/scoring.json
  selection,   // data/chronicle/selection.json
  published,   // every day already on the site: the rota reads nothing else
});
```

`witness.ts` and `post.ts` are what the blog is made of:

```ts
const whereabouts = new Whereabouts(today);              // half-open stays, per person
const posts = writePosts(edition.posters, {
  day: today,
  whereabouts,
  scoring,
  templates,   // data/chronicle/templates.json
  worldSeed: 'world-zero',
});
posts[0]?.lines[0];   // { text: 'Turned away from The Mill.', sources: [41207] }
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

**Newsworthiness is five whole numbers added up, and it never reads a word.**
Rarity against *this day* rather than against a table, a bonus for a refusal, a
bonus per extra actor, a bonus for a public place, a bonus per cause — all of
them in `scoring.json` (directive 10), all of them integers, because a score
with a fraction in it is a page order that can differ between two machines that
agree on everything else. The score sees an event's type, actors, location and
causes and never its `data`, which is where any wording would live: rewriting a
headline cannot silently reorder the front page.

**The two picks are separate because a front page and a rota are different
things.** Headlines are merit alone, with a floor (a quiet day gets a short
edition, not a padded one) and a cap per event type (sixteen people turned back
from full cottages score identically, and without the cap the page is one story
printed five times — which is how a filter looks when it is working perfectly
and reading terribly). Posting villagers are merit *minus a rotation penalty*.

**The rotation penalty is derived, never stored.** It is computed by reading the
days already published and seeing who wrote them. A `last-posted.json` advanced
each day would be a second source of truth that can disagree with the first, and
it makes the site unrebuildable: delete it and every villager looks equally
overdue. Reading the published days back means a rebuild from an empty directory
reproduces the same rota, in the same order, every time.

**A villager is represented by their best moment, not by a sum.** Somebody who
arrived somewhere four hundred times had a dull day, and summing would make them
the most interesting person in the village.

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

## Two more, for the blog

**`Whereabouts` exists because `presenceOf` is not the honesty rule.**
`ChronicleDay.presenceOf` gives the set of places somebody was at *some point
today*, which is the right answer for counting and indexing and the wrong one
for deciding what a person may say. Somebody who crossed the green at dawn was
not there for the argument at dusk. So `witness.ts` rebuilds each person's day
as half-open `[from, until)` stays, and `saw(actor, event)` asks where they were
*at that tick*. `travel.blocked` is never used to place anybody: its two emit
sites disagree about what its location means — a refusal fires where the
traveller stands, an interruption fires at the node *ahead* of them — and one of
the two would place somebody somewhere they have never been. Nothing is lost,
because the arrival that put them on that road already opened the stay. The
model errs towards "you were not there", which is the right direction: too
strict costs a villager a sentence, too loose costs the project directive 5.

**A post is assembled from the day, not written about it.** One line per event,
each line carrying the id it came from, so "every sentence is traceable" is
something a test walks rather than something a colophon claims. Wording lives in
`templates.json` (directive 10) and a wording whose placeholders the event
cannot fill is *passed over*, never filled with a guess — there is no
"somewhere", no empty string, and no rendering of a boolean or a bare entity id,
because `household:3` in the middle of a sentence is the most embarrassing thing
this package could do. If nothing the author witnessed has wording, they do not
post: padding a thin day is lying slowly.

## Tests

`people.test.ts` and `places.test.ts` cover slugs and the file formats,
`annals.test.ts` the judgement, `annals-store.test.ts` the promise about the
bytes, `day.test.ts` the read model, `score.test.ts` and `select.test.ts` the
arithmetic and the two picks, and `layering.test.ts` the dependency direction. The whole-village checks live in
`apps/simulator/test/annals.test.ts`, including the one that decides whether the
design is right: **delete the day archive, rebuild it from the seed, re-distil,
and get byte-identical annals.** `apps/simulator/test/edition.test.ts` does the
same for the page: two villages built from one seed into different directories
produce identical editions, and every name a headline prints comes out of the
record rather than off an id.

`portraits.test.ts`, `casting.test.ts` and `persona.test.ts` cover the press
side, and `apps/simulator/test/cast.test.ts` checks the **real** files in
`data/chronicle/` against a real World Zero run: every cast slug is somebody the
record holds, every villager has a persona, nobody wears a face of the wrong sex
or life stage, and no face is worn by two people. Every way those files can be
wrong is silent on the page, which is why they are tested against the record
rather than reviewed.

`witness.test.ts` and `post.test.ts` are written as attacks rather than as
demonstrations: crossing a square hours before the thing that happened in it,
standing next door, being named by an event that points at a place ahead of you,
asking a wording for a fact the event has not got. The thirty-day checks are in
`apps/simulator/test/posts.test.ts`, and two of them can only be asked of real
days — **every line of every post of every day passes the presence test**, not a
sample, because what would get past a unit test is a rare shape of day rather
than a systematic fault; and **no shipped wording is dead**, because a misspelt
placeholder reads as silence instead of as an error.

A sixteen-mutant sweep over the memory sources, a forty-four-mutant sweep over
the press side and a twenty-seven-mutant sweep over the blog each leave no
survivors. A test that passes with the code broken is not a test yet.

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
