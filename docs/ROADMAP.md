# Roadmap

## Phase 0 — Constitution

Deliverables:
- architecture documents
- repository structure
- deterministic RNG
- simulation clock
- event scheduler
- event bus
- save/load skeleton
- automated testing framework

Exit criteria:
- same seed produces identical test events
- save/load resumes identically

## Phase 1 — World Zero Skeleton

Deliverables:
- one village
- locations
- buildings
- approximately 100 NPCs
- households
- basic identity
- basic traits
- basic state
- movement
- sleep/wake
- event stream

Exit criteria:
- run seven simulated days
- every NPC remains spatially and temporally valid

## Phase 2 — Survival

Deliverables:
- hunger
- thirst if retained as meaningful
- fatigue
- food inventory
- eating
- sleeping
- household consumption
- basic health

Exit criteria:
- 30-day simulation without obvious impossible state
- deaths, if any, have valid causal explanations

## Phase 3 — Work and Economy

Deliverables:
- occupations
- tools
- resource inputs
- production recipes
- wages
- currency
- buying/selling
- ownership
- market pricing
- household budgets

Exit criteria:
- 90-day economy without infinite-resource or runaway-money bugs
- workers can support households under reasonable conditions

## Phase 4 — Psychology

Deliverables:
- approximately 40-60 personality variables
- utility AI
- goals
- habits
- explainable action scoring
- competing actions
- `WHY?` debug output

Exit criteria:
- NPC behavior differs meaningfully based on traits and circumstances
- actions can be causally inspected

## Phase 5 — Relationships and Memory

Deliverables:
- multidimensional relationships
- episodic memory
- knowledge provenance
- gossip/rumor transmission
- reputation
- grudges
- favors
- debts

Exit criteria:
- social events produce persistent behavioral consequences

## Phase 6 — Society

Deliverables:
- religion
- communal gatherings
- crime
- witnesses
- basic enforcement
- marriage/partnership
- births
- aging
- death
- inheritance

Exit criteria:
- one-year simulation produces plausible social continuity

## Phase 7 — Ecology and Agriculture

Deliverables:
- seasons
- weather
- crop growth
- harvests
- livestock
- food storage
- resource scarcity

Exit criteria:
- weather and agriculture affect economy and household survival

## Phase 8 — Observer Application

Deliverables:
- React interface
- time controls
- event stream
- NPC profile
- household profile
- relationships
- economy
- health
- crime
- history
- `WHY?`

Exit criteria:
- user can spend time observing without command-line tooling

## Phase 9 — AI Layer

Deliverables:
- optional LLM provider abstraction
- biography generation
- dialogue generation
- long-term reflection
- Chronicler summaries

Exit criteria:
- simulator remains fully functional with AI disabled
- LLM output cannot violate simulation state

## Phase 10 — Scale

Expand:
- 250 NPCs
- 500 NPCs
- 1,000 NPCs
- five towns
- countryside
- castles
- kingdoms
- regional economy
- politics
- warfare

Only scale after correctness at lower population sizes.

## Phase 11 — RPG View

Add:
- graphical map
- sprites
- player-controlled hero
- interaction
- inventory UI
- conversation UI
- local rendering

The player joins the existing simulation rather than replacing it.
