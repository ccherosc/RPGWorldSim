# AI Layer Boundaries

AI is optional augmentation, not the simulation engine.

Permitted AI uses:
- biography prose
- dialogue
- historical summaries
- Chronicler narratives
- long-horizon intention suggestions
- content generation during development

AI may propose:
- goals
- dialogue
- interpretations
- plans

AI may not directly:
- create inventory
- move characters
- create currency
- alter health
- resolve combat
- bypass travel
- invent ownership
- change relationships without a simulation event
- create knowledge without provenance
- override physical rules

Any AI-proposed action must be:
1. parsed into a structured request,
2. validated by simulation rules,
3. accepted or rejected,
4. persisted if it affects deterministic replay.

The simulator must run with AI disabled.
