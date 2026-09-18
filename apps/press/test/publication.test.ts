import { describe, expect, it } from 'vitest';
import { SimAssertionError } from '@rpgsim/shared';
import { DEFAULT_CALENDAR } from '@rpgsim/sim-core';
import { Publication, PublicationSchema, partsOf, villageDate } from '../src/publication.ts';
import { loadPublication } from '../src/data.ts';

/**
 * The wording file and the calendar the site reads it against.
 *
 * Two different things are checked here and they fail in different ways. A
 * malformed `publication.json` should stop the build loudly, which is easy. A
 * *well-formed* file that names an illustration nobody shipped should also stop
 * the build, which is the part that needs a test, because the failure otherwise
 * appears as a broken image on one page months later.
 *
 * The dates matter more than they look. `villageDate` re-derives the day index
 * rather than calling `dateTimeToTick`, which refuses years before the calendar
 * epoch -- and the village opened with people in their seventies, so every one
 * of their birthdays is on the wrong side of that refusal. A test for a
 * pre-epoch birthday is therefore a regression test, not a curiosity.
 */

const bare = {
  masthead: 'The Pennycroft Chronicle',
  tagline: 'A simulation',
  firstVillageDay: '1200-04-01',
  firstPublished: '2026-09-18',
  daysAtFirstPublished: 30,
  images: [{ name: 'hero', alt: 'A village', caption: 'The village', width: 1600, height: 900 }],
  pages: Object.fromEntries(
    ['home', 'towne', 'people', 'paper', 'blog', 'about'].map((name) => [
      name,
      { title: name, lead: 'A lead.' },
    ]),
  ),
  footer: ['A footer.'],
};

const parse = (extra: Record<string, unknown> = {}) => PublicationSchema.parse({ ...bare, ...extra });

describe('the wording file, as a shape', () => {
  it('accepts the smallest complete file', () => {
    const config = parse();
    expect(config.frozenThrough).toBeNull();
    expect(config.pages.home.sections).toEqual([]);
  });

  it('refuses an empty heading or an empty paragraph', () => {
    // Either renders as a hole in the page that nothing else would notice.
    expect(() => parse({ footer: [''] })).toThrow();
    expect(() =>
      parse({
        pages: { ...bare.pages, home: { title: 'Home', lead: 'x', sections: [{ heading: '', body: ['x'] }] } },
      }),
    ).toThrow();
  });

  it('refuses a section with no paragraphs at all', () => {
    expect(() =>
      parse({
        pages: { ...bare.pages, home: { title: 'Home', lead: 'x', sections: [{ heading: 'h', body: [] }] } },
      }),
    ).toThrow();
  });

  it('refuses a file with no illustrations and a page set with a hole in it', () => {
    expect(() => parse({ images: [] })).toThrow();
    const { about: _about, ...missing } = bare.pages as Record<string, unknown>;
    expect(() => parse({ pages: missing })).toThrow();
  });

  it('refuses a day key that is not a day key', () => {
    expect(() => parse({ frozenThrough: 'yesterday' })).toThrow();
    expect(() => parse({ firstVillageDay: '1200-4-1' })).toThrow();
  });

  it('refuses an illustration name that could not be a file stem', () => {
    expect(() => parse({ images: [{ name: 'Hero Shot', alt: 'a', caption: 'b' }] })).toThrow();
  });

  it('keeps the note keys out of the parsed config, so they can never render', () => {
    const config = PublicationSchema.parse({ ...bare, unexpected: 'ignored' }) as Record<string, unknown>;
    expect(config.unexpected).toBeUndefined();
  });
});

describe('the wording file, as prose the pages ask for', () => {
  it('hands back the illustration a page names', () => {
    const publication = new Publication(parse());
    expect(publication.image('hero').alt).toBe('A village');
  });

  it('fails at construction when a section names an illustration nobody shipped', () => {
    const config = parse({
      pages: {
        ...bare.pages,
        about: { title: 'About', lead: 'x', sections: [{ heading: 'h', body: ['x'], image: 'boar' }] },
      },
    });
    expect(() => new Publication(config)).toThrow(SimAssertionError);
  });

  it('checks every page, not only the first', () => {
    // The about page is the last one anybody reads and the likeliest place for
    // a typo to sit unnoticed, so the check has to cover all six at once.
    const config = parse({
      pages: {
        ...bare.pages,
        blog: { title: 'Blog', lead: 'x', sections: [{ heading: 'h', body: ['x'], image: 'hero' }] },
        about: { title: 'About', lead: 'x', sections: [{ heading: 'h', body: ['x'], image: 'nope' }] },
      },
    });
    expect(() => new Publication(config)).toThrow(/illustration that is not listed/);
  });

  it('refuses two illustrations with the same name', () => {
    const config = parse({
      images: [
        { name: 'hero', alt: 'a', caption: 'b', width: 1600, height: 900 },
        { name: 'hero', alt: 'c', caption: 'd', width: 1600, height: 900 },
      ],
    });
    expect(() => new Publication(config)).toThrow(/share a name/);
  });

  it('fails loudly rather than rendering an image with no file behind it', () => {
    const publication = new Publication(parse());
    expect(() => publication.image('quarrel')).toThrow(SimAssertionError);
  });
});

describe('the freeze', () => {
  it('publishes everything when nothing is held back', () => {
    const open = new Publication(parse());
    expect(open.publishes('1200-04-01')).toBe(true);
    expect(open.publishes('9999-12-30')).toBe(true);
  });

  it('publishes up to and including the frozen day, and nothing after', () => {
    const held = new Publication(parse({ frozenThrough: '1200-04-10' }));
    expect(held.publishes('1200-04-09')).toBe(true);
    expect(held.publishes('1200-04-10')).toBe(true);
    expect(held.publishes('1200-04-11')).toBe(false);
  });

  it('compares day keys in the order they sort, across a year boundary', () => {
    const held = new Publication(parse({ frozenThrough: '1200-12-30' }));
    expect(held.publishes('1200-12-30')).toBe(true);
    expect(held.publishes('1201-01-01')).toBe(false);
  });
});

describe('saying a day out loud', () => {
  it('splits a key into numbers', () => {
    expect(partsOf('1200-04-30')).toEqual({ year: 1200, month: 4, day: 30 });
  });

  it('refuses anything that is not a key', () => {
    for (const bad of ['', '1200-04', 'Blossom 30', '1200-04-30 ', '120-04-30']) {
      expect(() => partsOf(bad), bad).toThrow(SimAssertionError);
    }
  });

  it('uses the calendar of the village rather than the months of this world', () => {
    const when = villageDate('1200-04-30');
    expect(when.monthName).toBe('Blossom');
    expect(when.long).toBe('Blossom 30, in the year of our Lord 1200');
    expect(when.short).toBe('Blossom 30, 1200');
    expect(when.full).toBe(`${when.weekday}, ${when.long}`);
    expect(when.season).toBe(DEFAULT_CALENDAR.months[3]?.season);
  });

  it('renames a month on every page at once when the calendar renames it', () => {
    const renamed = {
      ...DEFAULT_CALENDAR,
      months: DEFAULT_CALENDAR.months.map((month, at) => (at === 3 ? { ...month, name: 'Maytide' } : month)),
    };
    expect(villageDate('1200-04-30', renamed).long).toContain('Maytide 30');
  });

  it('walks the weekdays in order and wraps at the end of the week', () => {
    const week = DEFAULT_CALENDAR.weekdayNames.length;
    const days = Array.from({ length: week + 1 }, (_, at) =>
      villageDate(`1200-04-${String(at + 1).padStart(2, '0')}`).weekday,
    );
    expect(new Set(days.slice(0, week)).size).toBe(week);
    expect(days[week]).toBe(days[0]);
  });

  it('counts the days of each month rather than assuming they are equal', () => {
    // Every month in this calendar is 30 days, so an implementation that
    // multiplied would pass -- until a month is retuned. Check the sum.
    const first = villageDate('1200-01-01');
    const second = villageDate('1200-02-01');
    const stride = DEFAULT_CALENDAR.months[0]?.days ?? 0;
    const week = DEFAULT_CALENDAR.weekdayNames.length;
    const from = DEFAULT_CALENDAR.weekdayNames.indexOf(first.weekday);
    expect(DEFAULT_CALENDAR.weekdayNames.indexOf(second.weekday)).toBe((from + stride) % week);
  });

  it('places a birthday decades before the calendar epoch', () => {
    // Regression: `dateTimeToTick` asserts the year is at or after the epoch,
    // which is right for the simulation and fatal for a person page, because
    // the village opened with people in their seventies.
    const born = villageDate('1157-11-17');
    expect(born.year).toBe(1157);
    expect(born.long).toBe('Dimming 17, in the year of our Lord 1157');
    expect(DEFAULT_CALENDAR.weekdayNames).toContain(born.weekday);
  });

  it('gives a real weekday for every pre-epoch year it is asked about', () => {
    for (let year = 1120; year < 1200; year += 1) {
      const when = villageDate(`${year}-01-01`);
      expect(DEFAULT_CALENDAR.weekdayNames, String(year)).toContain(when.weekday);
    }
  });

  it('refuses a month or a day the calendar does not have', () => {
    expect(() => villageDate('1200-13-01')).toThrow(/month is outside the calendar/);
    expect(() => villageDate('1200-00-01')).toThrow(/month is outside the calendar/);
    expect(() => villageDate('1200-04-31')).toThrow(/day is outside the month/);
    expect(() => villageDate('1200-04-00')).toThrow(/day is outside the month/);
  });
});

describe('the wording file on disk', () => {
  const publication = loadPublication();

  it('loads, and every page in it is complete enough to render', () => {
    for (const [name, page] of Object.entries(publication.config.pages)) {
      expect(page.title.length, name).toBeGreaterThan(0);
      expect(page.lead.length, name).toBeGreaterThan(0);
    }
  });

  it('names an illustration for every picture the pages ask for', () => {
    for (const page of Object.values(publication.config.pages)) {
      for (const section of page.sections) {
        if (section.image === undefined) continue;
        expect(publication.image(section.image).name).toBe(section.image);
      }
    }
  });

  it('starts on the village day the simulation starts on', () => {
    expect(publication.config.firstVillageDay).toBe('1200-04-01');
  });

  it('names each illustration once', () => {
    // Whether each of them is actually used is a question about the generated
    // site rather than about the file, and `site.test.ts` asks it there.
    const names = publication.config.images.map((image) => image.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });
});
