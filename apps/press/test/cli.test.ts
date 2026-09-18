import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as sim } from '@rpgsim/simulator';
import { main, parseArgs } from '../src/cli.ts';

/**
 * `press build`, from the outside.
 *
 * The exit code is the interface. This command runs in CI with nothing watching
 * the output, so a build that fails has to fail loudly and a build that cannot
 * be trusted -- an archive from a run that died halfway -- has to refuse rather
 * than print a page that looks ordinary and is not.
 */

const DAYS = 2;
const SEED = 'world-zero';

let root: string;
let archive: string;
let annals: string;
let out: string;
let said: string[];
let restore: () => void;
let builds = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'press-cli-'));
  archive = join(root, 'archive');
  annals = join(root, 'annals');

  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(sim(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive])).toBe(0);
    expect(sim(['annals', '--archive', archive, '--annals', annals])).toBe(0);
  } finally {
    quiet.mockRestore();
  }
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  said = [];
  const record = (...args: unknown[]): void => void said.push(args.map(String).join(' '));
  const log = vi.spyOn(console, 'log').mockImplementation(record);
  const error = vi.spyOn(console, 'error').mockImplementation(record);
  restore = () => {
    log.mockRestore();
    error.mockRestore();
  };
  builds += 1;
  out = join(root, `site-${builds}`);
});

afterEach(() => {
  restore();
  rmSync(out, { recursive: true, force: true });
});

const spoken = (): string => said.join('\n');

describe('reading the command line', () => {
  it('defaults to help with no arguments at all', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(main([])).toBe(0);
    expect(spoken()).toContain('Usage:');
  });

  it('takes the flags the publish workflow passes', () => {
    const parsed = parseArgs([
      'build',
      '--archive',
      'a',
      '--annals',
      'b',
      '--out',
      'c',
      '--data',
      'd',
      '--assets',
      'e',
      '--allow-incomplete',
      '--today',
      '2026-09-18',
    ]);
    expect(parsed.command).toBe('build');
    expect(parsed.options).toEqual({
      archive: 'a',
      annals: 'b',
      out: 'c',
      data: 'd',
      assets: 'e',
      allowIncomplete: true,
      today: '2026-09-18',
      write: false,
    });
  });

  it('writes to ./site unless told otherwise', () => {
    expect(parseArgs(['build']).options.out).toBe('./site');
    expect(parseArgs(['build']).options.allowIncomplete).toBe(false);
  });

  it('refuses a flag whose value is the next flag', () => {
    // `--archive --annals x` is a shell mistake that would otherwise read the
    // archive from a directory literally named `--annals`.
    expect(() => parseArgs(['build', '--archive', '--annals'])).toThrow(/--archive needs a value/);
    expect(() => parseArgs(['build', '--out'])).toThrow(/--out needs a value/);
  });

  it('refuses a flag it does not know rather than ignoring it', () => {
    expect(() => parseArgs(['build', '--draft'])).toThrow(/Unknown option: --draft/);
    expect(main(['build', '--draft'])).toBe(2);
    expect(spoken()).toContain('Unknown option');
  });

  it('refuses a command it does not know', () => {
    expect(main(['publish'])).toBe(2);
    expect(spoken()).toContain('Unknown command: publish');
  });

  it('will not build without being told where to read from', () => {
    expect(main(['build', '--archive', archive])).toBe(2);
    expect(main(['build', '--annals', annals])).toBe(2);
    expect(spoken()).toContain('build needs both --archive and --annals');
  });
});

describe('building', () => {
  it('writes a site and says what it wrote', () => {
    expect(main(['build', '--archive', archive, '--annals', annals, '--out', out])).toBe(0);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, '.nojekyll'))).toBe(true);
    expect(spoken()).toContain('The Pennycroft Chronicle');
    expect(spoken()).toContain(`seed       ${SEED}`);
    expect(spoken()).toContain(`written to ${out}`);
  });

  it('names the span of days it published', () => {
    expect(main(['build', '--archive', archive, '--annals', annals, '--out', out])).toBe(0);
    expect(spoken()).toContain('days       1200-04-01 to 1200-04-02');
  });

  it('says nothing about the machine it ran on', () => {
    expect(main(['build', '--archive', archive, '--annals', annals, '--out', out])).toBe(0);
    expect(spoken()).not.toContain('node_modules');
  });

  it('refuses an archive that is not there', () => {
    expect(() =>
      main(['build', '--archive', join(root, 'nothing'), '--annals', annals, '--out', out]),
    ).toThrow(/no archive to publish from/);
  });

  it('refuses a record that was never distilled', () => {
    const empty = join(root, 'empty-annals');
    mkdirSync(empty, { recursive: true });
    expect(() => main(['build', '--archive', archive, '--annals', empty, '--out', out])).toThrow(
      /never distilled/,
    );
  });

  it('refuses an archive from a run that never finished', () => {
    // The manifest is rewritten as each day lands, so an archive is readable
    // while it is still being written. Publishing one would print a paper from
    // a day the simulation died in the middle of.
    const half = join(root, 'half');
    rmSync(half, { recursive: true, force: true });
    cpSync(archive, half, { recursive: true });
    const manifestAt = join(half, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestAt, 'utf8')) as Record<string, unknown>;
    expect(manifest.complete).toBe(true);
    writeFileSync(manifestAt, JSON.stringify({ ...manifest, complete: false }), 'utf8');

    expect(() => main(['build', '--archive', half, '--annals', annals, '--out', out])).toThrow(
      /never finished/,
    );
    expect(main(['build', '--archive', half, '--annals', annals, '--out', out, '--allow-incomplete'])).toBe(0);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });
});
