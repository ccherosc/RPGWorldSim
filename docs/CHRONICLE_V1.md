# Chronicle v1 — the published village

**Status: built.** All seven slices are done, and the deviations from the plan
are recorded in each slice's `**Built.**` block rather than edited out of the
plan above. The plan itself was written before any of the code, as CLAUDE.md's
development philosophy requires, so the state transitions, events, invariants and
failure cases were decided in advance -- and so that where the world disagreed
with the plan, the disagreement is on the record.

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

- A durable event history on disk, one file per simulated day — generated, read
  and thrown away, because the seed can rebuild it.
- **The annals**: the permanent record, plain text, small enough to commit — who
  has ever lived, and one line for every event that mattered.
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
**presence proxy** in its place — see slice 4 — and says so in the paper itself
rather than pretending otherwise.

**Weather.** The weather system exists only in the probe world. The village has
no sky yet. A paper that opens with the weather every day would be opening with
a fact the simulation never produced.

**An LLM.** Prime Directives 12 and 15. v1 is templates. Prose polish is Phase
9 and rewrites an already-decided post; it never chooses what is reported.

### The bar for "done"

A public link. Opening it shows today's paper and today's posts from
Pennycroft. An archive reaches back to the village's first day. Every sentence
on the site traces to an event id in the durable history. Running the pipeline
twice from the same seed produces byte-identical HTML. The whole thing builds in
CI with no secrets, and nothing about the machine that built it appears in the
output.

And the question the paper exists to answer gets answered: **is a simulated day
in Pennycroft interesting to read?** If the honest answer is no, that is the
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

That decision is enforced mechanically rather than by discipline. See slice 6:
the manifest records a state hash per published day, and once `frozenThrough` is
set, a build that reproduces a frozen day differently **fails**. A change to
simulation code that would rewrite published history becomes a red build, not a
silent retcon.

### The technical ones

**The permanent record is the annals; the day archive is a cache.** The world
is deterministic, so `seed + days` reproduces every event exactly. That makes
the ~80 MB a simulated year of JSONL costs a rebuildable artefact rather than a
record, and it is treated as one: generated, read, gitignored, discarded. What
is kept forever is the part no seed can reproduce — a judgement about what
mattered — and as plain text that is one or two megabytes a year. Slice 3 is
where this is built, and the test that makes it safe is the one that deletes the
archive, rebuilds it, and gets byte-identical annals back.

**Plain text, tab-separated, not JSON and not a database.** The annals are meant
to be opened and read, and `git diff` over a year is how a change in the
village's character gets noticed at all. JSONL repeats every key name on every
line for no reader's benefit; SQLite is not text and does not diff. The cost is
that the format has no schema enforcing it, which is why the reader parses
strictly and the writer is the only thing allowed to touch the file.

**The simulation never reads the annals.** Determinism rule 4 — a world whose
villagers behaved according to a file on disk would be a world that behaved
differently after somebody deleted the file. Memory that changes behaviour lives
in simulation state, is saved in the envelope, and is hashed like everything
else; the annals are an **export** of the world's history, never an input to it.
The arrow points one way, and a layering test will keep it pointing that way.

**Significance is a number in data, not a branch in code.** Which events reach
the annals is `data/chronicle/significance.json`: a weight per event type and a
threshold. Directive 10. The alternative is a `switch` that grows a case every
time somebody has an opinion about what is interesting, in a file nobody
reviews as a whole.

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
are no classifieds yet; they arrive when Pennycroft has an economy" reads as a
world under construction, which is the truth and is more interesting than the
box.

**The v1 paper is unsigned.** CHRONICLE.md wants the Towne Publication written
by one literate villager. Phase 1 has no literacy, no occupations and no status,
so choosing an author would mean inventing a fact about a specific person —
exactly what the governing rule forbids. The paper carries the village's name
and a colophon noting that it will be signed when somebody in Pennycroft can
read. Phase 3 gives it an author.

---

## 3. Slices

Seven slices. Each is independently testable and leaves the repository in a state
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
  `close()` sets `complete`, and slice 7 refuses to publish an archive without it.
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

### Slice 2: the events the Chronicle needs — **built**

[PHASE_1.md](PHASE_1.md) section 3 listed ten event types and named three as
unemitted: `world.generated`, `npc.born` and `household.formed`. Two of those
three turned out to exist already under better names — `npc.created` carries
`origin: "founding"` and does everything `npc.born` was specified to do, and
`society.household-founded` is `household.formed` with the package that owns it
in the name. PHASE_1.md section 3 has been corrected to the names that ship.

So the slice shrank to one new event, and grew a second half that the plan had
not seen: the record was complete in *what* it contained and empty in *why*.

**`world.generated`** — the seed, the village name, the counts and the date it
opens on. Emitted **last** rather than first, because the counts it carries do
not exist until worldgen has finished and an opening line that had to be
corrected afterwards would not be a record. Every founding event shares its
tick, so a reader wanting them in order reads by event id. It carries the seed
on purpose: everything else in the archive is an observation about the village,
and this is the one line that says *which* village, which is what lets a rebuilt
archive be checked against the one it claims to reproduce.

**The founding was being lost entirely.** `--archive` attached its sink to the
world the factory returned, and by then worldgen had already announced every
person and every household as it made them. A two-day archive held 1,250 events
and not one `npc.created`: a village of strangers, correct in every other
respect and useless to a chronicle that has to say who anybody is. `WorldFactory`
gained a `beforePopulating` hook, the CLI attaches the archive through it, and
the same run now archives the full founding — 86 creations, 24 households, 47
kinship lines. Worldgen is the one moment that cannot be observed after the
fact, and nothing else in Phase 1 has that property.

**`causes`, threaded through the three chains that make a day.** Before this,
every archived event had `"causes":[]`: a pile, not a chain. Eighty-six
villagers walking the same four lanes emit departures that are indistinguishable
by their payloads, so "why is Edric standing in the mill" could be guessed from
timestamps and not read from the record.

- *Travel.* `begin` takes the decision that prompted it. `travel.departed` cites
  that decision; `travel.arrived` cites its own departure; the next leg cites
  the arrival before it; `travel.blocked` cites whatever was being attempted. A
  walk across the village reads back as one unbroken chain.
- *The daily cycle.* `npc.woke` is cited by the walk out. `npc.turning-in` is
  cited by the walk home. `npc.went-to-bed` cites the arrival at the door.
- *The founding.* `society.household-founded` is cited by every
  `npc.household-changed`, every `npc.home-changed` and every
  `society.parentage-recorded` it produced.

That is 87% of a village day. The remainder is deliberate and is pinned by a
test rather than left to drift: `world.generated`, `place.created`,
`npc.created` and `society.household-founded` are the founding, which did not
come from anywhere,
and `npc.woke` and `npc.turning-in` are the clock coming round, which is not an
event. An invented cause would be a worse record than an honest silence.

**Founding events are the record, not the news.** They all land on the world's
opening tick, so a naive day-one paper would announce eighty-six births and
twenty-four weddings on the same morning. The chronicle renders them once, on an
“About Pennycroft” page, and excludes them from every daily paper. The rule is a
predicate on tick, not a list of event types, so an actual birth years later is
news.

Three things came out differently from the plan.

**`Journey` gained a saved field.** An arrival cites the departure that started
its leg, and the departure happened before any save taken mid-walk. A resumed
world whose arrival cited nothing would be emitting a different event from the
one an uninterrupted run emits — so the departure's id is journey state, and
determinism rule 8 says journey state persists. It is optional in the schema
only so that saves written before this slice still load.

**`npc.turning-in` moved ahead of the walk it causes.** It used to be emitted
after `travel.begin` returned, so it could carry the arrival tick. Read in
order, the record therefore said a villager set out and *then* decided to, and
nothing downstream could cite the reason they were on the road. The decision now
goes out first and the departure it causes carries the arrival tick, so nothing
was lost.

**`society.household-founded` moved ahead of its memberships** for the same
reason: moving into a house is a consequence of the house existing, and a
consequence recorded first has nothing to point back at. Everything the event
says is already true when it goes out.

Every golden hash in the project moved, because `Simulation.hash()` is taken
over the save envelope and the envelope contains the event log. That is the
intended design — the record is part of the world — and it is why this slice
landed as one commit rather than five.

Tests:

- A two-leg walk links decision → departure → arrival → departure → arrival, and
  `log.trace` walks it back to the decision in one call.
- A refusal carries the same cause the attempt had.
- A journey saved mid-leg still cites its departure after the reload, checked
  against an uninterrupted run rather than against its own hash.
- A village day contains **no** event with an empty `causes` outside the five
  listed types, and no event cites an id that does not exist or is later than
  itself.
- A listener attached through `beforePopulating` sees every `npc.created`, and
  attaching one does not change the world's hash — observation is not
  participation.
- `world.generated` is the last event of the founding and its counts match the
  world that was built.

### Slice 3: the annals — the village's memory — **built**

The durable archive from slice 1 is exact, machine-readable and far too big to
be a record. At the measured rate — 1,250 events a day for 86 villagers — a
simulated year is roughly 80 MB of JSONL. Nobody reads that, `git` should not
carry it, and "what happened in Pennycroft a few years ago" is the wrong
question to ask of it.

The thing that makes this cheap is already true and was not being used: **the
seed is the history.** Given the seed and a day count the simulation reproduces
every event byte for byte. So the day archive is a **cache**, not a record. It
can be deleted and rebuilt. What cannot be rebuilt is a judgement about what
mattered — and that, kept as plain text, is small.

So the permanent record is two kinds of file, and nothing else.

**`<root>/people.txt`** — one line per person who has ever existed, written once
and never rewritten:

```
# slug  id  name  sex  born  family
jocelin-netherby  npc:0  Jocelin Netherby  male    1160-03-02  netherby
matilda-netherby  npc:1  Matilda Netherby  female  1157-09-15  netherby
adela-netherby    npc:2  Adela Netherby    female  1192-07-29  netherby
```

Only birth facts live here, because only birth facts never change. A death, a
move, a marriage are all *events* and belong in the annals; putting them in a
column would mean rewriting a line, and a line that can be rewritten is a line
that can be quietly rewritten. Who is alive on a given day is derived: in
`people.txt`, with no death in the annals before that day.

Slugs are stable and deterministic, derived from the whole name with a numeric
suffix when taken, in the order the day announced people — so a second Agnes
Hargrave is `agnes-hargrave-2` and never displaces the first.

**`<root>/annals/<year>.txt`** — one line per notable event, one file per
simulated year, appended in order and never reordered:

```
# date  time  event  who  detail  id
1200-04-01  00:00  npc.created                 jocelin-netherby    Jocelin Netherby, aged 40, founding             #1
1200-04-01  00:00  society.household-founded   jocelin-netherby,…  the Netherby house, 4 under the roof            #5
1200-04-01  00:00  society.parentage-recorded  adela-netherby      child of matilda-netherby and jocelin-netherby  #14
1200-04-02  07:11  travel.blocked              tanner-3            turned back: full (8/8)                         #2167
```

Tab-separated, six columns, `-` where a column is empty. No braces, no repeated
key names, no quoting rules to get wrong. The trailing id is the event id in the
day archive, so every line traces back to the exact event that produced it —
which is the "every sentence traces to an event id" bar in section 1, met at the
memory layer rather than only at the page.

**What keeps it small is a filter, and the filter is data.**
`data/chronicle/significance.json` gives each event type a weight and sets the threshold a line
must clear to be written. Most of the 1,250 daily events are mechanics — woke,
walked, ate — and are worth nothing. Births, deaths, arrivals, departures,
household changes and failures clear it. Prime Directive 10 puts the numbers in
data; the alternative is a `switch` that grows a case every time somebody has an
opinion about what is interesting.

Rough sizes, from the measured event rate:

| | per simulated year |
| --- | --- |
| Day archive, JSONL | ~80 MB |
| Annals, filtered at the proposed threshold | ~1–2 MB |

A thirty-year village is therefore under 50 MB of text, and the day archive
stops being committed at all: it is generated, read, and thrown away.

New in `packages/chronicle` — created by this slice, extended by the next:

- `significance.ts` — the schema for the weights, `weightOf` and `isNotable`.
- `table.ts` — the one formatting decision both files share. A field holding a
  tab or a newline is refused rather than escaped: an escaping rule is a second
  format hiding inside the first.
- `people.ts` — slug allocation and the people file.
- `annals.ts` — `distil({ key, events, calendar, significance, people })` turns
  one archived day into annal lines. A pure function of its inputs: no clock, no
  filesystem, no randomness. The one thing it mutates is the people register
  handed to it, and that mutation is itself idempotent.
- `annals-store.ts` — the only thing that touches the disk. Appends; refuses a
  day at or before the last one written.

The chronicle is wired to the CLI as `npm run sim -- annals --archive <in>
--annals <out>`, which distils every archived day the record has not already
passed. It refuses an archive whose manifest is not `complete`: half a day
written into a permanent record stays half a day forever.

Two rules are enforced by tests rather than intended. **The simulation never
knows it is being watched** — no simulation package may import the chronicle, or
a world's behaviour could depend on whether anybody was writing it down. And
**the chronicle reads events, not systems** — it may import only `@rpgsim/shared`,
`@rpgsim/sim-core`, `zod` and `node:*`, so it cannot ask the travel system where
somebody is and quietly stop Phase 1's honesty rule from being enforceable.

The determinism guard now scans the chronicle too, under a second list named
`REPRODUCIBLE_SOURCES` with its own stated reason. The chronicle does not run
inside the simulation, so the existing justification did not cover it; the one
that does is that the annals are never rewritten, so a `Math.random` here would
break the rebuild quietly and permanently.

**This slice changes no simulation state.** No new save module, no new field, no
new event — so every golden hash in the project stays valid. It reads what
slice 2 already emits and writes text. That is the whole reason it is safe to
do now.

**Three things shipped differently from the sketch above**, and the reasons are
worth keeping.

*The entity id is a column.* Without it the file cannot be reopened: the annals
name people by slug and the archive names them by id, so something has to hold
the two together. The alternative was a sidecar index, which is a second file
that can disagree with the first. The id is itself a birth fact — assigned at
creation, never changed — so it breaks no rule by being there.

*Slugs use the whole name, not the surname.* The surname alone was tried and
does not survive contact with a real village: twenty-four families hold
eighty-six people, so a household of four came out `netherby`, `netherby-2`,
`netherby-3`, `netherby-4` — numbers standing in for exactly the names that make
a record readable. A slug's whole job is to be recognisable at a glance a decade
later. This was caught by reading the output, not by a test, which is the
argument for generating real output early.

*The last column of `people.txt` is the family, not the household.* Two Netherby
houses both read `netherby`. Households become identified things when household
events start to matter; until then the column says what a reader actually wants
from it and nothing it cannot back up. `sex` is also written as the simulation
states it — `male`, `female` — rather than abbreviated, because an abbreviation
is a decoding rule a reader in ten years has to be told.

Measured on a two-day archive of the `world-zero` village: 612,918 bytes of
JSONL distilled to 22,483 bytes of memory, or 3.7% — about 330 KB a simulated
year at the shipped weights, inside the 1–2 MB projected above.

Tests cover: distilling a day twice produces byte-identical lines and adds
nobody twice; appending day *n+1* leaves the bytes of day *n* untouched,
compared as a file prefix rather than by re-parsing; a routine event never
reaches the annals and moving a weight in `significance.json` changes what is
written with no code change; an event type nobody has an opinion about yet is
forgotten rather than kept; every annal line's id resolves to an event in the
archived day it names, and every slug it uses is explained by `people.txt`; an
npc the record has never heard of throws rather than rendering a placeholder,
because a `?` in a permanent record is permanent; and the family column is
filled from a house founded later the same day, which is what forced the
distiller to make two passes — `npc.created` carries no household, so a one-pass
version writes every founding villager down as belonging to nobody.

And the one that decides whether the design is right: **delete the entire day
archive, rebuild it from the seed, re-distil, and get byte-identical annals.**
It passes. The archive can be thrown away.

A sixteen-mutant sweep over the package leaves no survivors. The first pass left
one: nothing checked that `whoOf` skips non-people actors, so a household in an
actor list would have been looked up as a person. Two tests were added and the
sweep re-run clean.

Deferred, with a trigger rather than a vague "later": **collapsing old years.**
Once a year file passes about 2 MB, it is rewritten once at a higher threshold
and marked frozen, so a decade-old year costs a few hundred lines instead of
tens of thousands. The mechanism is the same filter with a second number, so
nothing new has to be invented; it is not built now because the village is
eleven days old and a collapse pass with nothing to collapse cannot be tested
against anything real.

### Slice 3b: the faces, the voices and the families — **built**

Slices 5 and 6 write in villagers' voices, and a voice needs somebody to belong
to. The record holds names, sexes, birth dates, households and twelve trait
scores, and that is all it should hold: `TRAIT_NAMES` fixes the order the
generator draws in, so adding an appearance field or nudging a trait value
rewrites every world built from an existing seed. So the reader-facing half of a
person lives on the press side, under a new directory.

**`data/world/` is what the simulation reads; `data/chronicle/` is what the
press reads.** `significance.json` moved across when the line was drawn, and
four files joined it:

```
data/chronicle/portraits/P01.json … P06.json   240 drawn faces, 40 to a sheet
data/chronicle/casting.json                    who wears which face, and from when
data/chronicle/personas.json                   how each of the 86 villagers comes across
data/chronicle/community.json                  20 families and 27 ties between them
```

**A portrait is named by its sheet and its square — `P04-C3`.** Not `#117`.
Sequential numbering means inserting a sheet renumbers everything after it, and
every casting then points at a different person while remaining perfectly valid.
Sheet-plus-cell ids cannot collide and cannot shift, so a new sheet of forty
faces is a new file and no edit anywhere else; the loader finds it by listing
the directory, sorted, rather than by a manifest that could be half-updated.

**Casting is keyed by slug and dated.** A slug is a pure function of a name and
survives the archive being deleted and rebuilt; an entity id is an artefact of
the order worldgen ran in. An entry is either a bare portrait id — "this face,
from the beginning" — or a list of takes each dated from the day it applies, so
the first child who grows up is a one-line edit rather than a migration. Nothing
in the code reshuffles a casting: `--propose` fills blanks only, never
reassigns, and never writes the file.

**A persona is a reading of a person, not a replacement for one.** Every line of
it is derived from traits the generator actually rolled. Walter Barrow agrees
with you and then does the other thing because his honesty is 17 and his empathy
18; Bartholomew Clay answers the question that was actually asked because his
honesty is 100. When Phase 2 makes traits drive behaviour, the blog and the
simulation will already agree.

**A tie is scenery, not state.** Households are islands in Phase 1 — the
simulation knows who lives under a roof and nothing about who owes whom — so
ties are declared, dated and visible in `community.json`, under two rules: a tie
may never contradict the record, and a tie never moves a person, a coin or an
object (directive 13). The twenty surnames worldgen drew fall into twelve trades
(Brewer, Dyer, Miller, Carter…) and eight places (Netherby, Underhill, Marsh…),
which is the ordinary shape of an English village and is read from the data
rather than invented.

**`npm run sim -- cast` is the check.** Every way these hand-written files can
be wrong is silent on the page: a misspelled slug shows nothing, a face cast
twice puts one head on two people. So the command reports coverage, shortages,
mismatches and strays against the record, and `apps/simulator/test/cast.test.ts`
runs the same comparison against a real World Zero run in CI.

A villager with no face is **news, not a failure**. Of 86 villagers, 80 are cast
and 6 are not — three infant girls, one infant boy and two twelve-year-old boys
— because no sheet holds a baby and the last child/m face was spent. Everything
else is in surplus: 26 spare older men, 25 spare young women. The shortage list
is the drawing order for the next sheet, and it is short and specific by design.

A forty-four-mutant sweep over `portraits.ts`, `casting.ts`, `persona.ts` and
`community.ts` leaves no survivors. The first pass left one — `PersonaBook`
sorted its keys in the constructor *and* on the way out, so breaking either one
alone changed nothing — and the answer was to delete the redundant sort rather
than to add a test for it: two guarantees of the same thing is one place for it
to quietly stop being true.

### Slice 4: `packages/chronicle` — the read model and the score — **built**

New package. Depends on `sim-core` read-only and on the archive. Never imported
by `sim-core`.

- `places.ts` — everywhere that exists, one line each: id, name, kind and
  whether anybody may walk in. Looking up an id that is not in the file throws;
  the chronicle never prints `location:3` and never guesses. (Planned as
  `cast.ts`, "id to display name for people and places". By the time it was
  built `people.ts` already did people and `casting.ts` had taken the word
  "cast" for the business of handing out portraits, so the file is named for
  what it holds.)
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

**Built.** `places.ts`, `day.ts`, `score.ts`, `select.ts`, with their numbers in
`data/chronicle/scoring.json` and `data/chronicle/selection.json` per directive
10. 77 tests across `places.test.ts`, `day.test.ts`, `score.test.ts`,
`select.test.ts` and `apps/simulator/test/edition.test.ts`, checked against
thirty deliberate mutations; all thirty die. Two survived the first sweep — a
crowd-cap test that used a crowd sitting exactly *on* the cap, and a best-moment
test where every one of the person's moments scored the same — and both were
weak tests rather than weak code.

**A simulation change was needed first.** The archive named every person and
merely numbered every place: `npc.created` carries a name, nothing said what
`location:3` was. The only way to find out was to count entries in
`village.json` and hope worldgen had allocated ids in file order — an assumption
about the order code ran in wearing the costume of a fact. `village-world.ts`
now emits **`place.created`** for all thirty-eight places as it builds them,
which directive 8 asked for independently of the press. It shifts every event id
after it, so the golden hash in `apps/simulator/test/village.test.ts` was
re-pinned in the same commit.

**What the rota measures, on a real thirty-day `world-zero` run.** 59 of 86
villagers posted; the busiest posted on 0.20 of the days; nobody posted two days
running; a second run reproduced all thirty days exactly. Headlines came out at
two to five a day, and two of the six slots on an ordinary day go to the same
kind of event. That is not the filter failing — it is §7's fork budget showing
through. Phase 1 offers roughly one real fork a day, and 27 of 86 villagers
never cleared the floor in thirty days. The press is correctly reporting a
boring world; the answer is more forks, not looser weights.

**A known limit of the rotation penalty, measured rather than guessed.**
Somebody whose score beats the village's by more than `cooling` posts nearly
every day, because once everybody carries a penalty their margin outlasts it. On
real days nobody is that far ahead, and the fix is a village where more kinds of
thing happen rather than a bigger `cooling` — a bigger number only moves the
threshold somebody has to clear before the same thing happens again.

### Slice 5: villager posts — depth — **built**

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

**Built.** `witness.ts` and `post.ts`, with the wording in
`data/chronicle/templates.json` per directive 10. 41 tests across
`witness.test.ts` and `post.test.ts`, plus 11 in
`apps/simulator/test/posts.test.ts` that ask the two questions only real days
can be asked. Checked against twenty-seven deliberate mutations; all
twenty-seven die. Six survived the first sweep: five were weak tests — a `when`
clause test that left an ungated wording eligible so the mutant hid behind a
coin toss, a list-of-names test with only one name in the list, no test at all
for a boolean placeholder, and two `Whereabouts` tests that asked `placeAt`
about a lie only `trailOf` could see — and the sixth was a redundant guard in
`chooseMoments`, fixed in the code rather than the test.

**The presence proxy needed a clock, not a set.** The plan says "at a location
they were at at the time", and `ChronicleDay.presenceOf` answers a weaker
question: the set of places somebody was at *some point today*. Used as the
honesty rule that is materially looser — somebody who crossed the green at dawn
would be handed the argument that happened on it at dusk. So `witness.ts`
reconstructs each person's day as half-open `[from, until)` stays from the
events that name both them and a place, and `saw(actor, event)` asks where they
were *at that tick*. A test asserts the gap directly: for one hand-built day
`presenceOf(villager).has(GREEN)` is `true` and `saw(...)` is `false`. The day
keeps its looser index for what it is honestly good for, which is counting and
indexing.

`travel.blocked` is excluded from placing people altogether. It has two emit
sites that disagree about what its location means: a refusal fires where the
traveller stands, an interruption fires at `stoppingAt`, the node *ahead* of
them that they have not reached. One of the two would place somebody where they
have never been, so neither is trusted, and nothing is lost because whatever
arrival put them on that road already opened the stay. Villagers still write
about being turned away — a refusal names them as an actor, which is a stronger
claim than standing nearby.

**A deliberate departure from the plan's letter.** The wording RNG stream is
`(worldSeed, date, slug)` rather than `(worldSeed, date, npcId)`. A slug is a
pure function of a name; an entity id is an artefact of the order worldgen
happened to run in. Rebuild the archive from the seed and the slug survives;
rebuild it after any worldgen change and the ids all shift, silently rewriting
every post the site has ever published. Nothing else about the plan's
determinism story changes.

**Dead prose is a test failure.** A misspelt placeholder, or a `when` clause
naming a value the simulation never produces, reads as silence rather than as
an error — the wording is simply never chosen, and nobody finds out. So the
thirty-day test offers every variant in the shipped book a real event of its
own type and requires each to fit at least one. That test rejected nine of the
first thirty-three wordings and, in doing so, surfaced **three code paths that
exist and never execute**: `npc.could-not-rest` (nobody's house is ever full at
bedtime), an interrupted turn-in and its `travel.blocked` with
`reason: 'bedtime'` (nobody is ever caught far enough from home), and
`npc.removed` (nothing kills anybody yet). They have no wording until they can
happen. That list belongs in §7 next to the fork budget: three of the most
readable things the village could produce are wired and unreachable.

**What thirty real days of `world-zero` produce.** 150 posts — five a day,
every day, because the rota fills its slots and every villager wakes — 450
lines, three per post, from 59 distinct authors. The citations run
`npc.woke` 145, `npc.went-to-bed` 145, `travel.blocked` 123, `npc.turning-in`
27, `society.household-founded` 5, `npc.home-changed` 5, and the two remaining
wordings (`npc.created`, `society.parentage-recorded`) are reachable but never
reached by a villager the rota picked. So a post today is mostly *woke,
somewhere; was turned away from somewhere; went to bed*. That is the fork
budget again, reported rather than papered over: the honesty rule is doing its
job and there is almost nothing honest to say. Slice 6 does not fix it and
neither does looser wording; more kinds of thing happening does.

### Slice 6: the Towne Publication — breadth — **built**

One page a day. Sections, each omitted when empty:

- **Dateline** — the village name and the date, from the calendar.
- **The day in review** — the highest-scoring public events, grouped by kind and
  written in the third person, with names from the cast.
- **The village at a glance** — people, households, places, how many were abed
  at midnight, how many journeys were made, how many were refused. Real counts
  from real events.
- **Colophon** — what this paper cannot yet tell you, and which phase brings it:
  classifieds with the economy, continuing stories with relationships, a named
  author when somebody in Pennycroft can read, provenance when there is memory.

Tests: every number in "at a glance" is derivable from the day's events and is
recomputed by the test independently; a day with no public events produces a
paper with the review section absent, not an empty heading; the paper never
names an entity absent from the cast.

**Built.** `packages/chronicle/src/paper.ts` writes the page;
`packages/chronicle/src/wording.ts` was extracted out of `post.ts` first, so the
blog and the paper share one rule about what may be said and differ only in
voice; `data/chronicle/paper.json` holds the wording, the refusals and the
colophon; `loadPaper` in `apps/simulator/src/data.ts` reads it. Twenty-eight
unit tests and twenty-one over thirty real days. A twenty-nine-mutant sweep over
the renderer and the paper leaves no survivors.

**"Public events" was the wrong axis, and measurement is what said so.** The
plan above asks for "the highest-scoring **public** events", meaning events at a
location anybody may walk into. Measured against thirty real days, that filter
keeps exactly one kind of story — somebody turned back from a full door — and
throws away the two most consequential things the world has ever produced: the
village being founded, and twenty-four households taking their cottages, both of
which happen indoors. A household founding is a public fact in a private room; a
villager crossing the green is a private nothing in the open. So the rule became
the blog's rule plus an explicit refusal: printable if the wording file has words
for the type (editorial judgement, in the file where it can be read and changed),
ordered by score, minus a `neverPrint` list that names the four kinds the paper
will not carry whatever they score — waking, turning in, going to bed, failing to
rest. That list is enforced twice on purpose: the schema rejects a book that
carries wording for a listed type, and the page skips the type anyway. The first
is a promise about the file, the second a promise about the page.

**Who writes it: nobody, and the colophon says so.** A post has an author and
therefore has to pass the presence test in `witness.ts`. The paper has no author,
so there is no person whose knowledge it could exceed — it is the record
speaking, the way a parish register speaks. That is why directive 5 does not
apply to it, and why the colophon states the absence rather than inventing a
byline. The day Pennycroft contains somebody who can read and write, the paper
acquires an author and inherits the presence rule with them. The paper's
vocabulary is also missing `{me}`, `{first}` and `{others}`, so a first-person
phrase lifted out of `templates.json` and pasted into `paper.json` does not
render badly — it never fits, and the reachability test reports it as dead.

**Households are not countable yet, so the paper counts families.** `at a glance`
asks for households. `PersonRecord.family` is a family *slug*: two Netherby
houses both read `netherby`, so a household count off the record would be wrong
by however many families have split. The page prints `families`, the colophon
says which it is, and the number becomes households when households become
identified things.

**One deviation from the plan's test, and a tripwire instead of an apology.**
"Every number in at a glance is derivable from the day's events" holds for three
of the six — abed, journeys, refusals — and cannot hold for the other three.
Oakhanger Wood exists on a day nobody walks into it, so `places` has to be read
off the register, and the register is append-only and holds the village as of the
last day distilled into it. A page written the day it happens is exactly right; a
page **rebuilt** years later would credit the founding day with everybody born
since. Today the two agree, because worldgen creates all eighty-six people and
all thirty-eight places on day one and nothing has been created since — a fact
about the simulation, not a property of the paper. So a test asserts that fact
directly: no person and no place comes into existence after the founding day. The
first birth turns it red, and that is the day the glance needs a register scoped
to the day.

**A story cites one event, because that is all its sentence answers for.** The
first version grouped the day's leading events by kind and cited all of them
under one sentence. The sentence names a person, though, and it is a sentence
about *that* refusal at *that* door; a second event underneath it claims support
the wording has not got. So a story carries the lead event and a count of the
others, and the count is checked against the day.

**Three survivors and one bad mutation.** The first sweep left four. Three were
weak tests, all of them for the same reason — Pennycroft is too regular to
distinguish the readings. Nobody here wakes twice in a day, so first-waking and
last-waking give the same answer on every real day; `place.created` carries a
`place` field that agrees with the event's own location, so a payload overruling
the caller's vocabulary is invisible; and the founding day runs three stories
where every other day runs one, so it draws three times from the wording stream
and lands somewhere different however the stream is named — enough on its own to
make a month of identically worded pages look varied. Each needed a case the
village does not produce. The fourth was a bad mutation, not a weak test: keying
the story group by event id also changed the string the wording is looked up
under, so the mutant found words for nothing and printed the same page. It was
re-pointed at code that actually emits the duplicate stories.

**What thirty real days of `world-zero` produce.** Thirty papers. The founding
day runs three stories — the village opening, a household taking its cottage, a
refusal at the smithy. Every other day runs one, and it is always the smithy:
capacity six, occupied six, sixteen villagers turned away. The glance reads 86
souls, 20 families, 38 places, 86 abed, 156 journeys, 16 refused. Seven colophon
lines, five of which name a thing the paper cannot do and the phase that fixes
it. That is a thin paper, and it is thin for the reason §7 already gives: almost
nothing happens in Pennycroft yet. The press is not the bottleneck.

### Slice 7: `apps/press` and the public link — **built**

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
   `data/chronicle/publication.json`. **The wall clock is read here and nowhere
   else.** It is an input to the publisher, exactly like `--days` typed by hand;
   no simulation code ever sees it.
3. Run the village forward that many days from the seed, archiving as it goes.
4. If `frozenThrough` is set, compare the regenerated days against the committed
   manifest and **fail on any mismatch**. This is the freeze.
5. Build the site and deploy to Pages.

Regenerating the whole history on every publish is the simple choice and it
keeps the repository free of generated state. It is also linear in the age of
the world, so the first thing slice 7 measures is how long a year takes. If it
grows uncomfortable, the fallback is to commit the archive and the save and run
only the new day — the manifest already makes that safe, because a committed day
hash proves the resumed world matches the regenerated one. That fallback is not
built until the number says it is needed.

`data/chronicle/publication.json` is new: the masthead, the first village day, the
real date of first publication, and `frozenThrough` (null until launch).

Tests: the site builds into a temp directory and every internal link resolves; a
day page contains the paper and that day's posts and nothing from another day;
the scan for machine facts passes; building twice produces byte-identical
output; a deliberately mutated past day fails the frozen-manifest check.

**Built.** `apps/press` is a workspace of its own: `html.ts` (escaping, elements,
the document, responsive `<picture>`), `publication.ts` (the wording file's
schema, and saying a village day out loud), `schedule.ts` (how long to run the
village today), `freeze.ts` (the frozen history), `data.ts`, `issue.ts`,
`site.ts`, `cli.ts` and seven page modules under `src/pages/`.
`data/chronicle/publication.json` holds every sentence the site says in its own
voice; `assets/site/` holds the stylesheet, the seal, nine illustrations at two
widths each, and 280 portraits. Thirty days of `world-zero` print 155 pages and
copy 300 assets — about seven megabytes — with no client-side JavaScript, no
fonts, and nothing fetched from another domain. 146 tests over seven files, and
`packages/sim-core/test/determinism-guard.test.ts` now scans `apps/press/src`
alongside the simulation.

**The output tree is not the one sketched above, because a paper and a blog are
two different reads.** The plan proposed `days/<date>.html`, one page per day
carrying both. In practice a reader arrives wanting either the news or the
people, never an interleaving of the two, so the day splits into
`paper/<date>.html` and `blog/<date>.html`, each with its own `index.html` and
`archive.html`. Three pages the plan did not list were added for the same
reason: `towne.html` and `map.html`, because the village is a place and a reader
asks where before they ask what; and `people/<slug>.html`, because the blog
names eighty-six people and a name that is not a link is a dead end. That is
where the page count comes from — four landing pages, four for the paper and the
blog, sixty issue pages, and eighty-seven for the roll and the people on it.

**`days = today − firstPublished` was wrong by a month.** The site opens with
the village's first thirty days already behind it, so the plan's arithmetic
would have published a one-day archive on launch morning and grown from there,
deleting twenty-nine days readers had been given. `publication.json` gained
`daysAtFirstPublished`, and the count is that plus the days elapsed. The
arithmetic lives in `schedule.ts` as integer maths on two Gregorian dates rather
than in the workflow's shell, which is what makes it testable: the schedule is
checked against `Date` as an independent oracle over every day from 1970 to
2069, and against the century rule on both sides of it — 1900 was not a leap
year, 2000 was, and a schedule that gets that wrong is wrong by a day for a
hundred years. A date before `firstPublished` is refused rather than clamped,
because a clock that has gone backwards is a fault to report, not a length to
run.

**The wall clock is read once, in `date -u +%F`, and never again.** The workflow
hands that string to `press days`, which prints a number and nothing else
because a shell substitution is reading it. Nothing downstream of that number
sees a date: `press days` requires `--today` rather than defaulting to the
clock, so the press stays a pure function of its inputs instead of being
reproducible right up until midnight.

**The press is the second reproducible thing, so it is guarded like the first.**
A `new Date` in a page builder would put the real world's date on a page about
the village, and a site built twice on two different afternoons would differ. So
`REPRODUCIBLE_SOURCES` in the determinism guard now lists `apps/press/src`
beside `packages/chronicle/src`, and a test names both directories explicitly —
a scan that silently covers nothing is a guard that silently passes, and a
mistyped path would fail no other test in that file.

**The freeze became a check that has to fail correctly, not merely pass.** The
plan asked for a comparison against the committed manifest. The comparison is
the easy half. The hard half is that the same code can pass while guarding
nothing: a freeze set with no hashes committed behind it, hashes left behind
after a freeze is lifted, a published day absent from the file, a day archived
without a hash. Each of those is now its own failure with its own message, and
most of `frozen-history.test.ts` is about them rather than about the happy path.
A green tick over an unguarded archive is worse than no tick at all. The hashes
live in `data/chronicle/frozen.json`, written once by `press freeze --write`
rather than copied by hand, because thirty hashes typed by a human is thirty
chances to produce a file that fails every publish from then on with a message
saying history was rewritten — the least helpful possible way to learn about a
typo. There is no override flag, and that is deliberate: either the change is
wrong and belongs reverted, or the archive is wrong and a person decides what to
do, and neither is a decision a nightly job should make at four in the morning.

**A year takes seventeen seconds, so the fallback is not built.** The plan said
the first thing slice 7 measures is how long a year takes, and the answer for
three hundred and sixty days of `world-zero` is 12.2 seconds to run, 2.1 to
distil and 3.2 to print: 815 pages and thirteen megabytes of site off a
ninety-eight megabyte archive that is never committed. Ten years would be under
three minutes. Regenerating the whole history on every publish stays the right
choice, and committing the archive to run only the new day stays unbuilt. The
number to watch is not the runtime but the annals, which reach 468 KB after a
year — four years or so from the 2 MB mark that triggers the collapse pass.

**The leak scan proves the constraint against the output, not the intention.**
CHRONICLE.md section 4 is a promise about generated files, so the test reads
every generated file: all 155 pages plus the stylesheet, searching for the
repository path, the home directory, the temp directory, `node_modules`, a
Windows drive letter, anything shaped like an email address, and every value of
eight characters or more in `process.env`. It then asserts that it looked at
more than twenty files and that HTML and CSS were among them, because a scan
whose glob has drifted passes silently. The seed is the one permitted machine
word — it is a fact about the world — and its presence on the about page is
asserted, so the exception is visible rather than accidental.

**Twenty-six mutations, twenty-six deaths, and two of them took a second sweep.**
The sweep breaks the generator one thing at a time — drop the ampersand from the
escape table, print `families` where `places` belongs, flatten the `../` prefix
on links, stop emptying the output directory, drop `.nojekyll`, make the freeze
exclusive of its own last day, move the rota push below the `continue`, mark
every nav link current, use a truncating modulo for pre-epoch weekdays, cite
`§(id + 1)`, let cottages onto the map legend, accept a section naming an
illustration nobody shipped, put the short dateline on the page, pad a quiet
day's review, accept an unfinished run, drop the skipped-leap-century term from
the date arithmetic, forget the launch archive in the day count, accept a clock
that has gone backwards, pass a rewritten hash, pass a lifted freeze that left
its hashes behind, pass a freeze with no hashes behind it, stop noticing a
published day nobody froze, freeze days past the freeze date, decorate the bare
day count — and confirms a test goes red. The nine for the schedule and the
freeze died on the first sweep. The seventeen for the generator left two
survivors.

The first was moving `published.push` below the `continue` in `issue.ts`, which
should have broken the rota and broke nothing. Two causes, and the second was
worse than the first. `frozenThrough` can only ever hold back a *suffix* of
days, so under the shipped rule no published day is ever preceded by a held one
and the ordering cannot be observed from outside at all; and the test that
claimed to check it was outright vacuous, re-reading the open village and
comparing it to itself. The fix is a test-only `Holed extends Publication` that
holds back a day in the *middle* and publishes the rest, which makes the gap
observable and kills the mutation. That is the only test in the suite that
reaches past the shipped rule, and it says so in its own doc comment, because
the invariant is the kind that rots: a second reason to skip a day, added years
from now, would break the rota silently and every page would still look
internally consistent.

The second was `§(id + 1)`, which died on the first sweep by luck and lived on
the second. Event ids run in sequence within a day, so an off-by-one usually
lands on another real event — and the test only asked whether each cited id
existed. It now compares the exact per-story and per-post-line source lists
against what the chronicle handed the page, id for id, with the existence check
kept separately as an honesty check.

**Two more mutations were dropped as equivalent mutants, and the reason is
recorded so nobody re-derives it.** Taking the welcome page's figures from the
first issue instead of the newest changes nothing, because every day of Phase 1
produces an identical `Glance` — 86 souls, 20 families, 38 places, 86 abed, 156
journeys, 16 refused, every day, since nobody is born, nobody dies and everybody
walks the same round. Slicing a citation list down to its first id changes
nothing either, because every story and every post line currently rests on
exactly one event. Both are real mutations the day somebody is born, and the
site test carries a comment saying which of its assertions are weaker than they
read for this reason.

**One content hazard, investigated and left standing.** The illustrations were
drawn before the village had a tavern name, and they do not agree with each
other about it. Three pictures name the building three ways: `map.webp` labels
it The Ploughshare, `window.webp` hangs a sign reading "The Hare & Mug", and
`quarrel.webp` hangs one reading "The Stag & Muddler". One of those is right by
accident.

The village file keeps The Ploughshare, and the deciding argument is the map.
It is the only illustration the site treats as a document rather than as
decoration: `map.html` prints it beside a table of the very place names it
labels, so a disagreement there is a disagreement a reader can see in one
glance, inches apart. The two signs are background detail in pictures whose
captions are about something else. "Muddler" is no help either way -- it is not
a word for anything a medieval village had, and is the kind of almost-word that
generated artwork produces.

So two illustrations disagree with the record, which is recorded here rather
than hidden: no caption quotes sign text, nothing the site *says* is false, and
the remaining fix is to those two images and not to the world. Moving the world
instead was considered and rejected, and the cost of rejecting it is worth
naming: a building's name is worldgen input, so renaming the tavern changes
every day hash after it. Today that is free because nothing is frozen. Once the
archive is published it is exactly the change the freeze exists to refuse, which
makes "agree with the pictures before launch, or never" the real deadline on
this note.

**The site was then read as a site, which found twenty faults no test was going
to.** Every page was photographed in headless Chrome at 1100px and again
at 390px and read. That is worth saying plainly, because the suite was green the
whole time: every defect below is well-formed markup carrying true statements,
and a page can be right in every particular and still read as unmade.

Six were layout. An `.illustrated` section is a two-column grid and a grid lays
out its own children, so a section holding a heading, two paragraphs and a
figure filled the columns in reading order and left a hole under the heading --
fixed in the markup, because no stylesheet can fix it, and now guarded by a test
that counts an illustrated section's children. Plates were declared at one width
beside prose measured at another. The mill appeared twice on one page. A
full-width picture was upscaled past its own pixels, and one page jumped as its
images arrived. And the archive's dates were a ragged left-hand column, because
a date is a link and a link is as wide as its own words -- so the notes beside
them started in a different place on every row. The column is now held to the
width of the longest label there can be, which was measured rather than guessed:
`Greenreach 30` sets at 111.1px, so `7.5rem` clears it and nothing wider exists.

Six were the record spoken badly. `7, child female` stood under a child's name,
which is a sex field and an art-direction band printed raw: the age bands exist
so a drawn face can be matched to an age, not so a reader can be told one, and
the two are now read together into a noun. `0, a boy` under a photograph of a
baby reads as a form somebody forgot to finish, so the one age not printed as a
number is the first one. A persona's `habits` are stored split on their commas
and were set out as bullets, so one sentence appeared as its own halves; they
are joined back into the sentence they were written as. A page printed its own
file name, which is a fact about the website and not about the person. The paper
credited an author's note to four babies. And `--` was reaching the page as two
hyphens.

**The largest was two different ages on fifty-seven of eighty-six pages.** Every
persona was written against a drawn face, so every `look` line ended by saying
how old the face looked -- `Red braids, freckles, eyes wide and guileless.
Eight.` The record says it too, worked out from a birth date on the newest
published day, and it said `7, a girl` two inches above. Directive 12 settles
which one gives way: the record is authoritative and the persona book is
advisory. Sixty-two lines had the trailing age struck out mechanically and
twenty-four were rewritten by hand, plus two ages found hiding in `voice` and
`tell`. The disagreement was not stable, either -- the village ages a day per
real day and a sentence in a JSON file does not -- so it was going to reach all
eighty-six pages and then keep going.

The guard against its return does not simply ban number words, because counts
survive: `Four sons.`, `three teeth` and `one eyebrow up` are facts about a
person that do not rot. Two things separate a count from an age. A count in this
book is always small, so any number from thirteen up is an age wherever it sits,
which catches `Forty-two, always at the water` and would catch it woven into the
middle of a sentence. Below thirteen the two look alike, so what is banned there
is the shapes only an age is written in: a number opening a sentence, a number
handed to `and`, the spelled-out `four years old`, and a comparison against one,
which is where `much older than seven` was hiding. Eight mutants, eight deaths.

**One fault was in a seam, and it had printed eighty-five times.** The record
names a place as a whole noun phrase, article and all -- `A cottage on Bridge
Row`, `The Mill` -- because that is what a heading and a table row want, and it
is what the record itself calls the place. Dropped into a wording the name
arrived with the capital it was stored with, and the site published `Abed at A
cottage on Bridge Row.` and `Heading back to A cottage on Bridge Row.` Every one
of those was a true sentence about a real event, which is exactly why nothing
caught it.

It is fixed at the substitution seam in `render` rather than in the three
templates or in the data, so `{place}`, `{home}`, `{dwelling}` and every
placeholder added later are covered by one rule: the article is lowered, only
the article, and only where the name is not opening a sentence. `{place}. Warm
enough.` keeps its capital, because there the name *is* the sentence. Seven
mutants, seven deaths.

The lowering half is exported, which is not tidiness. The simulator's guard
against the paper naming somebody the event never involved strikes known names
out of a story longest-first, and a guard that knew only the record's spelling
would find no `A cottage on Mill Lane` inside `Abed at a cottage on Mill Lane`,
match the shorter `Mill Lane` sitting inside it, and then accuse the paper of
naming a place the event never involved. A name now has two spellings and both
answer to the same place.

**The site-wide scan for that shape then found two more of it, typed by hand.**
`Market day on The Green.` in a caption and `Walking from The Green to Mill
Lane` in a page description -- the same fault arriving by the other route, which
is the argument for scanning finished pages and not only the seam. The scan
reads text runs and `alt` and `content` attributes, excuses a title the village
gave something, and checks its own shape against the five sentences that
prompted it before it is turned on the site. A scan like that is a trap and not
an assertion: on a clean site, narrowing it to half of what it should catch
changes nothing, so nothing else would ever notice. Eleven mutants, and the two
that survived were both the scan failing to prove it had read anything -- one
half of it reading no attribute at all, and the shape narrowed to a single
article. Both are dead now, the first by counting alt text and page descriptions
apart, the second by those five sentences.

**Two lists were not lists, and one rule was separating nothing.** `.stack` put
a border under every row including the last, where it has nothing to separate:
it then reads as the bottom edge of the section, except that a list is held to
`--column` and a section rule runs the full `--page`, so it was a short line
floating a third of the way in, an inch above the long one that really does
close the section. `The same day in the paper` was a heading above a single
ruled row, which is the shape of a table that lost the rest of itself. And `Read
the day on the blog` was the sixth row of a list of five villagers, ruled and
indented exactly like a name -- and that list is a roster, so anything standing
in it is claiming to be somebody.

**The last fault was created by fixing one of those, and it is the reason the
suite gained a test it did not have.** Moving that link out of the roster,
`el('p', el('a', ...))` handed a finished anchor to the helper that escapes its
content -- which is there so a village naming a place `The Hare & Mug` cannot
open a hole in a page, and which did exactly what it promises: it printed the
link, correctly escaped, as the visible sentence `<a
href="../blog/1200-04-30.html">Read the day on the blog</a>`. Nothing in 1118
tests saw it. The markup was well-formed, every tag closed, the stray-bracket
test found `&lt;` rather than `<`, and the link checker had no link to check
because there was no longer a link. It is wrong only to a reader, so it is now
caught by reading: an escaped angle bracket with a tag name behind it is markup
that should not have become words.

**None of this moved the world.** The archive rebuilds to `fc238578b5964a64`
after all of it, which is the proof that the persona rewrite, the seam and the
stylesheet are press-side changes and nothing else. One golden hash did move and
had to: `posts.test.ts` pins the printed text of an ordinary day, the seam
changed that text, and the pin is re-set in the same commit with the reason
written beside it.

---

### Slice 8: who may write, and who is spoken for — **built**

Nobody under ten writes a post. What a young child did still reaches the site,
in a parent's words, on a roll of the dice.

**The rule exists because the scoring was working.** `score.ts` ranks a day by
how unusual it is, and a five-month-old being carried somewhere is unusual, so
Walter Webb — who cannot hold up his own head — had six posts on the site,
written in the first person, with a byline and a portrait. A quarter of the
village is under ten. The About page says in plain words that nobody in
Pennycroft can read or write yet, which made every one of those posts a small
lie printed next to a picture of a baby.

**An age, not a literacy flag.** There is no literacy in the simulation to read,
and inventing one inside the press would be the press making up world state,
which is the one thing §4 forbids it. An age is a birth fact the record already
holds. Ten is in `data/chronicle/selection.json` as `writingAge`, per directive
10, and zero is a legitimate setting that returns the site to what it published
before.

**The gate is applied before the ranking, not after.** `rankCandidates` drops a
child while it is still building the candidate list. Filtering the finished list
would have been the obvious place and it is the wrong one: on a day whose most
newsworthy hour belonged to a six-year-old, a rota asked for five posts would
have published four and left a hole. There is a test that can tell those two
apart — three children holding the day's top three moments, five adults behind
them, and the page has to come out with five names on it.

**`Kinfolk`: parentage learned forwards, never looked up backwards.** The press
needs to know whose child is whose, and the annals know — but reading it from
the annals would let a post rest on something the village had not yet found out.
So `kin.ts` accumulates as the days are read, one `society.parentage-recorded`
event at a time, in the same loop and for the same reason the rota reads only
days already published. A rebuild from an empty directory reproduces the same
parentage the original build had on the same morning. Absent parents are
skipped, pairs are deduped, and a record naming somebody their own parent
throws rather than being quietly tolerated.

**The roll comes out of a stream of its own.** Determinism rule 6, and here it
earns its keep twice over. Drawing from the post's own generator would interleave
two questions, so every wording chosen after the roll would shift and a village
that gained a child would rewrite a stranger's post. Re-seeding under the post's
*own* stream name would be subtler and no better: the roll would land on the same
number that chose the writer's opening line, and whether a mother mentioned her
daughter would be settled by how she happened to phrase getting out of bed.
`kin:<day>:<slug>` is its own question.

**The moment is chosen before the roll**, which is backwards — a cheap question
after an expensive one — and deliberate. The stream is per post, so a roll taken
unconditionally would also be taken for the childless, come out the same for
everybody it was wasted on, and never show up as a bug. It would just quietly
mean something narrower than what the config says.

**A separate book, because a parent is not a ventriloquist.**
`templates.json` gained a `family` section whose wording answers `{child}`,
`{childFirst}`, `{place}` and `{destination}` and cannot answer `{me}` or
`{first}` at all. Ten variants over four event types. A test drives every one of
them against a real pair out of the real village and fails on any placeholder
that comes back unfilled, which is how a first-person wording that slipped into
the wrong book would be caught before a reader met a three-year-old narrating.

**Measured, not guessed.** Thirty days of `world-zero`: 86 people, 24 of them
under ten, 22 adults with an under-ten child. The only things those children do
that anybody has wording for are waking (720), turning in (720), going to bed
(720) and being turned back from somewhere full (178). At `mentionsChild: 50`
that produces 150 posts, of which 53 were written by somebody with a young child
who had done something, of which 30 ended with a line about that child. So a
fifth of the blog carries a child's day, 16 of the 30 days have at least one,
and none of them is all nursery. The rate test divides by the 53 and not the
150, because the dial is a property of the posts it applies to; counting against
every post would fold in how often the rota happens to pick a parent and would
move whenever worldgen did.

**The existing golden hash could not see the feature.** `posts.test.ts` pins the
printed text of the second of Blossom, and that pin did not move when the family
lines shipped, because on that day nobody's roll came up — an ordinary day is
exactly the day this feature is invisible on. A second pin now sits beside it on
the fifth of Blossom, which carries three mentions, with an assertion on that
count so the pin cannot silently become vacuous. `printed()` also now includes
`about:<id>`, so both hashes cover which child a line is credited to and not only
what it says.

**A check was removed for being unable to fail.** `bestOfTheChildren` asked
`whereabouts.saw(child.id, event)` about events it had just got from
`day.byActor(child.id)` — and `saw` returns true immediately for anybody in
`event.actors`, which is the index `byActor` is built from. It read as a safety
check and was a tautology. The presence claim is still made good, but by the
line carrying `about` and by the site's honesty test putting that id through
`saw` for real, against a real day.

**One mutant survived, and the answer was structural.** Swapping the two numbers
in the press's household object — an age of fifty and a one-in-ten chance — ran
green across 1118 tests, because the rota reads `writingAge` straight off the
config and never noticed, and nothing looked at the other end. An extra
assertion would have patched the symptom. `householdVoice(kin, selection)` in
`post.ts` removes the place where the mistake could be made: the press and the
test that checks thirty real days now both build the object through it, and a
unit test that can tell 10 from 50 stands behind it.

**Twenty mutants, no survivors.** The age gate deleted, off by one, and moved
after the ranking; the roll deleted, always failing, and read as a fraction
already; `about` dropped; the child's own age gate deleted; the shared RNG
stream; `{me}` made answerable in a family line; the child's first moment taken
instead of their best; a full name used as a first name; the mention pushed to
the front of the post; absent parents recorded; the dedupe removed; parentage
read off every event type; `kin.learn` removed from the press; the two dials
swapped; a parent filed under their child; and the mention citing the wrong
event. Fourteen died to the unit tests, the rest to thirty days of the real
village.

**The world did not move.** `npm run verify` still reports `fc238578b5964a64`
and 26 invariants at tick 10368000, which is the proof that all of this is
press-side. 1158 tests.

---

## 4. Invariants

New invariants and checks, in the spirit of sim-core rule 11:

1. Every archived event round-trips: parsing a written line yields a value
   deep-equal to the event that was written.
2. The manifest and the filesystem agree: every day listed exists, every day
   present is listed.
3. Every entity id printed by the chronicle appears in that day's cast.
4. Every claim in a post traces to an event id, and that event passes the
   presence test of whoever the claim is about -- the author, or, for a line a
   parent writes about a child, the child it names.
5. Once `frozenThrough` is set, the state hash of every day at or before it is
   fixed. A build that computes a different one fails.
6. Every annal line's id resolves to an event in the archived day it names. A
   line that cannot be traced is not a memory, it is an assertion.
7. The annals are append-only. Distilling a day again appends nothing and
   changes no byte already written. The one exception is the collapse pass,
   which rewrites a whole year once and records that it did.
8. Nobody below the writing age carries a byline, and a line written about
   somebody else names a child of the author's own who is below it. Checked on
   the rota, on the finished posts, and on the published pages.

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
| An annal line names an event the day does not contain | Throw; the memory is wrong, not the archive |
| A distilled day is already in the annals | Append nothing; succeed silently |
| An event type has no weight in `significance.json` | Throw, naming the type; never default it to zero |
| The simulation fails `npm run check` | Do not publish |

## 6. Risks

- **The paper is boring.** This is the expected outcome of a village with no
  hunger, work, money or relationships, and it is the *point* of building it
  now: it sets the baseline every later system is judged against. The risk is
  reacting to it by adding invention to the chronicle instead of depth to the
  simulation. The governing rule exists to make that reaction impossible.
- **Rebuild time grows with the archive.** Measured in slice 7 and not a problem
  yet: a full simulated year is 12.2 seconds to run, 2.1 to distil and 3.2 to
  print, so ten years would be under three minutes. The fallback is written down
  above so it does not have to be invented under pressure rather than because it
  is needed.
- **The presence proxy quietly becomes permanent.** It is a compromise with a
  named expiry: Phase 5 replaces it with memory and provenance. It is stated in
  the paper's own colophon so that the compromise is visible to readers, not
  just to this document.
- **Publishing something that should not be published.** Mitigated by a scan
  that runs in CI and fails the build, rather than by remembering.

## 7. What comes immediately after

**Memory that changes behaviour.** Slice 3 gives the village a record of what
mattered; it does not yet give Agnes Hargrave a reason to act on it. The next
step is a small, capped, saved set of marks per villager — `(day, what, who,
weight)`, fading with time, evicted by weight — formed by an `npc.remembered`
event so that no villager can know something they did not live through
(Directive 5, and "no knowledge without provenance"). Behaviour then comes from
a mark shifting a need's threshold, never from a script: she stockpiles because
scarcity moved what "enough" means to her, which is Directive 9. It is held back
to its own slice because it changes how every villager acts and therefore resets
every golden hash in the project, and because the record it reads has to exist
first.

**The fork budget, and why it is the real constraint.** Before any of that lands,
one number has to be understood, because getting it wrong wastes the whole
personality layer.

A trait cannot create behaviour. It can only choose between branches at a fork
that already exists. There are twelve traits scored 0-100, which is about 10^24
distinct personalities -- more than enough for a thousand villagers, let alone
eighty-six. But nothing in the codebase reads a trait value to decide anything,
and the village currently passes through roughly **one** real fork in a day:
when to turn in, and whether rest was possible. Twelve traits arguing over one
fork produces one visible difference between two people. The scarce resource is
not personality. It is decision points.

    outcomes  ~=  forks per day  x  branches per fork

So the rule from here on: **every system that lands must declare the forks it
adds**, and a system that adds state without adding a fork has made the world
bigger without making it more legible. The target is deliberately large -- dozens
of forks reachable in an ordinary day, not three. A villager who faces three
decisions a day has an invisible personality no matter how finely it is scored,
and a blog written about them reads as weather.

**Three forks are wired and unreachable, which is the cheapest fork work
available.** Slice 5's coverage test had to be told which event types the
simulation can actually produce, and found three that exist in code and fire
zero times in thirty days: `npc.could-not-rest` (nobody's house is ever full
when they turn in), an interrupted turn-in with its `travel.blocked` carrying
`reason: 'bedtime'` (nobody is ever caught far enough from home for the walk to
be cut short), and `npc.removed` (nothing kills anybody yet). The first two are
already-built forks that the world's parameters never reach — a village with
tighter dwellings, or errands that take somebody further out, would reach both
without a line of new branching code. They have no post wording until they can
happen, which is why they are listed here rather than left as a curiosity.

What counts as a fork is strict: a real choice with a real cost. "Does she go to
the alehouse" is a fork, because going means not being home when the child wakes.
"Does she feel sociable" is not a fork; it is a die roll wearing a trait's name,
and it is the same mistake NPC_MODEL.md warns about when it forbids
`propensityToSteal`.

Where the twelve stand today, audited against what actually exists:

| Trait | Fork it would read | Blocked on |
| --- | --- | --- |
| `sociability` | where the evening is spent: home, the green, The Ploughshare | nothing — buildable now |
| `curiosity` | whether an odd thing two streets over is worth the walk | nothing — buildable now |
| `religiosity` | whether the bell is answered | nothing — buildable now |
| `conscientiousness` | whether a plan survives a nicer alternative | a goal system |
| `impulsiveness` | whether the first idea is the one acted on | a goal system |
| `empathy` | whether another's distress becomes your problem | the needs system |
| `workEthic` | whether work is done because it is there | Phase 3 |
| `generosity` | whether what you have is shared | Phase 3 (inventory) |
| `ambition` | whether your present station is acceptable | Phase 3 |
| `honesty` | whether you say the true thing when a lie would serve | Phase 5 |
| `stubbornness` | whether a position, once taken, is given up | Phase 5 |
| `courage` | whether fear stops you | Phase 6 |

Three of the twelve have somewhere to bite today; the village already has a
church, an alehouse, a green, a mill, a smithy, a common field, a pasture, a wood
and a stream, with travel time between them. Nine are waiting on systems that do
not exist. That ratio is the plan: **build forks, not traits.** A thirteenth
trait is only earned when a fork is being built and two people who should
obviously differ score the same on everything that fork reads.

This changes two things about how later slices are written. Each states the forks
it adds in its own section, with the branches and the cost of each. And every
phase exit criterion from Phase 2 on carries a measured number alongside the
correctness checks: **forks per villager per day**, counted from the archive. It
is the one figure that says whether the world got more interesting or merely
larger.

Then Phase 2 — survival — which is the first system that gives a villager something
to want and therefore gives the paper something to report. The order was set by
[PHASE_1.md](PHASE_1.md) section 5 and has not changed: build the reader first,
so every later system arrives with a way to tell whether it made the world more
interesting.
