# World Zero Specification

## Objective

World Zero proves that autonomous simulated medieval life is interesting before expensive graphics or large-scale AI are added.

The target question is:

> Can approximately 100 autonomous medieval people survive, work, socialize, conflict, remember, and change over one simulated year while maintaining a coherent world state?

## Population

Generate approximately 100 persistent NPCs.

Recommended age distribution:
- children
- adolescents
- adults
- older adults

Create multi-person households rather than 100 independent adults.

Include:
- parents,
- children,
- married couples,
- widows/widowers,
- single adults,
- apprentices,
- elderly dependents.

## Initial Occupations

Keep the first economy intentionally limited.

Suggested:
- farmers
- laborers
- miller
- baker
- blacksmith
- carpenter
- herder
- tavern keeper
- merchant/trader
- priest/clergy
- healer
- guard/constable
- tailor/seamstress
- brewer
- unemployed/dependent

Do not add dozens of crafts until the base production chain is stable.

## Core Resources

Suggested initial commodities:
- grain
- flour
- bread
- vegetables
- meat
- ale
- firewood
- charcoal
- iron
- timber
- wool
- cloth
- coins

## Daily Simulation

NPCs should be capable of:
- waking,
- checking urgent needs,
- eating,
- traveling,
- working,
- purchasing,
- producing,
- socializing,
- worshiping when appropriate,
- responding to emergencies,
- returning home,
- sleeping.

Routines should be habits, not scripts.

Needs and events may interrupt them.

## Core Personality Model

Initial target:
- approximately 40-60 psychological traits
- approximately 10-20 capability attributes
- fast-changing needs/state
- multidimensional relationships
- structured memories
- goals

This can exceed 100 meaningful variables per NPC when the layers are combined without becoming one arbitrary 100-field personality array.

## Required Behaviors

World Zero should eventually demonstrate:
- choosing work versus leisure,
- buying food,
- responding to hunger,
- social interaction,
- cooperation,
- conflict,
- theft under some circumstances,
- refusal to steal under others,
- formation of grudges,
- helping relatives,
- spending or saving money,
- reacting to injury,
- changing plans due to weather or urgent need.

## Observer Requirements

Version 1 observer can be CLI/text.

Must display:
- date/time
- population
- births/deaths once implemented
- major event feed
- NPC list
- selected NPC details
- current action
- current needs
- household
- wealth
- relationships
- goals
- recent memories
- action explanation

Example:

```text
EDRIC HALE
Age: 43
Occupation: Farmer
Health: Fair
Mood: Angry
Location: Mill Road

CURRENT ACTION
Traveling to Ashford Market

WHY?
Needs seed grain.
Lost part of his harvest.
Intends to borrow money from his brother.

Top action scores:
Borrow from brother        78.1
Seek day labor             54.3
Sell goat                  48.7
Steal grain                21.6
```

## Chronicler

The Chronicler is a read-only interpretation system.

It should eventually identify noteworthy multi-event narratives.

Examples:
- feud,
- romance,
- debt spiral,
- crime wave,
- business success,
- famine,
- epidemic,
- inheritance dispute,
- political rivalry.

The Chronicler may use deterministic heuristics first and optional LLM summarization later.

It must never alter simulation state.

## One-Year Acceptance Test

A successful one-year simulation should:
- complete without crashes,
- be deterministic,
- preserve valid inventories,
- preserve valid ownership,
- preserve valid locations,
- preserve valid family references,
- avoid infinite money/resources,
- avoid obvious population pathologies caused by bugs,
- produce differentiated NPC lives,
- produce inspectable causal chains,
- generate at least some emergent events worth reading.

The goal is not perfection.

The goal is evidence that the architecture can produce a living world.
