# Architecture

## Architectural Principle

Separate **reality** from **presentation** and **AI expression**.

The simulation engine defines what is true.

The observer UI displays what is true.

The AI layer may interpret, summarize, converse, generate flavor, or propose intentions, but it cannot directly overwrite simulation truth.

## Recommended Repository Structure

```text
AI-RPG-SIM/
├── apps/
│   ├── simulator/        # CLI/headless runner
│   └── observer/         # React observer application
│
├── packages/
│   ├── sim-core/         # clock, scheduler, RNG, events, save/replay
│   ├── npc/              # traits, needs, decisions, memory, goals
│   ├── economy/          # labor, production, markets, currency, trade
│   ├── ecology/          # crops, animals, plants, seasons
│   ├── society/          # households, relationships, law, religion
│   ├── combat/           # injuries, fighting, later warfare
│   ├── politics/         # rulers, factions, diplomacy, succession
│   ├── world/            # locations, buildings, terrain, objects
│   ├── ai/               # optional LLM adapters
│   └── shared/           # shared schemas/utilities
│
├── data/
│   ├── occupations/
│   ├── items/
│   ├── plants/
│   ├── animals/
│   ├── diseases/
│   ├── recipes/
│   └── world/
│
├── docs/
└── .claude/rules/
```

## Layers

### 1. Simulation Core

Responsibilities:
- simulation clock,
- event scheduling,
- deterministic RNG,
- event bus,
- save/load,
- replay,
- global identifiers,
- simulation configuration,
- invariant checking,
- diagnostics.

`sim-core` should contain as little medieval-specific knowledge as possible.

### 2. Domain Systems

Domain packages implement the actual world:
- NPC psychology,
- economy,
- ecology,
- social systems,
- health,
- world geography,
- politics,
- combat.

Systems communicate through explicit state and structured events.

### 3. Persistence

SQLite is the initial persistence layer.

Persist:
- stable entities,
- save states,
- event history,
- aggregate historical statistics,
- notable memories,
- relationships,
- inventories,
- ownership,
- households,
- world state.

Avoid storing every transient calculation.

### 4. Observer

The observer must be downstream from simulation state.

Initial observer features:
- play/pause,
- 1x / 10x / 100x / 1000x speeds where technically feasible,
- event feed,
- NPC browser,
- NPC profile,
- relationship view,
- household view,
- economy dashboard,
- health dashboard,
- crime dashboard,
- history view,
- `WHY?` inspector.

### 5. AI Layer

The AI package is optional and asynchronous relative to the fundamental simulation.

Use AI for:
- generating initial biography flavor from structured data,
- summarizing accumulated history,
- long-horizon goal reflection,
- dialogue,
- rumor phrasing,
- chronicler summaries,
- content authoring assistance.

Never require LLM calls for:
- walking,
- hunger,
- sleeping,
- eating,
- inventory,
- buying,
- selling,
- farming,
- production,
- combat resolution,
- birth,
- death,
- physical accessibility,
- time progression,
- object ownership,
- or ordinary utility decisions.

## Determinism

Determinism is mandatory.

Given:
- world seed,
- configuration,
- initial state,
- player inputs,
- external AI decisions that were explicitly persisted,

the simulator must be able to reproduce the same result.

Use named RNG streams where useful, for example:
- `weather`,
- `demographics`,
- `npc_decisions`,
- `health`,
- `combat`.

This reduces accidental coupling between unrelated random processes.

## Time Model

Do not iterate all NPCs every simulated second.

Use an event scheduler.

Different systems may operate at different resolutions:

| System | Typical Resolution |
|---|---|
| Combat | seconds |
| Immediate movement | seconds/minutes |
| NPC decision reevaluation | minutes |
| Hunger/fatigue | minutes |
| Work/economy | minutes/hours |
| Weather | hours |
| Crops | hours/days |
| Demographics | days |
| Politics | days/weeks |

Sleeping NPCs should normally have a scheduled wake event rather than being reconsidered every tick.

## Event Architecture

All meaningful state transitions emit structured events.

Examples:
- `npc.woke`
- `npc.ate`
- `npc.started_work`
- `npc.traveled`
- `relationship.changed`
- `item.transferred`
- `crime.theft`
- `health.injury`
- `household.birth`
- `household.death`
- `market.sale`
- `crop.harvested`
- `weather.rain_started`

Events should support:
- debugging,
- observer feeds,
- memory formation,
- statistics,
- historical summaries,
- causal inspection.

## Causal Explainability

Every selected action should record its top decision factors.

Example:

```json
{
  "action": "steal_food",
  "utility": 72.4,
  "factors": [
    ["hunger", 25.0],
    ["children_hungry", 18.0],
    ["opportunity", 15.0],
    ["greed", 7.0],
    ["honesty", -12.0],
    ["legal_risk", -5.6]
  ]
}
```

The observer uses this for the `WHY?` feature.

## Scaling Strategy

The architecture must scale by:
- reducing evaluation frequency,
- using scheduled events,
- caching derived values,
- aggregating distant simulation where appropriate,
- avoiding unnecessary LLM calls,
- limiting verbose historical storage,
- selectively retaining only meaningful memories.

Do not prematurely optimize into a distributed system.
