import { toSkipTake, buildMeta, DEFAULT_LIMIT, MAX_LIMIT } from '../src/utils/pagination';

/**
 * FR-07. The contract these pin is the one that was actually missing: a real `total`. Before this,
 * /notifications reported `total: notifications.length` — always exactly the page size — so a client
 * could never discover that more pages existed. Everything else returned unbounded arrays.
 */

describe('toSkipTake', () => {
  it('defaults to the first page with the default limit', () => {
    expect(toSkipTake({})).toEqual({ skip: 0, take: DEFAULT_LIMIT, page: 1, limit: DEFAULT_LIMIT });
  });

  it('translates page/limit into skip/take', () => {
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10, page: 3, limit: 10 });
  });

  it('coerces numeric strings, since query params arrive as strings', () => {
    expect(toSkipTake({ page: '2', limit: '5' })).toEqual({ skip: 5, take: 5, page: 2, limit: 5 });
  });

  it('caps limit so an unbounded ?limit=100000 can never reach the database', () => {
    expect(toSkipTake({ limit: 100000 }).take).toBe(DEFAULT_LIMIT);
    expect(toSkipTake({ limit: MAX_LIMIT }).take).toBe(MAX_LIMIT);
  });

  it('falls back to safe defaults for junk input rather than throwing', () => {
    expect(toSkipTake({ page: 'abc', limit: -5 })).toEqual({
      skip: 0,
      take: DEFAULT_LIMIT,
      page: 1,
      limit: DEFAULT_LIMIT,
    });
  });

  it('lets a caller raise the default without letting the client exceed the cap', () => {
    // The achievements catalog opts into a higher default so its grid is not truncated.
    expect(toSkipTake({ limit: MAX_LIMIT }).take).toBe(MAX_LIMIT);
    expect(toSkipTake({ limit: MAX_LIMIT, ...{ limit: 5 } }).take).toBe(5);
  });
});

describe('buildMeta', () => {
  it('reports total pages and hasMore from a real total', () => {
    expect(buildMeta(45, 1, 20)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasMore: true,
    });
  });

  it('marks the last page as having no more', () => {
    expect(buildMeta(45, 3, 20).hasMore).toBe(false);
  });

  it('never reports zero pages for an empty list', () => {
    expect(buildMeta(0, 1, 20)).toMatchObject({ totalPages: 1, hasMore: false, total: 0 });
  });

  it('distinguishes a full page from a full result set — the bug this replaces', () => {
    // 20 rows returned on page 1 of 100 total: hasMore MUST be true. The old
    // `total: notifications.length` made this indistinguishable from "that is everything".
    expect(buildMeta(100, 1, 20).hasMore).toBe(true);
    expect(buildMeta(20, 1, 20).hasMore).toBe(false);
  });
});
