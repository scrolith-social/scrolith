type StorySnapshot = {
  id: string | number;
  interactions?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/** Merge a server update into the matching open story snapshot. */
export const mergeStorySnapshot = <T extends StorySnapshot>(
  current: T | null,
  updated: Partial<T> & Pick<T, 'id'>
): T | null => {
  if (!current || current.id !== updated.id) return current;

  return {
    ...current,
    ...updated,
    interactions: {
      ...(current.interactions || {}),
      ...(updated.interactions || {})
    }
  } as T;
};
