# AI RPG Simulator

A deterministic, autonomous medieval world simulation. Villages, households,
work, weather, ecology, politics and ordinary medieval life, running on their
own, with a player who exists inside the world rather than at the centre of it.

The simulation is headless first. The observer UI and any graphics come later,
and only once the world is interesting as a stream of text.

**Current status: Phase 0 (Constitution) complete.** The kernel — time,
randomness, scheduling, events, identity, persistence — exists and is proven
deterministic. There is no village yet. See [docs/PHASE_0.md](docs/PHASE_0.md).

## Quick start

Requires Node 20.11 or newer.

```bash
npm install

npm run verify                                   # the five determinism checks
npm run check                                    # typecheck + full test suite
npm run sim -- run --seed world-zero --days 30   # run the Phase 0 probe world
npm run sim -- help
```

`npm run verify` is the one command worth knowing. It builds worlds from
scratch, runs them, saves them, reloads them and compares, and prints a pass or
fail for each of the five guarantees the project rests on.

```
determinism check: seed "world-zero", 12 probes, 30 days

  PASS  identical replay: 30 day-boundary hashes matched; final 9d98884c7511c920
  PASS  seed sensitivity: alternate seed produced a9b75f95a648c629
  PASS  save/load continuation: resumed at day 15 and matched to day 30
  PASS  saving is side-effect free: saved-then-continued world hashed 9d98884c7511c920
  PASS  invariants: 6 invariants held at tick 2592000
```

Saving and resuming a world:

```bash
npm run sim -- run    --seed alder --days 6 --save --key alder
npm run sim -- resume --seed alder --days 4 --key alder
```

The resumed world lands on exactly the state a 10-day uninterrupted run would
have reached — same hash, same events, same pending schedule. That property is
the whole point of Phase 0.

## What Phase 0 is

The kernel, and deliberately nothing else:

- a deterministic PRNG (xoshiro128\*\*) split into independent named streams,
- a simulation clock and a calendar (12 months, 30 days each, 360-day year),
- an event scheduler with a strict total order over `(tick, priority, sequence)`,
- an event bus and a bounded, causally-traceable event log,
- stable typed entity identifiers,
- versioned per-module save/load with migrations,
- and the test infrastructure that proves the above.

There is no village, no NPC, no economy, no combat, no politics, no UI and no
LLM. Those are Phases 1 and onward — see [docs/ROADMAP.md](docs/ROADMAP.md).

The `probe world` the CLI runs is a **test harness**, not World Zero. Its agents
exist to exercise scheduling, cancellation, randomness and persistence together,
and it is tuned so that its awkward paths happen often enough for tests to see
them.

## Layout

```
apps/
  simulator/     headless driver: run, resume, verify
  observer/      React observer UI               (Phase 8)
packages/
  shared/        primitives: assert, heap, canonical JSON, hashing, safe math
  sim-core/      the kernel: clock, calendar, RNG, scheduler, events, save
  world/         locations, buildings, terrain, objects   (Phase 1)
  npc/           traits, needs, decisions, memory, goals   (Phase 1-5)
  society/       households, relationships, law, religion  (Phase 5-6)
  economy/       labor, production, markets, currency      (Phase 3)
  ecology/       crops, animals, seasons                   (Phase 7)
  combat/        injury, fighting, warfare                 (Phase 6+)
  politics/      rulers, factions, diplomacy               (later)
  ai/            optional LLM adapters                     (Phase 9)
data/            world data and balance values
docs/            architecture and design documents
.claude/rules/   rules that apply to code in this repository
```

Directories without a `package.json` are placeholders and are not yet npm
workspace members; each has a README describing what it will own.

## The rules that shape everything

Full text in [CLAUDE.md](CLAUDE.md). The ones that constrain almost every line:

1. **The same seed and the same inputs produce the same world history.** Not
   just the same ending — the same events, in the same order, with the same ids.
2. **The simulation never requires an LLM to advance time.** AI is advisory. It
   may propose; simulation rules decide. Everything runs, and every test passes,
   with AI disabled.
3. **`sim-core` never depends on UI code.** Enforced by a test.
4. **Nothing comes from nowhere.** Goods, money, information and people all have
   provenance, and physical actions respect location, travel, access, ownership
   and time.
5. **NPCs act only on what they actually know.**
6. **Invalid state is reported, never silently corrected.**
7. **Every significant state change emits a structured event** — which is what
   makes `WHY?`, the inspector and the historical record possible.

If you are about to write simulation code, read
[docs/DETERMINISM.md](docs/DETERMINISM.md) first. It is the difference between
code that works and code that works reproducibly.

## Documentation

| Document | What it covers |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Prime directives and development philosophy |
| [docs/VISION.md](docs/VISION.md) | What this is trying to be |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, packages, data flow |
| [docs/SIMULATION_RULES.md](docs/SIMULATION_RULES.md) | The rules the world obeys |
| [docs/WORLD_MODEL.md](docs/WORLD_MODEL.md) | Space, time, objects, ownership |
| [docs/NPC_MODEL.md](docs/NPC_MODEL.md) | Traits, needs, memory, decisions |
| [docs/WORLD_ZERO_SPEC.md](docs/WORLD_ZERO_SPEC.md) | The first village |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 0 through 11 |
| [docs/CHRONICLE.md](docs/CHRONICLE.md) | The long-term goal: a newspaper written from inside the world |
| [docs/DETERMINISM.md](docs/DETERMINISM.md) | How reproducibility is achieved and enforced |
| [docs/PHASE_0.md](docs/PHASE_0.md) | Phase 0 implementation record and technical debt |
| [docs/PHASE_1.md](docs/PHASE_1.md) | Phase 1 plan: the village, its people, and how they move |

## Contributing

Before adding a system: read the relevant document in `docs/`, identify what it
touches, define its state transitions, events, invariants and failure cases,
write the tests, then implement the smallest coherent version. Run
`npm run check` and `npm run verify` before calling it done.

Do not implement several large systems at once. The architecture documents in
`docs/` are the source of truth — when implementation pressure conflicts with
them, update the document and record why, rather than changing the architecture
silently.
