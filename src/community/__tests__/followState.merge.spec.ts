import { describe, expect, it } from 'vitest';
import { mergeFollowStatusUpdates } from '../followState';

describe('community follow-status refresh merging', () => {
  it('preserves authors from earlier pages and applies refreshed statuses', () => {
    const firstPage = { authorA: true, authorB: false };
    const refreshedPage = { authorB: true, authorC: false };

    const { next, changed } = mergeFollowStatusUpdates(firstPage, refreshedPage);

    expect(changed).toBe(true);
    expect(next).toEqual({ authorA: true, authorB: true, authorC: false });
  });

  it('does not report a change for an identical update', () => {
    const { next, changed } = mergeFollowStatusUpdates({ authorA: false }, { authorA: false });

    expect(changed).toBe(false);
    expect(next).toEqual({ authorA: false });
  });
});
