const stableHash = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const normalizeSignal = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'INTERESTED' || normalized === 'NOT_INTERESTED' ? normalized : null;
};

/**
 * Mirror the production Scroll interest-survey eligibility and deterministic
 * ranking so the local fixture seeder can select a renderable feed item.
 */
export function pickCertificationInterestSurveyCandidateIds(
  items,
  viewerId,
  contentType = 'post',
  limit = 4
) {
  const normalizedViewerId = String(viewerId || '').trim();
  if (!normalizedViewerId) return [];
  const maxCount = Math.max(1, Math.min(12, Math.floor(Number(limit) || 4)));

  const eligible = (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      authorId: String(item?.authorId || '').trim(),
      signal: normalizeSignal(item?.initialSignal)
    }))
    .filter((item) => item.id && (!item.authorId || item.authorId !== normalizedViewerId) && !item.signal);

  return eligible
    .map((item) => ({
      id: item.id,
      hash: stableHash(`${normalizedViewerId}:${contentType}:${item.id}`)
    }))
    .sort((left, right) => left.hash - right.hash)
    .slice(0, maxCount)
    .map((item) => item.id);
}
