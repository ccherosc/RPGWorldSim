import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Which way the dependencies are allowed to point.
 *
 * CLAUDE.md directive 1 says `sim-core` must never depend on UI code, and the
 * chronicle is the first thing in the tree that is downstream of the simulation
 * rather than part of it. The rule generalises: **the simulation never knows it
 * is being watched.** A world whose behaviour could depend on whether anybody
 * was writing it down would not be reproducible from its seed, which is the one
 * property everything else here is built on.
 *
 * The other direction is a rule too, and a quieter one. The chronicle reads
 * *events*, not systems. Given `@rpgsim/world` it could ask the travel system
 * where somebody is, and Phase 1's honesty rule — a villager may only be
 * written about where the record shows they were — would quietly stop being
 * enforceable. Taking the import away means it cannot be broken by accident.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** Packages that are part of the simulation. None of them may look downstream. */
const SIMULATION_PACKAGES = ['shared', 'sim-core', 'world', 'npc', 'society'];

/** What the chronicle is allowed to import. Deliberately short. */
const CHRONICLE_MAY_IMPORT = new Set(['@rpgsim/shared', '@rpgsim/sim-core', 'zod']);

const IMPORT = /\bfrom\s+'([^']+)'/g;

function sourceFiles(directory: string): string[] {
  const absolute = join(REPO_ROOT, directory);
  const found: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path).sort()) {
      const child = join(path, entry);
      if (statSync(child).isDirectory()) walk(child);
      else if (child.endsWith('.ts')) found.push(child);
    }
  };
  walk(absolute);
  return found;
}

function importsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].map((match) => match[1] as string);
}

describe('the simulation does not know it is being watched', () => {
  for (const name of SIMULATION_PACKAGES) {
    it(`${name} never imports the chronicle`, () => {
      const offenders = sourceFiles(join('packages', name, 'src'))
        .filter((file) => importsIn(file).some((specifier) => specifier.startsWith('@rpgsim/chronicle')))
        .map((file) => relative(REPO_ROOT, file));
      expect(offenders).toEqual([]);
    });
  }
});

describe('the chronicle reads events, not systems', () => {
  it('imports nothing but the kernel, the shared helpers and its own files', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join('packages', 'chronicle', 'src'))) {
      for (const specifier of importsIn(file)) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
        if (specifier.startsWith('node:')) continue;
        if (CHRONICLE_MAY_IMPORT.has(specifier)) continue;
        offenders.push(`${relative(REPO_ROOT, file)} imports ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
