# NPC Model

## Principle

An NPC is not a single collection of arbitrary statistics.

NPC data must be separated into categories that change at different rates and have different meanings.

## Six Core Layers

### 1. Identity

Mostly stable:
- name
- sex
- birth date
- age
- birthplace
- parentage
- household
- culture
- occupation
- social status
- religion
- citizenship/allegiance

### 2. Personality Traits

Slow-changing psychological traits.

Target approximately 40-60 core personality variables initially.

Candidate variables:
- honesty
- empathy
- compassion
- aggression
- patience
- impulsiveness
- conscientiousness
- sociability
- introversion
- risk tolerance
- ambition
- greed
- generosity
- loyalty
- family loyalty
- curiosity
- openness
- stubbornness
- discipline
- work ethic
- pride
- humility
- envy
- jealousy
- courage
- fearfulness
- vindictiveness
- forgiveness
- respect for authority
- religiosity
- superstition
- materialism
- romantic attachment tendency
- sexual fidelity
- dominance
- submissiveness
- conformity
- independence
- optimism
- pessimism
- emotional volatility
- trustfulness
- suspicion
- cleanliness
- frugality
- patience with children
- sense of duty
- fairness sensitivity
- status sensitivity
- hospitality

Do not encode major behaviors directly as personality variables if they can emerge.

Avoid:
- `propensityToSteal`
- `propensityToMurder`
- `propensityToWork`

Instead derive those behaviors from lower-level traits plus current circumstances.

### 3. Capabilities and Skills

Examples:
- strength
- endurance
- dexterity
- literacy
- numeracy
- farming
- animal handling
- smithing
- carpentry
- masonry
- cooking
- brewing
- healing
- herbalism
- trading
- persuasion
- intimidation
- leadership
- religious knowledge
- swordsmanship
- archery
- riding
- hunting
- tracking

Skills change through practice, training, injury, disease, age, and disuse.

### 4. Current State

Fast-changing values:
- hunger
- thirst
- fatigue
- sleep debt
- pain
- body temperature
- fear
- anger
- sadness
- happiness
- loneliness
- intoxication
- illness severity
- injury severity
- stress
- morale
- current location
- current activity
- available money
- carried inventory

### 5. Social State

Each relationship should be multidimensional.

Possible relationship axes:
- affection
- trust
- respect
- attraction
- fear
- resentment
- familiarity
- obligation
- debt
- rivalry
- kinship
- authority
- dependency

An NPC may love someone but distrust them.

An NPC may hate someone but respect them.

Do not collapse this into a single friendship score.

### 6. Mind

The mind contains:
- current goals,
- beliefs,
- memories,
- known facts,
- rumors,
- expectations,
- grudges,
- promises,
- fears,
- habits,
- preferred routines.

## Life History

Each NPC should have persistent biographical facts that can influence personality and goals.

Examples:
- childhood poverty,
- orphaned young,
- apprenticeship,
- veteran status,
- widowhood,
- failed business,
- famine survival,
- imprisonment,
- religious conversion,
- migration,
- loss of child,
- inheritance dispute.

Life events should modify structured state rather than existing only as prose.

## Memory

Use structured episodic memories.

Example:

```json
{
  "type": "assault",
  "day": 184,
  "subjectId": "npc_thomas_webb",
  "targetId": "npc_edric_hale",
  "source": "witnessed",
  "confidence": 1.0,
  "emotionalImpact": 0.64,
  "importance": 0.71
}
```

Memories may decay or become summarized.

NPC knowledge must preserve provenance:
- witnessed directly,
- told by trusted source,
- rumor,
- official announcement,
- inferred,
- uncertain.

This allows misinformation and gossip to emerge naturally.

## Needs

Initial needs may include:
- food
- water
- sleep
- safety
- shelter
- warmth
- health
- money/resources
- family protection
- social belonging
- status
- affection
- religious obligation
- recreation

## Goals

Goals operate at multiple horizons.

Short-term:
- eat,
- sleep,
- finish task,
- get home.

Medium-term:
- earn money,
- repair roof,
- repay debt,
- court partner,
- train apprentice.

Long-term:
- acquire land,
- improve family status,
- avenge grievance,
- become guild leader,
- enter clergy,
- secure children’s future.

## Decision Model

Version 1 should use Utility AI.

Conceptual formula:

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

Each action candidate:
1. checks prerequisites,
2. estimates utility,
3. records major factors,
4. competes with other valid actions,
5. schedules the chosen action.

## Example: Theft

Do not store `steal=73`.

Theft may be influenced by:
- hunger,
- family need,
- poverty,
- greed,
- impulsiveness,
- honesty,
- empathy,
- law respect,
- fear,
- perceived punishment,
- witnesses,
- relationship to victim,
- item value,
- ease of resale,
- desperation.

This lets the same NPC steal in one context and refuse in another.

## NPC Profile Requirement

The observer should eventually display:

- identity
- age
- household
- occupation
- health
- wealth
- traits
- skills
- current needs
- current action
- current goals
- relationships
- notable memories
- known rumors
- owned property
- carried inventory
- recent history

Most importantly:

### WHY?

Display:
- chosen action,
- top competing alternatives,
- top positive factors,
- top negative factors,
- relevant goals,
- relevant knowledge,
- constraints that prevented other actions.
