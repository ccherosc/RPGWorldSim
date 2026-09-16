# The Chronicle

The long-term goal for how the world is *read*: a living publication written
from inside the simulation.

Nothing here is implemented, and none of it should be built yet. This document
exists because the goal changes decisions that are being made now — what an
event carries, what a memory is, how long history is kept — and those are far
cheaper to get right in Phase 1 than to retrofit in Phase 9.

[WORLD_ZERO_SPEC.md](WORLD_ZERO_SPEC.md) already names the Chronicler as a
read-only interpretation system. This is what it grows into.

---

## 1. The two publications

### Denizen posts

Short, frequent, first-person. Several per day, from different villagers.

> **Edric Hale, farmer, Mill Road** — *Harvestide 4*
> The rain came again and I have lost half the barley in the low field. Tomas
> says the miller will still want his share. I do not know what I will tell
> Anne.

A reader follows the world through the eyes of the people in it, and gets
attached to them. The value is not the prose — it is that the post is *true*:
Edric really did lose that barley, to weather that really happened, and he
really is short on what he owes.

### The Towne Publication

Daily, newspaper-format HTML, written by one literate villager. Longer, wider
in scope, and structured:

- the day in review — what happened publicly,
- continuing stories — the feud, the debt spiral, the failing harvest,
- what is coming — market days, festivals, weddings, the tax collector,
- **classifieds** — real villagers advertising real needs.

The classifieds are the sharpest test of whether any of this is real. "Wanted:
seed grain, will pay fair" must be there because a specific NPC has a specific
shortage and a specific goal, not because a generator thought a classified
section would be atmospheric.

## 2. The rule that governs everything here

**The Chronicle reports. It never decides.**

It is downstream of simulation state, in exactly the way the observer is
(Prime Directive 1's spirit). It may read state and history; it may not write
them. If an event was not emitted by the simulation, it did not happen and
cannot be reported. If a villager did not know something, they cannot write
about it.

That constraint is the source of the whole thing's appeal. A publication that
can invent is a fiction generator, and fiction generators are already cheap and
boring. A publication that can only report is a window.

## 3. What this demands of the simulation — and when

These are the actual design consequences, each tied to the phase that has to
honour it.

### Events must be narratable — Phase 1, now

Prime Directive 8 requires every significant state change to emit a structured
event. That is enough to *reconstruct* the world and not nearly enough to
*write* about it.

`npc:12 moved location:3 to location:7` supports the sentence "someone went
somewhere." Useless. An event needs to carry:

- **who** — actors, by id,
- **where** — the location, so a post can be datelined,
- **what changed** — typed, structured data,
- **why** — the goal or need that motivated it, and `causes` linking to the
  events that led here.

The kernel's `SimEvent` already has `actors`, `data` and `causes`. Phase 1 must
use them fully rather than treating `causes` as optional. **An event with no
cause and no actor is almost always a bug in the system that emitted it.**

### People need names — Phase 1, now

`npc:47` is unreadable. NPCs need given names, family names, and forms of
address appropriate to status; places need names. The identity layer in
[NPC_MODEL.md](NPC_MODEL.md) already calls for this; the Chronicle is why it
cannot be deferred as cosmetic.

### History must outlive the ring buffer — Phase 1/2

`EventLog` keeps a bounded window in memory, deliberately, because unbounded
event growth is a named failure mode in CLAUDE.md. But a daily paper needs the
whole day, continuing stories need weeks, and an archive needs the whole year.

So the durable history is an `EventSink` writing to disk, and the Chronicle
reads *that*, not the ring buffer. The interface already exists; the
implementation is listed as debt in [PHASE_0.md](PHASE_0.md). This requirement
promotes it from nice-to-have to necessary.

### A post is written from a memory, not from the log — Phase 5

This is the important one, and the reason the denizen blog is worth doing at
all.

Prime Directive 5: NPCs may only act on what they know. A post is an act.
Edric can only write about what Edric witnessed, was told, or believes — so a
post is generated from that NPC's **memory**, with its provenance intact
(witnessed / told by / rumour / announced / inferred), never from the global
event stream.

The consequence is the best thing this format can offer: **two villagers can
post contradictory accounts of the same event, and both be honest.** One saw
it. One heard about it third-hand from someone with a grudge. The reader gets
to work out which is which. That is not a feature anyone has to build — it
falls out of the knowledge model, provided memories are first-class persisted
entities with provenance rather than a view derived from the log.

### Classifieds are a projection of goals — Phase 3/4

An advert is a goal plus an unmet need plus the means to act. That means goals
must be inspectable structured state — which the utility AI needs anyway, since
`WHY?` has to explain them.

### The Chronicle must be reproducible — whenever it is built

The same seed must produce the same newspaper. Consequences:

- The Chronicle gets its own RNG stream (`chronicle`) so that varying prose
  never perturbs the world. It reads the simulation; the simulation must not be
  able to tell it is being read.
- **Selection is a deterministic heuristic.** With ~100 villagers and a handful
  of posts a day, something must decide who is worth hearing from. That is a
  newsworthiness score over recent events — unusual, consequential, personal,
  public — and it is ordinary simulation-adjacent code, testable like anything
  else.
- Generation must work with **no LLM at all** (Prime Directives 12 and 15).
  Templates produce a flatter but complete paper. An LLM, when present, rewrites
  an already-decided structured post into better prose; it never chooses what
  is reported, and its output is advisory per
  [.claude/rules/ai-boundaries.md](../.claude/rules/ai-boundaries.md).

A reproducible newspaper is also a superb test instrument: a diff between two
runs' papers is a human-readable diff of two world histories.

## 4. Shape, when it is built

```
packages/chronicle/      newsworthiness scoring, post selection, templates
  -> depends on sim-core (read-only) and the durable event store
  -> never imported by sim-core
apps/observer/           live inspection; shares the read model
```

Output is static HTML per day, which can be hosted anywhere and needs no
server. The pipeline is: **simulation → durable events → chronicle → static
site**, with each step runnable on its own.

Publishing has one hard rule worth stating in advance: **the site publishes
world state, never repository state, secrets, or anything about the machine
that ran it.** A generated day is a pure function of the world and the seed.

## 5. Sequencing

| Needs | Phase |
| --- | --- |
| Narratable events, names, durable history | 1–2 |
| A crude daily summary from real events | after 2 |
| Classifieds worth reading | 3 |
| Continuing stories (feuds, debt spirals) | 5–6 |
| First-person posts with honest provenance | 5 |
| LLM prose polish over structured posts | 9 |

The earliest useful version is a plain daily summary generated from the event
store — worth building as soon as there is a village, because it is the fastest
way to find out whether the simulated day is interesting. If the automatically
generated paper is boring, the simulation is boring, and no amount of prose
quality will fix that. That feedback is worth having early.
