import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mechanical enforcement of the determinism rules.
 *
 * CLAUDE.md directive 4 and `.claude/rules/sim-core.md` rules 2-4 forbid
 * `Math.random()`, wall-clock time and external LLM calls in simulation code.
 * Those are easy rules to break by reflex months from now, and a violation does
 * not fail any behavioural test - two runs of a world that calls `Math.random`
 * still *look* fine until a replay is compared. So the rules are asserted
 * against the source text itself.
 *
 * The banned `Math.*` functions are the ones ECMAScript leaves
 * implementation-defined: only `+ - * /`, `Math.sqrt` and the integer-exact
 * operations are guaranteed to give bit-identical results across engines and
 * platforms, so `Math.exp`, `Math.log`, `Math.pow`, `Math.sin` and friends can
 * legitimately differ between a developer's laptop and a server and silently
 * break cross-machine replay. `@rpgsim/shared`'s deterministic-math module is
 * the sanctioned alternative.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** Packages whose code runs inside the simulation and must stay deterministic. */
const SIMULATION_SOURCES = [
  join('packages', 'shared', 'src'),
  join('packages', 'sim-core', 'src'),
  join('packages', 'world', 'src'),
  join('packages', 'npc', 'src'),
  join('packages', 'society', 'src'),
  join('apps', 'simulator', 'src'),
];

/**
 * Code that does not run inside the simulation but must still give the same
 * answer twice.
 *
 * The chronicle is the first of these. Nothing it does can perturb a world --
 * the layering test in `packages/chronicle/test` is what keeps that true -- but
 * its whole premise is that the day archive is a cache: delete it, rebuild it
 * from the seed, distil it again, and get byte-identical annals. A
 * `Math.random` or a `new Date` anywhere in it would break that quietly and
 * permanently, because the annals are the one thing here that is never rewritten.
 */
const REPRODUCIBLE_SOURCES = [join('packages', 'chronicle', 'src')];

interface BannedPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

const BANNED: BannedPattern[] = [
  {
    name: 'Math.random',
    pattern: /\bMath\s*\.\s*random\s*\(/g,
    reason: 'all randomness must come from the seeded simulation RNG',
  },
  {
    name: 'Date.now',
    pattern: /\bDate\s*\.\s*now\s*\(/g,
    reason: 'simulated time comes from the clock, never from wall-clock time',
  },
  {
    name: 'new Date',
    pattern: /\bnew\s+Date\s*\(/g,
    reason: 'simulated time comes from the clock, never from wall-clock time',
  },
  {
    name: 'performance.now',
    pattern: /\bperformance\s*\.\s*now\s*\(/g,
    reason: 'simulated time comes from the clock, never from wall-clock time',
  },
  {
    name: 'implementation-defined Math functions',
    pattern:
      /\bMath\s*\.\s*(exp|expm1|log|log2|log10|log1p|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot|fround)\s*\(/g,
    reason:
      'these are not bit-exact across engines; use @rpgsim/shared/deterministic-math instead',
  },
  {
    name: 'Set/Map iteration over an unordered source',
    pattern: /\bObject\s*\.\s*(keys|entries|values)\s*\([^)]*\)\s*\.\s*(forEach|map|reduce)\b/g,
    reason:
      'iterate a sorted copy: property order is stable in V8 but relying on it invites ordering bugs',
  },
  {
    name: 'network or LLM call',
    pattern: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/g,
    reason: 'the simulation must advance without any external service',
  },
];

/** Opt-outs, each of which must be justified here rather than at the call site. */
const ALLOWED: Array<{ file: string; pattern: string; why: string }> = [
  {
    file: join('packages', 'sim-core', 'src', 'save.ts'),
    pattern: 'new Date',
    why: 'stamps a save with wall-clock time for humans; excluded from the state hash',
  },
];

function isAllowed(file: string, patternName: string): boolean {
  return ALLOWED.some((entry) => entry.file === file && entry.pattern === patternName);
}

function collectSourceFiles(directory: string): string[] {
  const absolute = join(REPO_ROOT, directory);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(absolute);
  return found;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

describe('determinism guard', () => {
  const files = [...SIMULATION_SOURCES, ...REPRODUCIBLE_SOURCES].flatMap(collectSourceFiles);

  it('finds the simulation source tree', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.every((file) => file.endsWith('.ts'))).toBe(true);
  });

  it('scans the chronicle too, not only the simulation', () => {
    // Named explicitly because a scan that silently covers nothing is a guard
    // that silently passes: a mistyped directory would fail no other test here.
    const scanned = files.map((file) => relative(REPO_ROOT, file).split(sep).join('/'));
    expect(scanned.some((file) => file.startsWith('packages/chronicle/src/'))).toBe(true);
  });

  for (const banned of BANNED) {
    it(`bans ${banned.name} in reproducible code`, () => {
      const offences: string[] = [];
      for (const file of files) {
        const relativePath = relative(REPO_ROOT, file);
        if (isAllowed(relativePath, banned.name)) continue;

        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(banned.pattern)) {
          offences.push(
            `${relativePath.split(sep).join('/')}:${lineOf(text, match.index ?? 0)} ${match[0]}`,
          );
        }
      }
      expect(offences, `${banned.name} - ${banned.reason}`).toEqual([]);
    });
  }

  it('keeps every documented opt-out pointing at a real file', () => {
    for (const entry of ALLOWED) {
      const text = readFileSync(join(REPO_ROOT, entry.file), 'utf8');
      const banned = BANNED.find((b) => b.name === entry.pattern);
      expect(banned, entry.pattern).toBeDefined();
      // An opt-out that no longer matches anything is dead weight; delete it.
      expect(new RegExp((banned as BannedPattern).pattern.source).test(text), entry.file).toBe(true);
    }
  });
});

describe('layering', () => {
  it('keeps the simulation packages free of UI, framework and platform dependencies', () => {
    const forbidden = /from\s+'(react|react-dom|pixi\.js|vite|express|@rpgsim\/(observer|ai))/;
    for (const root of [
      join('packages', 'sim-core', 'src'),
      join('packages', 'world', 'src'),
      join('packages', 'npc', 'src'),
      join('packages', 'society', 'src'),
    ]) {
      for (const file of collectSourceFiles(root)) {
        expect(forbidden.test(readFileSync(file, 'utf8')), relative(REPO_ROOT, file)).toBe(false);
      }
    }
  });

  it('keeps shared free of any dependency on sim-core', () => {
    for (const file of collectSourceFiles(join('packages', 'shared', 'src'))) {
      const text = readFileSync(file, 'utf8');
      expect(text.includes('@rpgsim/sim-core'), relative(REPO_ROOT, file)).toBe(false);
    }
  });

  it('imports relative modules with an explicit .ts extension', () => {
    const relativeImport = /from\s+'(\.[^']*)'/g;
    for (const file of [
      ...collectSourceFiles(join('packages', 'sim-core', 'src')),
      ...collectSourceFiles(join('packages', 'shared', 'src')),
      ...collectSourceFiles(join('packages', 'world', 'src')),
      ...collectSourceFiles(join('packages', 'npc', 'src')),
      ...collectSourceFiles(join('packages', 'society', 'src')),
    ]) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(relativeImport)) {
        expect(match[1], relative(REPO_ROOT, file)).toMatch(/\.ts$/);
      }
    }
  });
});
