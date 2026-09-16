# Testing Rules

For every significant simulation system, test:

## Determinism
Same seed + same input = same result.

## Invariants
Invalid states must be detected.

## Boundaries
Test zero, empty, exhausted, dead, full, inaccessible, missing, and extreme cases.

## Causality
Verify resources and state changes have legitimate causes.

## Time
Verify actions cannot finish before starting and exclusive activities do not overlap.

## Persistence
Where relevant:
1. run simulation,
2. save,
3. reload,
4. continue,
5. compare against uninterrupted run.

## Regression
When fixing a simulation bug, add a test reproducing it before implementing the fix.

Do not rely solely on snapshot tests for core simulation behavior.
