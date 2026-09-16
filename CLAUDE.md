# AI RPG Simulator — Project Instructions

## Project Purpose

Build a deterministic, autonomous medieval-world simulation that can operate without player input.

The long-term world should support:
- Five towns.
- Two castles and neighboring kingdoms.
- Approximately 1,000 persistent NPCs.
- Families, births, aging, disease, injury, disability, death, inheritance, marriage, work, crime, religion, politics, trade, war, farming, ecology, weather, animals, and ordinary medieval life.
- Thousands of persistent physical objects used in everyday medieval society.
- A player/hero who exists inside the same simulation rather than being the center of it.
- An observer interface that lets a user watch the world operate autonomously and inspect any NPC, household, building, object, relationship, event, or causal chain.

The first milestone is **World Zero**:
- One village.
- Roughly 100 NPCs.
- Headless simulation first.
- Text/event observer second.
- Rudimentary graphics only after the simulation is interesting without graphics.

## Prime Directives

1. `sim-core` must never depend on UI code.
2. The simulation must never require an LLM to advance time.
3. The same seed plus the same inputs must produce the same world history.
4. Never use `Math.random()` inside simulation code. All randomness must use the seeded simulation RNG.
5. NPCs may only act on information they actually know or reasonably believe.
6. Resources, money, objects, food, animals, information, and other state may not appear from nowhere.
7. Physical actions must respect location, travel time, access, ownership, inventory, physical capability, and time.
8. Every significant state change must emit a structured event.
9. NPC behavior should emerge from traits, state, memory, relationships, needs, goals, context, and opportunity rather than scripted stories.
10. Balance values belong in configuration/data files, not scattered through application code.
11. All major simulation systems require automated tests.
12. LLM output is advisory. Simulation rules are authoritative.
13. No feature may silently bypass the economy, inventory system, spatial model, time model, knowledge model, or physical constraints.
14. Prefer explicit causal systems over arbitrary random story events.
15. The simulation must remain playable and inspectable without any external AI API.
16. Preserve backward compatibility of save data whenever practical.
17. Every NPC must be inspectable through a `WHY?` explanation showing the major factors behind their current action.
18. Optimize for simulation depth, reproducibility, observability, and extensibility before visual fidelity.

## Core Architecture

Use a monorepo-style TypeScript architecture:

```text
AI-RPG-SIM/
├── apps/
│   ├── simulator/
│   └── observer/
├── packages/
│   ├── sim-core/
│   ├── npc/
│   ├── economy/
│   ├── ecology/
│   ├── society/
│   ├── combat/
│   ├── politics/
│   ├── world/
│   ├── ai/
│   └── shared/
├── data/
├── docs/
└── .claude/rules/
```

Recommended initial stack:
- Node.js
- TypeScript
- SQLite
- `better-sqlite3`
- React + Vite for observer UI
- Seeded PRNG library or a small deterministic PRNG implementation
- Vitest for testing
- Zod or equivalent runtime schema validation

Graphics are explicitly secondary. If/when an overhead renderer is added, prefer PixiJS unless a better technical reason exists at that time.

## Development Philosophy

Before implementing a major new system:
1. Read the relevant documents in `/docs`.
2. Identify which simulation systems it touches.
3. Define the state transitions and emitted events.
4. Define invariants and failure cases.
5. Write or update tests.
6. Implement the smallest coherent version.
7. Run deterministic replay tests.
8. Confirm the feature works headlessly before adding UI.

Do not implement several large systems simultaneously unless a dependency requires it.

## Source of Truth

The documents in `/docs` define the project architecture.

When implementation pressure conflicts with these documents:
- Do not silently change the architecture.
- Update the relevant design document first.
- Record the reason for the change.

## First Objective

Build World Zero into a simulator capable of running approximately 100 autonomous medieval NPCs for one full simulated year without:
- population collapse caused by obvious system bugs,
- runaway inflation,
- infinite resources,
- impossible travel,
- universal occupation convergence,
- broken family structures,
- invalid inventories,
- nondeterministic replay,
- NPC omniscience,
- or unbounded event growth.

The simulation does not need to be perfectly historically accurate in version 1. It does need to be internally coherent.
