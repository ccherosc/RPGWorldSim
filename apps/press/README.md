# @rpgsim/press

Turns the village's record into a website. Reads two directories and `data/`,
writes HTML. Nothing else.

It is an app rather than a package because the simulator must never acquire a
dependency on HTML. The arrow points one way: the press imports the chronicle,
the chronicle does not know the press exists.

**Status: slice 7 complete.** Thirty days of `world-zero` print 155 pages and
copy 300 assets, about seven megabytes, with no client-side JavaScript and
nothing fetched from another domain.

## Using it

```bash
npm run press -- build --archive ./history --annals ./memory --out ./site
npm run press -- days   --today 2026-09-18      # how many village days exist
npm run press -- freeze --archive ./history     # has a published day changed?
npm run press -- help
```

`build` is the third step of publishing, and the first two have to have run:

```bash
npm run sim   -- run    --seed world-zero --days 30 --archive ./history
npm run sim   -- annals --archive ./history --annals ./memory
npm run press -- build  --archive ./history --annals ./memory --out ./site
```

Three commands rather than one because each writes something worth keeping on
its own, and because rebuilding the site when a paragraph changes must never
mean re-simulating the village.

```
The Pennycroft Chronicle
  days       1200-04-01 to 1200-04-30
  seed       world-zero
  people     86
  pages      155
  assets     300
  written to ./site
```

| Option | Means |
| --- | --- |
| `--archive <path>` | the day archive written by `sim run --archive` |
| `--annals <path>` | the record written by `sim annals --annals` |
| `--out <path>` | where the site is written; emptied first (default `./site`) |
| `--data <path>` | override the data directory |
| `--assets <path>` | override the asset directory (default `assets/site`) |
| `--allow-incomplete` | publish from a run that never finished |
| `--today <date>` | real-world date, `YYYY-MM-DD`, for `days` |
| `--write` | have `freeze` write the hashes instead of checking them |

## What it writes

```
site/
  index.html          the welcome page: the hero, today's figures, today's stories
  towne.html          every place in the village, by kind
  map.html            the map, full size, with a legend off the register
  about.html          how the village works, and what the site cannot yet tell you
  paper/
    index.html        today's issue
    archive.html      every issue, newest first
    <date>.html       one issue per published day
  blog/
    index.html        today's posts
    archive.html      every day the villagers have written
    <date>.html       one day of posts per published day
  people/
    index.html        the roll: everybody, with their face and their age
    <slug>.html       one page per person
  assets/
    style.css  seal.svg  images/*.webp  faces/*.webp
  .nojekyll
```

The output is emptied before it is written. A page renamed in the generator
would otherwise stay on the site for ever, and a stale page is indistinguishable
from a current one to a reader.

## Nine decisions worth knowing before reading the code

**1. The site is a pure function of the archive, the record and `data/`.** No
clock, no RNG, no world state, nothing about the machine. `apps/press/src` is
scanned by `packages/sim-core/test/determinism-guard.test.ts` alongside the
simulation, so a `new Date` in a page builder fails the suite. Building twice
produces byte-identical files, and a test asserts it.

**2. It publishes world state and nothing else.** CHRONICLE.md section 4. A test
reads every text file on the generated site and searches for the repository
path, the home directory, the temp directory, `node_modules`, a Windows drive
letter, anything shaped like an email address, and every value of eight
characters or more in `process.env` — and it asserts that the scan covered more
than twenty files, because a scan that silently covers nothing is a check that
silently passes. The seed is deliberately allowed and its presence on the about
page is asserted, so the exception is visible rather than accidental.

**3. Every sentence on the site is either a fact from the record or a line in
`data/chronicle/publication.json`.** Directive 10, for the same reason wording
lives in `templates.json`: a page should be improvable by somebody who has never
opened a TypeScript file. What the generator writes itself is furniture — a
column heading, a link's words, a line stating a count it has just worked out.
Nothing that could be *wrong about the village* is written in code, because a
sentence in code is a sentence only a programmer can correct.

**4. There is no framework, no font and no script.** Everything the browser
loads comes from the same directory. Partly so the site works offline, and
partly because a reader should not have their visit reported to a third party in
order to read about a village.

**5. The rota is built forwards, over every day the village lived.** `select`
will not choose today's writers without knowing who wrote on the days before, so
`readVillage` is a single forward pass rather than a per-day function the pages
could call. It advances the rota for every day and *then* decides whether to
publish — a day held back still takes its turn. Generating one page in isolation
would give it a different set of writers than the archive page lists, and
nothing would notice.

**6. Escaping happens at the leaves, and `tag` and `el` are different
functions.** `tag` takes markup and passes it through; `el` takes prose and
escapes it. Every attribute value is escaped, ampersand first. The village does
not yet invent a name with an angle bracket in it, so `html.test.ts` feeds the
dangerous characters in directly rather than waiting for one.

**7. Citations are exact.** Each story and each post line prints the event ids it
rests on, and the test compares the printed list against the chronicle's list
id for id — not merely that each printed id exists. An off-by-one is the reason:
event ids run in sequence within a day, so `§(id + 1)` usually lands on another
real event and survives any weaker check.

**8. The dateline is the newest *published* day, on every page.** Not the real
date, and not the newest day in the archive. `Sunsday, Blossom 30, in the year
of our Lord 1200`, identical on all 155 pages, asserted as such.

**9. The freeze is a check that has to fail correctly.** See below.

## The publishing schedule, and the one clock

The village advances one day for each day that passes out here, so something has
to know what day it is. That something is
[`.github/workflows/publish.yml`](../../.github/workflows/publish.yml), which
runs `date -u +%F` and hands the answer to `press days`. `schedule.ts` turns it
into a `--days` count with integer arithmetic on two Gregorian dates —
`daysAtFirstPublished` plus the days elapsed since `firstPublished` — and no
simulation code ever sees a clock. Because the arithmetic takes the date as an
argument, the schedule is tested over every day of a century against `Date` as
an independent oracle, without waiting for any of those days to arrive.

A date before `firstPublished` is refused rather than clamped: it means a clock
somewhere is wrong, and running the village shorter than its own published
archive would delete pages readers have already seen.

## The freeze

Every publish regenerates the whole history from the seed. That keeps generated
state out of the repository, and it has one sharp edge: a change to worldgen, to
the scheduler, or to a single balance number in `data/world/` would silently
rewrite days people have already read. The village would still be internally
consistent. It would just be a different village.

So once a day is published its world hash — `sim.hash()` at the close of the
day, covering the whole world rather than just the pages — is written into
`data/chronicle/frozen.json`, and every publish compares. A mismatch stops the
publish. There is no override flag: either the change is wrong and belongs
reverted, or the archive is wrong and a human decides what to do about it, and
neither is a decision a nightly job should make at four in the morning.

```bash
# once, at launch, after setting frozenThrough in publication.json
npm run press -- freeze --archive ./history --write
```

The awkward part is that this check could pass while checking nothing — no
hashes behind a freeze, hashes left behind after one is lifted, a day in the
file that is not in the archive. Those cases are failures too, and most of
`frozen-history.test.ts` is about them. A green tick over an unguarded archive
is worse than no tick at all.

Today `frozenThrough` is `null` and the check says so and passes. The day it is
set, the committed hashes have to be set with it.

## What is here

| File | Owns |
| --- | --- |
| `src/html.ts` | escaping, elements, the document shell, responsive `<picture>` |
| `src/publication.ts` | the wording file's schema, and saying a village day out loud |
| `src/schedule.ts` | real-world date arithmetic: how long to run the village today |
| `src/freeze.ts` | the frozen history: writing the hashes, and checking a rebuild |
| `src/data.ts` | loading `publication.json`; everything else comes via the simulator |
| `src/issue.ts` | reading an archive back as a stack of finished issues |
| `src/site.ts` | the page list, the asset copy, and writing it all out |
| `src/cli.ts` | `build`, `days`, `freeze` |
| `src/pages/shell.ts` | the furniture every page shares |
| `src/pages/*.ts` | one module per part of the site |

## Tests

`apps/press/test`, 146 tests over seven files.

| File | Asks |
| --- | --- |
| `html.test.ts` | does the escaping hold, and is the document well formed? |
| `publication.test.ts` | does the wording file's schema catch a hole in a page? |
| `schedule.test.ts` | does the day count agree with the real calendar? |
| `site.test.ts` | does it leak, do the links work, are the numbers true? |
| `published-window.test.ts` | does a held-back day stay off the site, and does the rota still advance over it? |
| `frozen-history.test.ts` | does the freeze fail when history is rewritten, and refuse to pass while guarding nothing? |
| `cli.test.ts` | are the flags parsed, and is a half-finished run refused? |

`site.test.ts` runs the real pipeline — six days of `world-zero`, distilled and
printed into a temp directory — and then asks the three questions the site has
to answer: **does it leak, do the links work, are the numbers true?** Every
internal `href`, `src` and `srcset` is resolved against the files actually
written; every page has to be linked from another page, so an orphan fails;
every figure in every "at a glance" table is recomputed independently from the
day's events; every element is checked closed with a tag stack.

Twenty-six deliberate mutations — seventeen of the generator, nine of the
schedule and the freeze — were run against this suite and all twenty-six are
caught. Two more were dropped as equivalent mutants rather
than gaps: every day of Phase 1 produces an identical `Glance`, so taking the
welcome page's figures from the first issue instead of the newest is
indistinguishable, and every story and post line currently rests on exactly one
event, so slicing a citation list to its first id changes nothing. Both become
real mutations the day somebody is born.

## Rules it inherits

Determinism rules 2 and 4 (no clock, no network) apply here as they do to
simulation code, and the determinism guard enforces them by scanning this
directory. CHRONICLE.md section 4 — the site publishes world state, never
repository state, secrets, or anything about the machine that ran it — is the
rule the leak scan exists to prove.
