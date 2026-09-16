# Claude Code Master Kickoff Prompt

You are the lead architect and implementation agent for a new project named **AI RPG Simulator**.

Your job is to create the foundation of a persistent, deterministic, autonomous medieval world simulation.

This is not primarily a graphical RPG yet. It is a **headless society simulator first**. Graphics and direct player control come later.

The long-term vision is a miniature living medieval world containing approximately five towns, two castles ruled by neighboring kings, countryside, farms, forests, water, natural weather, wildlife, livestock, crops, thousands of ordinary physical objects, approximately 1,000 persistent NPCs, and eventually a controllable hero who exists inside the same simulation.

NPCs must be able to live autonomously whether or not the player is present. Over time they should be able to work, eat, sleep, socialize, worship, trade, marry, reproduce, age, become sick, become injured, develop disabilities, recover, remember, gossip, steal, fight, feud, cooperate, migrate, inherit, lead, follow, die, and leave consequences behind.

The first milestone is much smaller and is called **World Zero**.

## WORLD ZERO TARGET

Build one medieval village containing roughly 100 persistent NPCs.

The initial goal is to create a simulation that can eventually run these NPCs autonomously for one full simulated year and remain internally coherent and interesting.

Do not start with advanced graphics.

The first useful interface may be a CLI or basic browser observer that shows:
- simulation date/time,
- play/pause,
- time speed,
- population,
- event feed,
- NPC list,
- selected NPC profile,
- current action,
- needs,
- household,
- wealth,
- relationships,
- goals,
- memories,
- and most importantly a `WHY?` explanation showing why the NPC selected its current action.

## FUNDAMENTAL PHILOSOPHY

The world does not exist for the player.

The player will eventually exist inside the world.

NPC stories should emerge from simulation rather than authored quest scripts.

Do not build "1,000 LLM agents."

Build 1,000 simulated people with an optional AI layer.

The deterministic simulation controls reality.

AI may later assist with:
- initial biography flavor,
- dialogue,
- historical summaries,
- long-horizon reflection,
- rumor phrasing,
- and a read-only Chronicler that identifies interesting emerging stories.

The simulation must not require an LLM to advance time.

## REQUIRED TECHNOLOGY DIRECTION

Use:
- Node.js,
- TypeScript,
- SQLite,
- `better-sqlite3`,
- Vitest,
- a deterministic seeded random number generator,
- Zod or an equivalent runtime schema validator.

Use React + Vite for the observer once a browser UI is justified.

A future graphical overhead renderer may use PixiJS, but do not make graphics a dependency of the simulation.

Use a monorepo-style structure approximately like:

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
│   ├── occupations/
│   ├── items/
│   ├── plants/
│   ├── animals/
│   ├── diseases/
│   ├── recipes/
│   └── world/
├── docs/
└── .claude/rules/
```

Read all Markdown files already present in the repository before designing implementation details. They are authoritative project documentation.

## NON-NEGOTIABLE SIMULATION RULES

1. `sim-core` must never depend on UI code.
2. The simulation must never require an LLM to advance time.
3. The same seed plus the same inputs must produce the same world history.
4. Never use `Math.random()` in simulation code.
5. All randomness must flow through the seeded simulation RNG.
6. NPCs may only make decisions from information they actually know or reasonably believe.
7. Resources, money, food, objects, knowledge, animals, injuries, and other state may not appear without a causal origin.
8. Physical actions must respect location, travel time, access, ownership, inventory, capability, and time.
9. Every meaningful state change must emit a structured event.
10. NPC behavior should emerge from traits + needs + goals + memory + relationships + circumstances + opportunity.
11. Do not hard-code story outcomes.
12. Balance values belong in configuration/data.
13. All major systems require automated tests.
14. LLM output is advisory only. Simulation rules remain authoritative.
15. The simulation must function with all AI integrations disabled.
16. Every selected NPC action must retain enough scoring information to explain `WHY?`.
17. Save/load must preserve deterministic continuation.
18. Prefer explicit causal systems over arbitrary random events.

## NPC MODEL

Do not create one flat arbitrary array of 100 personality statistics.

Model each NPC in layers:

### Identity
Examples:
- name,
- sex,
- birth date,
- age,
- birthplace,
- parents,
- household,
- occupation,
- social status,
- religion.

### Personality
Use approximately 40-60 relatively stable psychological traits.

Examples:
- honesty,
- empathy,
- aggression,
- patience,
- impulsiveness,
- conscientiousness,
- sociability,
- risk tolerance,
- ambition,
- greed,
- generosity,
- loyalty,
- family loyalty,
- curiosity,
- stubbornness,
- work ethic,
- pride,
- envy,
- courage,
- fearfulness,
- vindictiveness,
- forgiveness,
- respect for authority,
- religiosity,
- superstition,
- materialism,
- dominance,
- conformity,
- independence,
- emotional volatility,
- trustfulness,
- suspicion,
- frugality,
- fairness sensitivity,
- status sensitivity,
- hospitality.

Do not create high-level traits such as `propensityToSteal`.

Stealing should emerge from personality plus circumstances.

### Capabilities
Examples:
- strength,
- endurance,
- literacy,
- numeracy,
- farming,
- smithing,
- carpentry,
- cooking,
- trading,
- persuasion,
- leadership,
- healing,
- riding,
- hunting,
- combat skills.

### Current State
Examples:
- hunger,
- fatigue,
- pain,
- fear,
- anger,
- sadness,
- happiness,
- loneliness,
- intoxication,
- stress,
- illness,
- injury,
- current location,
- current activity,
- money,
- carried inventory.

### Social State
Relationships are multidimensional.

Support values such as:
- affection,
- trust,
- respect,
- attraction,
- fear,
- resentment,
- familiarity,
- obligation,
- debt,
- rivalry,
- kinship.

Do not collapse relationships into one "friendship" number.

### Mind
Support:
- goals,
- beliefs,
- memories,
- known facts,
- rumors,
- grudges,
- promises,
- habits,
- routines.

Memories must record provenance where relevant:
- witnessed,
- heard from trusted source,
- rumor,
- official announcement,
- inference.

This will later enable misinformation, gossip, reputation, and competing historical narratives.

## DECISION SYSTEM

Use Utility AI initially.

Conceptually:

```text
Action Utility =
    Need Satisfaction
  + Goal Progress
  + Personality Compatibility
  + Social Obligation
  + Habit
  + Expected Reward
  - Physical Cost
  - Risk
  - Moral Cost
  - Legal Risk
  + Controlled Random Variation
```

Each candidate action must:
1. validate prerequisites,
2. calculate utility,
3. record major scoring factors,
4. compete against other valid actions,
5. schedule the selected action.

The exact same NPC should behave differently under different circumstances.

Example:
An honest but desperate parent may steal food when children are starving and no guard is present, while refusing to steal under normal conditions.

Do not encode the final behavior directly.

## TIME SYSTEM

Do not evaluate all NPCs every simulated second.

Use an event scheduler.

Different systems may operate at different resolutions.

Typical examples:
- combat: seconds,
- movement: seconds/minutes,
- NPC decisions: minutes,
- hunger/fatigue: minutes,
- economy: hours,
- weather: hours,
- crops: hours/days,
- demographics: days,
- politics: days/weeks.

If an NPC is sleeping until 05:47, schedule a wake event for 05:47 rather than reevaluating that NPC every second.

## OBJECTS AND ECONOMY

Ordinary physical objects should eventually be persistent and meaningful.

Objects may have:
- definition,
- material,
- quality,
- condition,
- weight,
- owner,
- location,
- container,
- creator,
- age,
- value.

Use commodity stacks for fungible resources rather than creating one database row per grain of wheat.

Production must consume real inputs.

Example:

```text
iron + charcoal + blacksmith labor + forge + hammer + anvil
→ horseshoe
```

A missing or broken required tool must affect production.

Initial World Zero economy should remain deliberately small.

Suggested occupations:
- farmers,
- laborers,
- miller,
- baker,
- blacksmith,
- carpenter,
- herder,
- tavern keeper,
- merchant,
- priest,
- healer,
- constable/guard,
- tailor,
- brewer,
- dependents/unemployed.

Suggested core commodities:
- grain,
- flour,
- bread,
- vegetables,
- meat,
- ale,
- firewood,
- charcoal,
- iron,
- timber,
- wool,
- cloth,
- coins.

## PHYSICAL AND CAUSAL RULES

Everything needs a cause.

Examples:

Weather:
rain
→ soil moisture
→ crop growth or disease
→ harvest quantity
→ food supply
→ prices
→ hunger
→ behavior

Economy:
tool breaks
→ production slows
→ goods become scarce
→ price changes
→ households alter behavior

Social:
assault
→ witness memory
→ rumor
→ reputation change
→ retaliation or law enforcement

Do not fake downstream consequences with unrelated random events.

## OBSERVABILITY

The simulator must be designed to debug itself.

Every meaningful event should include:
- timestamp,
- event type,
- participants,
- location,
- relevant state change,
- causal references where practical.

The observer must eventually let the user inspect:
- people,
- households,
- inventories,
- buildings,
- relationships,
- memories,
- goals,
- occupations,
- markets,
- crime,
- health,
- history.

Implement a `WHY?` system early.

For an NPC action it should be possible to display something similar to:

```text
CURRENT ACTION
Traveling to market

WHY?
Needs seed grain.
Harvest was poor.
Brother is considered trustworthy.

Top choices:
Borrow from brother    78.1
Seek temporary work    54.3
Sell goat              48.7
Steal grain            21.6
```

The explanation system is both a user feature and an essential debugging tool.

## WORLD ZERO DEVELOPMENT ORDER

Do not attempt the entire game at once.

Proceed in coherent phases.

### Phase 0 — Foundation
Implement:
- repository structure,
- TypeScript configuration,
- deterministic RNG,
- simulation clock,
- event scheduler,
- event bus,
- entity IDs,
- save/load foundation,
- testing infrastructure.

Acceptance:
- deterministic replay test passes.

### Phase 1 — Village Skeleton
Implement:
- one village,
- locations,
- buildings,
- households,
- approximately 100 NPCs,
- movement,
- sleep/wake,
- event output.

Acceptance:
- seven simulated days complete without invalid time or location state.

### Phase 2 — Survival
Implement:
- hunger,
- fatigue,
- food,
- eating,
- sleeping,
- household consumption,
- simple health.

Acceptance:
- 30 simulated days without obvious impossible state.

### Phase 3 — Work and Economy
Implement:
- occupations,
- tools,
- resource inputs,
- production,
- wages,
- currency,
- buying/selling,
- ownership,
- market prices.

Acceptance:
- 90-day economy without infinite-resource or runaway-money failures.

### Phase 4 — Psychology
Implement:
- personality traits,
- needs,
- Utility AI,
- goals,
- habits,
- explainable scoring,
- `WHY?`.

Acceptance:
- NPC personalities produce visibly different behavior.

### Phase 5 — Relationships and Memory
Implement:
- multidimensional relationships,
- memories,
- knowledge provenance,
- gossip,
- reputation,
- grudges,
- favors,
- debt.

Acceptance:
- social events create persistent behavioral consequences.

### Phase 6 — Society
Later add:
- religion,
- gatherings,
- crime,
- witnesses,
- enforcement,
- marriage,
- births,
- aging,
- death,
- inheritance.

### Phase 7 — Ecology
Later add:
- seasons,
- weather,
- crops,
- harvests,
- livestock,
- natural resource pressure.

### Phase 8 — Observer
Build the fuller React observer after the simulation earns it.

### Phase 9 — Optional AI
Add an LLM provider abstraction only after core simulation systems function without it.

### Phase 10 — Scale
Only after World Zero is stable:
- 250 NPCs,
- 500 NPCs,
- 1,000 NPCs,
- five towns,
- countryside,
- castles,
- kingdoms,
- regional economics,
- politics,
- warfare.

### Phase 11 — RPG View
Then add:
- graphical map,
- sprites,
- hero control,
- conversations,
- inventory UI,
- direct interaction.

## CHRONICLER

Eventually create a read-only Chronicler.

Its purpose is to identify emerging stories such as:
- feuds,
- romances,
- debt spirals,
- crime waves,
- business success,
- famine,
- epidemic,
- inheritance disputes,
- political rivalries.

The Chronicler may use heuristics first and an LLM later.

It must never alter simulation state.

## FIRST IMPLEMENTATION TASK

Start with **Phase 0 only**.

Before coding:
1. Read `CLAUDE.md`.
2. Read all files in `/docs`.
3. Read all files in `/.claude/rules`.
4. Inspect the repository if anything already exists.
5. Produce a concise implementation plan for Phase 0.
6. Identify all initial packages and their responsibilities.
7. Identify the core schemas/interfaces.
8. Identify the deterministic testing strategy.

Then implement Phase 0.

Do not jump ahead into economics, psychology, graphics, combat, politics, or LLM integration.

Phase 0 must end with automated tests proving:
- seeded RNG reproducibility,
- stable event ordering,
- deterministic scheduler execution,
- save/load continuation,
- identical replay from identical inputs.

After implementation:
- run all tests,
- fix failures,
- summarize what was created,
- list important architectural decisions,
- identify technical debt,
- and stop at the Phase 0 boundary unless explicitly instructed to continue.

Treat this repository as a long-lived simulation platform rather than a disposable prototype.
