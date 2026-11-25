import type { User } from '../types';
import { resolveUserAvatarUrl } from '../utils/userAvatar';

const STORAGE_KEY = 'scrolith:remembered-profiles:v2';
const LEGACY_STORAGE_KEY = 'scrolith:remembered-profiles:v1';
const CONSENT_KEY = 'scrolith:remember-profile-consent:v1';
const CONSENT_TTL_MS = 10 * 60 * 1000;
const MAX_PROFILES = 3;
const FEATURE_ENV = String(import.meta.env?.VITE_RETAINED_PROFILE_SWITCHER || '').toLowerCase();

export type RememberedProfile = {
  version: 1;
  userId: string;
  displayName: string;
  avatarUrl?: string;
};

export const retainedProfileSwitcherEnabled = () => FEATURE_ENV !== 'false' && FEATURE_ENV !== '0';

const read = (): RememberedProfile[] => {
  if (typeof window === 'undefined' || !retainedProfileSwitcherEnabled()) return [];
  try {
    // Entries from v1 were created without explicit opt-in; remove them rather
    // than silently migrating personal account labels into the opt-in feature.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const profiles = parsed
      .filter((entry) => entry && typeof entry === 'object' && String(entry.userId || '').trim())
      .map((entry) => ({
        version: 1 as const,
        userId: String(entry.userId).trim(),
        displayName: String(entry.displayName || 'Scrolith member').trim().slice(0, 120),
        avatarUrl: String(entry.avatarUrl || '').trim().slice(0, 1000) || undefined
      }))
      .slice(0, MAX_PROFILES);
    // Rewrite only the approved display fields so old or manually added values
    // such as emails, passwords, or tokens are not retained in this key.
    const sanitized = JSON.stringify(profiles);
    if (window.localStorage.getItem(STORAGE_KEY) !== sanitized) {
      window.localStorage.setItem(STORAGE_KEY, sanitized);
    }
    return profiles;
  } catch {
    return [];
  }
};

const write = (profiles: RememberedProfile[]) => {
  if (typeof window === 'undefined' || !retainedProfileSwitcherEnabled()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.slice(0, MAX_PROFILES)));
    window.dispatchEvent(new CustomEvent('scrolith:remembered-profiles-changed'));
  } catch {
    // Private browsing/storage quotas must never affect authentication.
  }
};

export const getRememberedProfiles = () => read();

export const setRememberProfileConsent = (enabled: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    if (!enabled) {
      window.sessionStorage.removeItem(CONSENT_KEY);
      return;
    }
    window.sessionStorage.setItem(CONSENT_KEY, String(Date.now()));
  } catch {
    // Remembering is optional and never affects sign-in.
  }
};

const consumeRememberProfileConsent = () => {
  if (typeof window === 'undefined') return false;
  try {
    const savedAt = Number(window.sessionStorage.getItem(CONSENT_KEY));
    window.sessionStorage.removeItem(CONSENT_KEY);
    return Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt <= CONSENT_TTL_MS;
  } catch {
    return false;
  }
};

export const rememberAuthenticatedProfile = (user?: Partial<User> | null) => {
  const userId = String(user?.id || '').trim();
  if (!userId || !retainedProfileSwitcherEnabled() || !consumeRememberProfileConsent()) return;
  const profile: RememberedProfile = {
    version: 1,
    userId,
    displayName: String(user?.name || user?.username || 'Scrolith member').trim().slice(0, 120),
    avatarUrl: resolveUserAvatarUrl(user) || undefined
  };
  const next = [profile, ...read().filter((entry) => entry.userId !== userId)];
  write(next);
};

export const removeRememberedProfile = (userId: string) => {
  const normalized = String(userId || '').trim();
  if (!normalized) return;
  write(read().filter((entry) => entry.userId !== normalized));
};

export const clearRememberedProfiles = () => write([]);

export const initialsForRememberedProfile = (profile: Pick<RememberedProfile, 'displayName'>) =>
  profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S';
