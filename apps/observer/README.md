# @rpgsim/observer

The observer application: a React + Vite window onto a running world.

**Status: not yet implemented.** This directory is a placeholder for Phase 8
(observer application), though a text event feed may appear earlier.

It has no `package.json` on purpose, so it is not yet an npm workspace member.

## What it is for

Watching the world operate on its own, and inspecting any NPC, household,
building, object, relationship, event or causal chain — including the `WHY?`
view that explains the major factors behind an NPC's current action.

## The direction of the dependency

The observer reads simulation state. It never writes it, and `sim-core` never
imports from here — Prime Directive 1, enforced by a test in
`packages/sim-core/test/determinism-guard.test.ts` that fails if any simulation
source mentions `react`, `pixi.js`, `vite` or `@rpgsim/observer`.

Rendering is explicitly secondary. The simulation has to be interesting as a
stream of text before anything is drawn.
