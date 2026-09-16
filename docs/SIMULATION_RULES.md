# Simulation Rules

## Fundamental Rule

The simulation defines reality.

No NPC, AI model, UI component, or narrative system may violate the world state.

## Conservation and Origin

Things require origins.

Examples:
- money must be minted, transferred, earned, inherited, stolen, or otherwise accounted for,
- food must be grown, gathered, hunted, produced, purchased, gifted, stolen, or imported,
- tools must be manufactured or imported,
- knowledge must be observed, learned, inferred, or communicated,
- injuries must have a cause,
- children require parents and births,
- deaths require a cause.

Avoid magical creation of ordinary resources unless explicitly part of later fantasy systems.

## Spatial Rules

Every physical entity must have a meaningful location.

Actions must respect:
- distance,
- travel time,
- roads,
- terrain,
- access,
- building entrances,
- ownership restrictions,
- weather,
- physical capability.

No teleportation.

## Time Rules

Actions consume time.

An NPC cannot:
- work in two places at once,
- travel instantly,
- harvest an entire field instantly,
- attend church while simultaneously operating a forge.

Long activities should schedule completion or progress events.

## Knowledge Rules

NPCs are not omniscient.

An NPC can make decisions only using:
- direct observation,
- memories,
- communicated information,
- known public information,
- reasonable inference.

The simulation may know global truth. The NPC may not.

## Needs and Survival

Basic survival requirements must matter:
- food,
- water,
- sleep,
- warmth,
- shelter,
- health.

Consequences should escalate gradually rather than through arbitrary thresholds whenever practical.

## Work

Occupations require:
- time,
- location,
- tools when appropriate,
- input resources,
- capability,
- opportunity.

Production must create explicit outputs from explicit inputs.

## Economy

Initial economy should support:
- currency,
- personal wealth,
- household wealth,
- wages,
- prices,
- purchases,
- sales,
- debts,
- ownership,
- inventories.

Markets should respond to supply and demand without becoming mathematically unstable.

## Households

Households should support:
- co-residence,
- pooled resources where culturally appropriate,
- dependents,
- parents,
- children,
- spouses,
- inheritance,
- expenses,
- food consumption.

## Crime

Crime is an action category, not a random story generator.

Examples:
- theft,
- assault,
- fraud,
- trespass.

Crime should depend on:
- motive,
- opportunity,
- personality,
- risk,
- social conditions.

Discovery should depend on:
- witnesses,
- evidence,
- confession,
- reputation,
- investigation,
- rumor.

## Religion

Religion should eventually function as a social institution.

Potential systems:
- services,
- clergy,
- attendance,
- religious obligation,
- donations,
- festivals,
- doctrine,
- social pressure,
- burial,
- legitimacy.

Do not initially build theological complexity before basic village life works.

## Health

Initial health should support:
- baseline health,
- injury,
- illness,
- pain,
- recovery,
- disability,
- death.

Later extensions:
- infection,
- pregnancy,
- childbirth risk,
- chronic conditions,
- age-related decline,
- epidemics.

## Demographics

Population continuity requires:
- aging,
- partnership formation,
- fertility,
- births,
- childhood,
- adulthood,
- death,
- household formation,
- migration.

The system should eventually support population replacement without scripted spawns.

## Ecology

Natural systems should eventually include:
- seasons,
- temperature,
- rain,
- soil moisture,
- crops,
- trees,
- wild plants,
- animals,
- water.

Weather must be causally meaningful rather than cosmetic.

Example:

```text
rain
→ soil moisture
→ crop growth/disease
→ harvest
→ food supply
→ price
→ hunger
→ social behavior
```

## Event Logging

Every significant event should include:
- timestamp,
- type,
- participants,
- location,
- cause/reference when available,
- relevant state change.

Events may later be summarized or archived.

## Debugging Invariants

Regularly validate:
- no negative item quantities,
- no duplicate ownership,
- no impossible location transitions,
- no dead NPC performing actions,
- no NPC performing overlapping exclusive activities,
- no impossible money creation,
- no parent younger than child,
- no invalid household references,
- no missing required input resources,
- no action occurring before its prerequisite.

Simulation correctness is more important than narrative convenience.
