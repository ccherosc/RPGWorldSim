# sim-core Rules

These rules apply whenever modifying simulation core code.

1. No UI dependencies.
2. No external LLM dependency.
3. No `Math.random()`.
4. All randomness comes from deterministic seeded RNG.
5. Scheduled events must have stable ordering.
6. Time progression must be explicit.
7. Save/load must preserve future deterministic behavior.
8. All meaningful state transitions emit events.
9. Global identifiers must be stable and unique.
10. Never hide invalid state with silent correction unless explicitly documented.
11. Add invariant checks for new core concepts.
12. Add deterministic replay tests for new scheduler/RNG behavior.
