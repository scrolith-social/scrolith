import { describe, expect, it } from 'vitest';
import { mergeStorySnapshot } from '../storyState';

describe('mergeStorySnapshot', () => {
  it('updates the open matching story and preserves existing interaction fields', () => {
    const current: {
      id: string;
      caption: string;
      interactions: Record<string, unknown>;
    } = {
      id: 'story-1',
      caption: 'before',
      interactions: { likes: 2, comments: 1 }
    };

    expect(
      mergeStorySnapshot(current, {
        id: 'story-1',
        caption: 'after',
        interactions: { comments: 3, shares: 1 }
      })
    ).toEqual({
      id: 'story-1',
      caption: 'after',
      interactions: { likes: 2, comments: 3, shares: 1 }
    });
  });

  it('leaves a different open story unchanged', () => {
    const current = { id: 'story-1', caption: 'still open' };
    expect(mergeStorySnapshot(current, { id: 'story-2', caption: 'other' })).toBe(current);
  });
});
