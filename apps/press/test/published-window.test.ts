import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SimAssertionError } from '@rpgsim/shared';
import { main as sim } from '@rpgsim/simulator';
import { loadPublication } from '../src/data.ts';
import { latestOf, postersOf, readVillage } from '../src/issue.ts';
import type { Village } from '../src/issue.ts';
import { Publication, villageDate } from '../src/publication.ts';
import { renderSite } from '../src/site.ts';

/**
 * Holding days back, and the thing that must survive it.
 *
 * The freeze exists so a day can be read before it is shipped: set
 * `frozenThrough` in `publication.json` and the site stops at that day. The
 * obvious behaviour -- fewer pages -- is easy and is checked first.
 *
 * The behaviour worth a test is the one that is invisible. `select` will not
 * choose today's writers without knowing who wrote on the days before, so the
 * rota has to advance for every day the village *lived*, not for every day the
 * site *published*. If it advanced only over published days, lifting a freeze
 * would hand the next day a different set of writers than it would have had --
 * and nothing on the site would look wrong, because both versions are
 * internally consistent. The archive would just quietly be a different archive.
 *
 * So the same run is read twice, once frozen and once open, and the writers on
 * the days both of them publish have to match person for person. `frozenThrough`
 * can only hold back a suffix, though, which makes that comparison weaker than
 * it looks -- see `Holed` below for the test that actually pins the ordering.
 */

const DAYS = 8;
const FROZEN_AT = 4;
const SEED = 'world-zero';

let root: string;
let archive: string;
let annals: string;
let open: Village;
let held: Village;
let frozenKey: string;

/** The wording file as shipped, with the freeze moved. */
const publicationFrozenTo = (through: string | null): Publication =>
  new Publication({ ...loadPublication().config, frozenThrough: through });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'press-freeze-'));
  archive = join(root, 'archive');
  annals = join(root, 'annals');

  const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(sim(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive])).toBe(0);
    expect(sim(['annals', '--archive', archive, '--annals', annals])).toBe(0);
  } finally {
    quiet.mockRestore();
  }

  open = readVillage({ archive, annals, publication: publicationFrozenTo(null) });
  frozenKey = open.issues[FROZEN_AT - 1]?.day.key as string;
  held = readVillage({ archive, annals, publication: publicationFrozenTo(frozenKey) });
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('holding days back', () => {
  it('publishes every day when nothing is frozen', () => {
    expect(open.issues).toHaveLength(DAYS);
  });

  it('stops at the frozen day', () => {
    expect(held.issues).toHaveLength(FROZEN_AT);
    expect(held.issues[FROZEN_AT - 1]?.day.key).toBe(frozenKey);
  });

  it('writes no page for a day it is holding back', () => {
    const paths = new Set(
      renderSite({
        publication: publicationFrozenTo(frozenKey),
        village: held,
        latest: latestOf(held),
        today: villageDate(latestOf(held).day.key, held.calendar),
      }).map((built) => built.path),
    );
    for (let at = 0; at < DAYS; at += 1) {
      const key = open.issues[at]?.day.key as string;
      const wanted = at < FROZEN_AT;
      expect(paths.has(`paper/${key}.html`), key).toBe(wanted);
      expect(paths.has(`blog/${key}.html`), key).toBe(wanted);
    }
  });

  it('calls the newest published day today, not the newest day that exists', () => {
    expect(latestOf(held).day.key).toBe(frozenKey);
    expect(latestOf(open).day.key).toBe(open.issues[DAYS - 1]?.day.key);
    expect(latestOf(held).day.key).not.toBe(latestOf(open).day.key);
  });

  it('refuses to publish nothing at all', () => {
    // A freeze set before the village began is a typo, not a request for an
    // empty site, and an empty site has no `today` for its pages to print.
    expect(() =>
      readVillage({ archive, annals, publication: publicationFrozenTo('1199-12-30') }),
    ).toThrow(SimAssertionError);
  });
});

/**
 * A publication that holds back one day in the middle and publishes the rest.
 *
 * `frozenThrough` can only ever hold back a suffix, so under the shipped rule
 * no published day is ever preceded by a held one and the ordering inside
 * `readVillage` -- advance the rota, *then* decide whether to publish -- cannot
 * be observed from the outside. That makes the ordering the kind of correctness
 * that rots: a second reason to skip a day, added years from now, would break
 * the rota silently and every page would still look internally consistent.
 *
 * So the gap is made observable here on purpose. This is the only test in the
 * suite that reaches past the shipped rule, and it is the reason the push sits
 * above the `continue` rather than below it.
 */
class Holed extends Publication {
  constructor(
    config: Publication['config'],
    private readonly skip: string,
  ) {
    super(config);
  }

  override publishes(key: string): boolean {
    return key !== this.skip;
  }
}

describe('the rota under a freeze', () => {
  it('chooses the same writers for a day whether or not later days are held', () => {
    for (let at = 0; at < FROZEN_AT; at += 1) {
      const key = open.issues[at]?.day.key as string;
      expect(held.issues[at]?.day.key).toBe(key);
      expect(postersOf(held.issues[at]?.edition as never), key).toEqual(
        postersOf(open.issues[at]?.edition as never),
      );
    }
  });

  it('advances the rota over a day it does not publish', () => {
    const skipped = open.issues[2]?.day.key as string;
    const holed = readVillage({
      archive,
      annals,
      publication: new Holed(loadPublication().config, skipped),
    });

    expect(holed.issues).toHaveLength(DAYS - 1);
    expect(holed.issues.map((issue) => issue.day.key)).not.toContain(skipped);

    // Every day the hole did not swallow must have the writers it would have
    // had. If the unpublished day failed to advance the rota, every day after
    // it gets somebody else's turn.
    const kept = open.issues.filter((issue) => issue.day.key !== skipped);
    for (let at = 0; at < kept.length; at += 1) {
      const key = kept[at]?.day.key as string;
      expect(holed.issues[at]?.day.key).toBe(key);
      expect(postersOf(holed.issues[at]?.edition as never), key).toEqual(
        postersOf(kept[at]?.edition as never),
      );
    }
  });

  it('does not let the same person write every day, so the rota is doing work', () => {
    // Guards the tests above from being vacuous: if the rota picked the same
    // people regardless of history, every comparison here would pass trivially.
    const rotas = open.issues.map((issue) => postersOf(issue.edition).join(','));
    expect(new Set(rotas).size).toBeGreaterThan(1);
    expect(open.issues.every((issue) => postersOf(issue.edition).length > 0)).toBe(true);
  });

  it('writes the posts of a published day from that day only', () => {
    for (const issue of held.issues) {
      for (const post of issue.posts) {
        expect(post.day, post.author.slug).toBe(issue.day.key);
      }
    }
  });
});
