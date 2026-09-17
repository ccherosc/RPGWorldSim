# Chronicle v1 — the published village

**Status: planned.** No code yet. This document is written before the code, as
CLAUDE.md's development philosophy requires, so the state transitions, events,
invariants and failure cases are decided in advance.

[CHRONICLE.md](CHRONICLE.md) is the vision: what the publication becomes over
the next ten phases, and what it demands of the simulation along the way. This
document is the build plan for the first version of it — the one that exists
after Phase 1 and before Phase 2, which [PHASE_1.md](PHASE_1.md) section 5 calls
"the crudest possible day-in-review generated from the real event stream".

It is also the plan for putting that on a public link, because a publication
nobody can read is not a feedback loop.

---

## 1. Scope

### In

- A durable event history on disk, one file per simulated day.
- `packages/chronicle`: a read model over that history, a newsworthiness score,
  and templates.
- Four to six first-person villager posts a day, each limited to what its author
  actually did or was present for.
- A daily Towne Publication: the day in review, and the village at a glance.
- `apps/press`: static HTML, no server, no client-side JavaScript required.
- A GitHub Actions workflow that publishes to GitHub Pages once a day.

### Out — deliberately

**Classifieds.** An advert is a goal plus an unmet need plus the means to act,
and Phase 1 villagers have no goals, no needs and no money. A classified section
in v1 would be the exact failure CHRONICLE.md section 1 names: atmosphere
invented by a generator. It arrives with the economy, in Phase 3.

**Continuing stories.** A feud is a relationship under strain. There are no
relationships beyond household membership until Phase 5. A "continuing story"
assembled from Phase 1 events would be a list of coincidences with a headline
on it.

**Memory and provenance.** CHRONICLE.md is explicit that a real post is written
from an NPC's memory with its provenance intact, and that is Phase 5. v1 uses a
**presence proxy** in its place — see slice 3 — and says so in the paper itself
rather than pretending otherwise.

**Weather.** The weather system exists only in the probe world. The village has
no sky yet. A paper that opens with the weather every day would be opening with
a fact the simulation never produced.

**An LLM.** Prime Directives 12 and 15. v1 is templates. Prose polish is Phase
9 and rewrites an already-decided post; it never chooses what is reported.

### The bar for "done"

A public link. Opening it shows today's paper and today's posts from
Wodenshill. An archive reaches back to the village's first day. Every sentence
on the site traces to an event id in the durable history. Running the pipeline
twice from the same seed produces byte-identical HTML. The whole thing builds in
CI with no secrets, and nothing about the machine that built it appears in the
output.

And the question the paper exists to answer gets answered: **is a simulated day
in Wodenshill interesting to read?** If the honest answer is no, that is the
most valuable thing this slice can produce, and it is why it comes before
Phase 2 rather than after it.

---

## 2. Decisions taken in advance

### The three that were chosen deliberately

**Hosting is GitHub Pages.** Free and unmetered for a public repository, the
code is already on GitHub, and the same CI that runs `npm run check` can build
and publish. The output is static files, so moving to Cloudflare Pages or a
custom domain later costs a DNS record and a workflow edit, not a rewrite. The
alternative — a small server that renders on request — would buy nothing,
because a day's paper never changes after the day ends.

**One village day per real day.** The site shows today's paper and today's
posts. A reader who visits daily follows the village at the pace they live at,
and gets attached to people, which is the whole point of the denizen posts. A
faster cadence turns the archive into a firehose nobody reads; a slower one
means the world stops being a habit.

**History may be rewritten now, and freezes at launch.** While the only reader
is the author, the world is young and changing it is cheap — a better worldgen
or a bug fix should be allowed to change what day four was. Once the link is
given to other people, a line is drawn: everything already published is
permanent.

That decision is enforced mechanically rather than by discipline. See slice 5:
the manifest records a state hash per published day, and once `frozenThrough` is
set, a build that reproduces a frozen day differently **fails**. A change to
simulation code that would rewrite published history becomes a red build, not a
silent retcon.

### The technical ones

**The archive is one file per simulated day, written whole.** The unit the
chronicle reads is a day; the unit the site publishes is a day. A day file is
buffered in memory and written once, through a temporary file and a rename, so
it is either complete or absent and never torn. A crash therefore loses at most
one day — and a lost day is recoverable by re-running the seed, which is what
determinism is for. This is the opposite of the choice made for saves, where
losing state is unrecoverable; it is a different trade because the data is
different.

**The durable sink lives in `sim-core`, next to the save store.** Determinism
rule 4 forbids simulation code from *reading* the filesystem, because a world
whose history depended on the state of the disk would not replay. Writing is
not that: `JsonFileSaveStore` already lives in `packages/sim-core/src` and
writes files. The sink is the same kind of thing, and the `EventSink` interface
it implements is already there.

**Lines are canonical JSON.** Sorted keys, the same encoder the state hash uses.
Two runs of the same seed then produce byte-identical archives, so `diff` over
two histories is a readable answer to "what did that change do?" — the test
instrument CHRONICLE.md section 3 promises.

**The chronicle reads a day bundle, not a save.** A save is a versioned,
per-module snapshot of every package's internal shape; a chronicle that read one
would be coupled to all of them and would break every time a module bumped its
save version. Instead the simulator writes, beside each day's events, a **cast
file**: the display names of every person and place the day refers to, plus each
person's household and home. It is world state, it is small, and its shape is
the chronicle's to define.

**The chronicle gets its own RNG, derived from the world seed, never from the
simulation's.** `RngStream.Chronicle` exists so that changing a template's
wording cannot perturb a single tick of the world. The simulation must not be
able to tell it is being read.

**Selection is integer arithmetic with explicit tie-breaks.** Newsworthiness is
a score, not a sample. Ties break by event id, which is monotonic and stable.
Nothing in selection may depend on iteration order of a `Set` or `Map`
(determinism rule 5).

**`packages/chronicle/src` joins the determinism guard's scanned sources.** It
must not call `Math.random`, `Date.now` or the implementation-defined `Math`
functions either, because "the same seed produces the same newspaper" is the
same guarantee as "the same seed produces the same world". A layering test is
added alongside it: `chronicle` may import `sim-core`; `sim-core` may never
import `chronicle`.

**A section with nothing real to say is omitted, and the colophon says why.**
An empty Classifieds box reads as a broken website. A colophon that reads "there
are no classifieds yet; they arrive when Wodenshill has an economy" reads as a
world under construction, which is the truth and is more interesting than the
box.

**The v1 paper is unsigned.** CHRONICLE.md wants the Towne Publication written
by one literate villager. Phase 1 has no literacy, no occupations and no status,
so choosing an author would mean inventing a fact about a specific person —
exactly what the governing rule forbids. The paper carries the village's name
and a colophon noting that it will be signed when somebody in Wodenshill can
read. Phase 3 gives it an author.

---

## 3. Slices

Six slices. Each is independently testable and leaves the repository in a state
where `npm run check` and `npm run verify` pass.

### Slice 1: durable event history — **built**

Closes technical debt item 5 in [PHASE_0.md](PHASE_0.md) — "the event log has no
persistent sink implementation" — which CHRONICLE.md section 3 promotes from
nice-to-have to necessary.

Built in `packages/sim-core/src/event-archive.ts`:

- `EventArchive implements EventSink` — buffers a simulated day and writes it to
  `<root>/days/<year>-<month>-<day>/events.jsonl` when the day rolls over, on
  `flush()`, and on `close()`, through a temporary file and a rename.
- `readEventDay(root, key)` — parses a day file back to `SimEvent[]`, validating
  every line through the log's own `eventFromJson` and naming the line that fails.
- `readArchiveManifest(root)` — `<root>/manifest.json`: the days present, in
  order, each with its event count and the world's state hash at the end of that
  day. `listArchivedDays(root)` reads the same thing off the disk, so the
  manifest can be checked against reality rather than trusted.
- `apps/simulator` gains `--archive <path>` and `--rewrite`, and seals each day
  with `sim.hash()` as that day finishes.

Rules it enforces:

- It refuses to overwrite a day file it did not write itself unless constructed
  with `rewrite: true`. Re-running a world that has already been archived is the
  normal case during development and must be asked for explicitly, because the
  alternative is silently doubling a day's events on a resume.
- Reading a day that is not on disk throws, naming the date. An absent day is
  not an empty day (sim-core rule 10): a silent village still writes a file.
- A malformed line throws, naming the file and the line number, and does not
  skip it.
- Events arriving out of tick order, or for a day already closed, throw. Either
  one means two histories are being interleaved into one file.

Three things the plan did not anticipate, recorded here because they changed the
design and not only the code:

- **The module is `event-archive.ts`, not `event-file-sink.ts`.** The sink is
  the smaller half of what this is; the readers and the manifest are the other
  half, and naming the module after the sink hid the part the Chronicle actually
  depends on.
- **The manifest carries `complete`.** It is rewritten as each day lands, so an
  interrupted run leaves a readable partial archive — which is the point — but
  that also means "there is a manifest" does not mean "the run finished". Only
  `close()` sets `complete`, and slice 6 refuses to publish an archive without it.
- **`sealDay` accepts a day that has already rolled shut on its own.**
  `runUntil(t)` is inclusive of `t`, so a driver that runs to the first tick of
  tomorrow hands the archive an event belonging to tomorrow before it can seal
  today. Moving that boundary would have changed every golden hash in the
  project, so the archive absorbs it instead: when the day just closed is the
  day being sealed, the hash is attached to it.

Tests: 29 in `packages/sim-core/test/event-archive.test.ts` and two in the CLI's.
Round-trip every Phase 1 event type through write and read and compare
deep-equal; two runs of one seed produce byte-identical files; a day boundary
lands exactly on the tick where the date changes; an unasked-for overwrite
throws; a truncated last line throws with the line number; the manifest's hashes
match `sim.hash()` taken at the same ticks; and a write that dies part way
through leaves the previous day still readable, which is the only test that can
tell an atomic write from a direct one.

A fourteen-mutant sweep over the module and the CLI leaves no survivors.

### Slice 2: events the Chronicle needs and the village does not emit

[PHASE_1.md](PHASE_1.md) section 3 lists ten event types. Three of them are not
emitted by any code: `world.generated`, `npc.born` and `household.formed`. They
were specified because a chronicle needs them and deferred because nothing read
them. Now something does.

- `world.generated` — at the opening tick: the seed, the village name, the
  counts, the date it opens on.
- `npc.born` — one per villager at worldgen, carrying the name and the backdated
  birth date, with the household as cause where one exists.
- `household.formed` — members, the dwelling, the family name.

These land at the world's starting tick, which means a naive day-one paper would
announce eighty-six births and twenty-four weddings on the same morning. So:
**events at the world's opening tick are the founding record, not news.** The
chronicle renders them once, on an "About Wodenshill" page, and excludes them
from every daily paper. The rule is stated as a predicate on tick, not a list of
event types, so a future `npc.born` from an actual birth is news.

Tests: each new event carries actors, a location where one is meaningful, and
`causes` where a cause exists; a village of 86 people emits 86 `npc.born`; the
day-one paper contains no founding event.

### Slice 3: `packages/chronicle` — the read model and the score

New package. Depends on `sim-core` read-only and on the archive. Never imported
by `sim-core`.

- `cast.ts` — the cast file's schema and reader: id to display name for people
  and places, each person's household and home. Looking up an id that is not in
  the cast throws; the chronicle never prints `npc:47` and never guesses.
- `day.ts` — `ChronicleDay`: a day's events, indexed by actor, by location and
  by type, with a `presenceOf(npc)` set built from travel and rest events.
- `score.ts` — newsworthiness, integer-only. Rarer event types score higher than
  common ones; a refusal (`travel.blocked`, `npc.could-not-rest`) scores higher
  than a success, because a thwarted intention is the most readable thing Phase 1
  produces; more actors scores higher than fewer; a public location scores higher
  than a private one; an event with `causes` scores higher than one without.
  Ties break by event id.
- `select.ts` — picks the day's headline events and the day's posting villagers,
  with a rotation penalty so the same three people do not post every day. The
  penalty is derived by reading the previous published days, not by keeping a
  ledger, so a rebuild from scratch selects identically.

Tests: the score is a pure function of the event and the day; changing a
template's wording does not change any score; the same day scores identically on
two runs; rotation actually rotates over thirty days (no villager posts on more
than a stated fraction of them); an unknown id throws rather than rendering.

### Slice 4: villager posts — depth

Four to six first-person posts a day.

**The honesty rule, and its v1 compromise.** A real post comes from the author's
memory with provenance (Phase 5). There is no memory model yet, so v1 uses a
presence proxy: **a villager may write only about events they were an actor in,
or that occurred at a location they were at at the time.** Everything a post
says has an event id behind it and that event passes the presence test. There is
no "I heard that…" in v1, because hearsay without a knowledge model is
omniscience wearing a hat, and Prime Directive 5 is not negotiable. The colophon
says this plainly.

Each post carries, in the generated HTML as data attributes and in a footer
line, the event ids it was built from. That is the `WHY?` chain for a sentence,
and it is what makes the claim "every sentence is traceable" checkable by a test
rather than by assertion.

Templates are per event type, in a data file, with wording variants selected
from the chronicle RNG seeded by `(worldSeed, date, npcId)`.

Tests: no post references an event failing the presence test — checked
exhaustively over thirty generated days, not on a sample; a post with no
qualifying events is not generated rather than padded; the same day generates
identical posts twice; a golden hash pinned on one day's posts for the
`world-zero` seed.

### Slice 5: the Towne Publication — breadth

One page a day. Sections, each omitted when empty:

- **Dateline** — the village name and the date, from the calendar.
- **The day in review** — the highest-scoring public events, grouped by kind and
  written in the third person, with names from the cast.
- **The village at a glance** — people, households, places, how many were abed
  at midnight, how many journeys were made, how many were refused. Real counts
  from real events.
- **Colophon** — what this paper cannot yet tell you, and which phase brings it:
  classifieds with the economy, continuing stories with relationships, a named
  author when somebody in Wodenshill can read, provenance when there is memory.

Tests: every number in "at a glance" is derivable from the day's events and is
recomputed by the test independently; a day with no public events produces a
paper with the review section absent, not an empty heading; the paper never
names an entity absent from the cast.

### Slice 6: `apps/press` and the public link

`apps/press` turns chronicle output into a static site. It is an app, not a
package, because the simulator must not acquire a dependency on HTML.

Output tree:

```
site/
  index.html          today's paper and today's posts
  days/<date>.html    one page per published day
  archive.html        every published day, newest first
  about.html          the founding record, and how this works
  style.css           hand-written, no framework
```

No client-side JavaScript is required to read it. No fonts, scripts or
stylesheets are fetched from anywhere else — partly so the site works offline,
and partly because a reader should not have their visit reported to a third
party in order to read about a village.

**Publishing safety.** CHRONICLE.md section 4: *the site publishes world state,
never repository state, secrets, or anything about the machine that ran it.* A
test scans every generated file for the repository root path, the home
directory, anything shaped like an email address, any value present in
`process.env`, and the string `node_modules`, and fails on a hit. The world seed
is permitted in the colophon, because a seed is a fact about the world rather
than about the machine.

**The workflow.** `.github/workflows/publish.yml`, on a daily schedule and on
manual dispatch:

1. `npm ci`, then `npm run check` — a broken build never publishes.
2. Compute the day count: `days = today − firstPublished`, from
   `data/world/publication.json`. **The wall clock is read here and nowhere
   else.** It is an input to the publisher, exactly like `--days` typed by hand;
   no simulation code ever sees it.
3. Run the village forward that many days from the seed, archiving as it goes.
4. If `frozenThrough` is set, compare the regenerated days against the committed
   manifest and **fail on any mismatch**. This is the freeze.
5. Build the site and deploy to Pages.

Regenerating the whole history on every publish is the simple choice and it
keeps the repository free of generated state. It is also linear in the age of
the world, so the first thing slice 6 measures is how long a year takes. If it
grows uncomfortable, the fallback is to commit the archive and the save and run
only the new day — the manifest already makes that safe, because a committed day
hash proves the resumed world matches the regenerated one. That fallback is not
built until the number says it is needed.

`data/world/publication.json` is new: the masthead, the first village day, the
real date of first publication, and `frozenThrough` (null until launch).

Tests: the site builds into a temp directory and every internal link resolves; a
day page contains the paper and that day's posts and nothing from another day;
the scan for machine facts passes; building twice produces byte-identical
output; a deliberately mutated past day fails the frozen-manifest check.

---

## 4. Invariants

New invariants and checks, in the spirit of sim-core rule 11:

1. Every archived event round-trips: parsing a written line yields a value
   deep-equal to the event that was written.
2. The manifest and the filesystem agree: every day listed exists, every day
   present is listed.
3. Every entity id printed by the chronicle appears in that day's cast.
4. Every claim in a post traces to an event id, and that event passes the
   author's presence test.
5. Once `frozenThrough` is set, the state hash of every day at or before it is
   fixed. A build that computes a different one fails.

## 5. Failure cases, and what each does

| Case | Behaviour |
| --- | --- |
| Day file already exists | Throw, unless `rewrite` was asked for |
| Day requested is not in the manifest | Throw, naming the date |
| Truncated or malformed archive line | Throw, naming file and line |
| Id not in the cast | Throw; never print a raw id |
| No qualifying events for a chosen villager | Choose no post; never pad |
| A section has nothing real to report | Omit the section; the colophon explains |
| A frozen day reproduces differently | Fail the build; do not publish |
| The simulation fails `npm run check` | Do not publish |

## 6. Risks

- **The paper is boring.** This is the expected outcome of a village with no
  hunger, work, money or relationships, and it is the *point* of building it
  now: it sets the baseline every later system is judged against. The risk is
  reacting to it by adding invention to the chronicle instead of depth to the
  simulation. The governing rule exists to make that reaction impossible.
- **Rebuild time grows with the archive.** Measured in slice 6; the fallback is
  written down above so it does not have to be invented under pressure.
- **The presence proxy quietly becomes permanent.** It is a compromise with a
  named expiry: Phase 5 replaces it with memory and provenance. It is stated in
  the paper's own colophon so that the compromise is visible to readers, not
  just to this document.
- **Publishing something that should not be published.** Mitigated by a scan
  that runs in CI and fails the build, rather than by remembering.

## 7. What comes immediately after

Phase 2 — survival — which is the first system that gives a villager something
to want and therefore gives the paper something to report. The order was set by
[PHASE_1.md](PHASE_1.md) section 5 and has not changed: build the reader first,
so every later system arrives with a way to tell whether it made the world more
interesting.
