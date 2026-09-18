import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnnalsStore,
  Casting,
  Community,
  PersonaBook,
  PortraitCatalog,
  portraitSexOf,
  yearsBetween,
  type PersonRecord,
} from '@rpgsim/chronicle';
import { main } from '../src/index.ts';
import { loadCasting, loadCommunity, loadPersonas, loadPortraits } from '../src/data.ts';

/**
 * The press-side files, against the village they describe.
 *
 * Everything in `data/chronicle/` is written by hand and keyed by slug, and
 * every way it can be wrong is silent: a misspelled slug shows nothing on the
 * page, a face cast twice puts one villager's head on two people, a persona for
 * somebody who does not exist is never noticed at all. None of those break a
 * build. So the record is rebuilt from the seed here and the files are checked
 * against it, which is the only moment the two can be compared.
 *
 * The world is the default one — seed `world-zero` — because that is the world
 * these files were written for. If the seed or the generator changes, these
 * tests fail, and that failure is correct: the casting would be describing a
 * village that no longer exists.
 */

const SEED = 'world-zero';
const DAYS = 2;

let directory: string;
let restoreConsole: () => void;
let people: readonly PersonRecord[];
let on: string;

function silenceConsole(): () => void {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return () => {
    log.mockRestore();
    error.mockRestore();
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-cast-'));
  restoreConsole = silenceConsole();

  const archive = join(directory, 'archive');
  const record = join(directory, 'record');
  expect(
    main(['run', '--seed', SEED, '--days', String(DAYS), '--every', '0', '--archive', archive]),
  ).toBe(0);
  expect(main(['annals', '--archive', archive, '--annals', record])).toBe(0);

  const store = new AnnalsStore({ root: record });
  people = store.people.records();
  on = store.lastDate as string;
});

afterEach(() => {
  restoreConsole();
  rmSync(directory, { recursive: true, force: true });
});

const catalog = () => new PortraitCatalog(loadPortraits());
const slugsOf = () => people.map((person) => person.slug);

describe('the portrait sheets on disk', () => {
  it('load, and every sheet is a full eight by five', () => {
    const sheets = loadPortraits();
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(Object.keys(sheet.cells)).toHaveLength(40);
    }
    expect(catalog().size).toBe(sheets.length * 40);
  });

  it('gives every face an id nothing else claims', () => {
    // The catalog asserts this itself; naming it here is what makes the reason
    // for that assertion survive somebody deleting it.
    const ids = catalog().all().map((portrait) => portrait.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the record this village actually produced', () => {
  it('holds a village worth of people with slugs, sexes and birth dates', () => {
    expect(people.length).toBeGreaterThan(50);
    expect(new Set(slugsOf()).size).toBe(people.length);
    for (const person of people) {
      expect(person.slug).toMatch(/^[a-z0-9-]+$/);
      expect(() => portraitSexOf(person.sex)).not.toThrow();
      expect(person.born).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('the casting, against that record', () => {
  it('casts only people the record holds', () => {
    const known = new Set(slugsOf());
    const strangers = new Casting(loadCasting()).slugs().filter((slug) => !known.has(slug));
    expect(strangers).toEqual([]);
  });

  it('points only at faces that exist', () => {
    const faces = catalog();
    const missing = new Casting(loadCasting())
      .portraitsUsed()
      .filter((id) => !faces.has(id));
    expect(missing).toEqual([]);
  });

  it('never puts one face on two people', () => {
    const casting = new Casting(loadCasting());
    const worn = new Map<string, string>();
    for (const slug of casting.slugs()) {
      const id = casting.portraitFor(slug, on);
      if (id === undefined) continue;
      expect(worn.get(id), `${id} is worn by ${worn.get(id) ?? ''} and ${slug}`).toBeUndefined();
      worn.set(id, slug);
    }
  });

  it('puts nobody in a face of the wrong sex or the wrong life stage', () => {
    const report = new Casting(loadCasting()).report(people, catalog(), on);
    expect(report.mismatched).toEqual([]);
  });

  it('casts everybody there is a face for, and says so about the rest', () => {
    // Uncast people are allowed — a village gains people faster than anybody
    // draws them — but only when there is genuinely no free face that fits.
    // Anything else is a blank that should simply have been filled in.
    const casting = new Casting(loadCasting());
    const report = casting.report(people, catalog(), on);
    const proposals = casting.propose(people, catalog(), on);
    expect([...proposals.keys()]).toEqual([]);
    expect(report.cast + report.uncast.length).toBe(people.length);
  });

  it('names a life stage for every age anybody in the village is', () => {
    const casting = new Casting(loadCasting());
    const bands = new Set(loadCasting().bands.map((band) => band.name));
    for (const person of people) {
      expect(bands.has(casting.bandFor(yearsBetween(person.born, on)))).toBe(true);
    }
  });
});

describe('the personas, against that record', () => {
  it('gives every single villager a voice', () => {
    // Not "most of them": the blog picks who posts, and a villager with no
    // persona is one the publisher cannot use at all.
    expect(new PersonaBook(loadPersonas()).missingFor(slugsOf())).toEqual([]);
  });

  it('is written for nobody the record has never heard of', () => {
    expect(new PersonaBook(loadPersonas()).strayFor(slugsOf())).toEqual([]);
  });
});

describe('the community, against that record', () => {
  it('ties only people the record holds', () => {
    expect(new Community(loadCommunity()).strayFor(slugsOf())).toEqual([]);
  });

  it('names a family for every surname the village actually uses', () => {
    const village = new Community(loadCommunity());
    const surnames = [...new Set(people.map((person) => person.family).filter((f) => f !== null))];
    expect(surnames.length).toBeGreaterThan(0);
    const unnamed = surnames.filter((family) => village.findFamily(family as string) === undefined);
    expect(unnamed).toEqual([]);
  });

  it('describes no family the village does not have', () => {
    const surnames = new Set(people.map((person) => person.family));
    const strays = new Community(loadCommunity())
      .families()
      .map((family) => family.family)
      .filter((family) => !surnames.has(family));
    expect(strays).toEqual([]);
  });
});

describe('the cast command', () => {
  it('reports on the real files and finds nothing broken', () => {
    const record = join(directory, 'record');
    expect(main(['cast', '--annals', record])).toBe(0);
  });

  it('refuses to guess which record to check against', () => {
    expect(main(['cast'])).toBe(2);
  });

  it('fails plainly when the record is empty', () => {
    expect(main(['cast', '--annals', join(directory, 'nothing-here')])).toBe(1);
  });

  it('will check against any day it is given', () => {
    const record = join(directory, 'record');
    expect(main(['cast', '--annals', record, '--on', '1200-04-01'])).toBe(0);
  });
});
