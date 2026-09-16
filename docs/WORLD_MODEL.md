# World Model

## World Zero Scope

The first world is one medieval village and surrounding rural land.

Target:
- 80-120 NPCs
- 20-35 households
- 25-40 buildings
- nearby farmland
- limited woodland
- a stream or well
- roads/paths
- a small market
- one religious building
- essential crafts and services

## Initial Locations

Recommended minimum:
- village center
- market area
- church/chapel
- tavern
- smithy
- mill
- bakery
- several farms
- cottages/houses
- storage barn
- woodland
- fields
- water source
- road exits

Use a graph or lightweight coordinate model before detailed graphics.

Each location should support:
- type,
- position,
- capacity,
- access rules,
- owner,
- parent region,
- connected locations,
- travel cost.

## Buildings

Buildings are persistent entities.

Possible attributes:
- owner
- residents
- function
- condition
- rooms
- storage
- access
- value
- repair needs

## Objects

Objects should be real persistent entities or stackable inventories where appropriate.

Candidate object attributes:
- id
- definition/type
- material
- quality
- condition
- weight
- owner
- location
- container
- creator
- age
- value

Not every grain of wheat requires an individual database row. Use stacks for fungible commodities where practical.

## Initial Everyday Objects

World Zero should eventually include representative objects from:
- food,
- cooking,
- farming,
- clothing,
- bedding,
- containers,
- woodworking,
- metalworking,
- animal care,
- trade,
- religion,
- lighting,
- cleaning,
- construction,
- weapons/tools.

Do not attempt thousands of item definitions before the production and inventory model works.

## Production

Use recipes/process definitions.

Example:

```text
horseshoe
Inputs:
- iron
- charcoal
- blacksmith labor
Required:
- forge
- hammer
- anvil
Outputs:
- horseshoe
```

Tools may degrade through use.

## Agriculture

World Zero agriculture should eventually model:
- fields,
- crop type,
- planting,
- growth,
- harvest,
- storage,
- consumption,
- weather sensitivity.

Start with only a few crops.

Example:
- wheat
- barley
- cabbage
- beans

## Animals

Initial domestic animals might include:
- chickens,
- pigs,
- cattle,
- sheep,
- horses.

Wildlife can be minimal in the first milestone.

Animals should eventually have:
- location,
- age,
- health,
- hunger,
- reproduction,
- ownership,
- products/resources.

## Weather

Version 1 weather can be simple but persistent:
- temperature band,
- precipitation,
- seasonal progression.

Weather should modify travel, work, crops, comfort, and health where appropriate.

## Long-Term Expansion

After World Zero:
- multiple villages/towns,
- roads between settlements,
- regional markets,
- castles,
- rulers,
- political borders,
- military forces,
- forests,
- rivers,
- larger wildlife ecosystems,
- trade routes,
- migration,
- war,
- invasion.

The same world model should scale without replacing the core simulation architecture.
