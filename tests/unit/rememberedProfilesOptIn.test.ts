import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRememberedProfiles,
  rememberAuthenticatedProfile,
  removeRememberedProfile,
  setRememberProfileConsent
} from '../../src/services/rememberedProfiles';
import { isPasskeyBrowserAvailable, isPasskeyCancellation } from '../../src/services/passkeyAvailability';
import { tokenStore } from '../../src/services/tokenStore';

const makeStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => { values.delete(key); }
  };
};

const withBrowserStorage = async (run: (storage: { localStorage: ReturnType<typeof makeStorage>; sessionStorage: ReturnType<typeof makeStorage> }) => void | Promise<void>) => {
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalSessionStorage = (globalThis as any).sessionStorage;
  const originalDocument = (globalThis as any).document;
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  (globalThis as any).localStorage = localStorage;
  (globalThis as any).sessionStorage = sessionStorage;
  (globalThis as any).document = { cookie: '' };
  (globalThis as any).window = {
    localStorage,
    sessionStorage,
    dispatchEvent: () => true
  };
  try {
    await run({ localStorage, sessionStorage });
    return { localStorage, sessionStorage };
  } finally {
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
    if (originalLocalStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = originalLocalStorage;
    if (originalSessionStorage === undefined) delete (globalThis as any).sessionStorage;
    else (globalThis as any).sessionStorage = originalSessionStorage;
    if (originalDocument === undefined) delete (globalThis as any).document;
    else (globalThis as any).document = originalDocument;
  }
};

test('account tiles are not written unless the user opted in', async () => {
  await withBrowserStorage(() => {
    rememberAuthenticatedProfile({ id: 'user-a', name: 'Synthetic User', email: 'private@example.invalid' } as any);
    assert.deepEqual(getRememberedProfiles(), []);
  });
});

test('explicit opt-in is one-time, session-scoped, and stores no credentials', async () => {
  const result = await withBrowserStorage(() => {
    setRememberProfileConsent(true);
    rememberAuthenticatedProfile({
      id: 'user-a', name: 'Synthetic User', username: 'synthetic',
      email: 'private@example.invalid', password: 'not-stored', accessToken: 'not-stored'
    } as any);
    assert.equal(sessionStorage.getItem('scrolith:remember-profile-consent:v1'), null);
    const profiles = getRememberedProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].displayName, 'Synthetic User');
    assert.equal(JSON.stringify(profiles).includes('private@example.invalid'), false);
    assert.equal(JSON.stringify(profiles).includes('not-stored'), false);
    assert.deepEqual(Object.keys(profiles[0]).sort(), ['avatarUrl', 'displayName', 'userId', 'version'].sort());
  });
  assert.equal(result?.sessionStorage.getItem('scrolith:remember-profile-consent:v1'), null);
});

test('unchecking opt-in clears the pending consent marker', async () => {
  await withBrowserStorage(() => {
    setRememberProfileConsent(true);
    setRememberProfileConsent(false);
    rememberAuthenticatedProfile({ id: 'user-b', name: 'No Consent' } as any);
    assert.deepEqual(getRememberedProfiles(), []);
  });
});

test('legacy implicit-remember tiles are removed instead of silently migrated', async () => {
  const result = await withBrowserStorage(() => {
    (globalThis as any).window.localStorage.setItem('scrolith:remembered-profiles:v1', '[{"userId":"old-user"}]');
    assert.deepEqual(getRememberedProfiles(), []);
  });
  assert.equal(result?.localStorage.getItem('scrolith:remembered-profiles:v1'), null);
});

test('stored tiles are rewritten to the allowed local display fields', async () => {
  const result = await withBrowserStorage(() => {
    const unsafe = [{
      userId: 'user-d', displayName: 'Synthetic D', avatarUrl: '/avatar.png',
      email: 'private@example.invalid', password: 'must-not-remain', token: 'must-not-remain',
      role: 'ADMIN', lastUsedAt: 'old'
    }];
    (globalThis as any).window.localStorage.setItem('scrolith:remembered-profiles:v2', JSON.stringify(unsafe));
    assert.equal(getRememberedProfiles()[0].displayName, 'Synthetic D');
  });
  const saved = result?.localStorage.getItem('scrolith:remembered-profiles:v2') || '';
  assert.equal(saved.includes('private@example.invalid'), false);
  assert.equal(saved.includes('must-not-remain'), false);
  assert.equal(saved.includes('ADMIN'), false);
  assert.equal(saved.includes('lastUsedAt'), false);
});

test('remembered account removal is local and does not create authentication', async () => {
  await withBrowserStorage(() => {
    setRememberProfileConsent(true);
    rememberAuthenticatedProfile({ id: 'user-c', name: 'Synthetic C' } as any);
    removeRememberedProfile('user-c');
    assert.deepEqual(getRememberedProfiles(), []);
  });
});

test('unsupported browsers and insecure origins keep passkeys unavailable', () => {
  assert.equal(isPasskeyBrowserAvailable({ publicKeyCredentialAvailable: false, secureContext: true }), false);
  assert.equal(isPasskeyBrowserAvailable({ publicKeyCredentialAvailable: true, secureContext: false }), false);
  assert.equal(isPasskeyBrowserAvailable({ publicKeyCredentialAvailable: true, secureContext: true }), true);
  assert.equal(isPasskeyBrowserAvailable({ publicKeyCredentialAvailable: true, secureContext: undefined as any }), false);
});

test('passkey sessions use tab-scoped storage and never persist the token in localStorage', async () => {
  await withBrowserStorage(async ({ localStorage, sessionStorage }) => {
    await tokenStore.clear();
    await tokenStore.setSessionOnly('synthetic-session-token');
    assert.equal(localStorage.getItem('token'), null);
    assert.equal(sessionStorage.getItem('token'), 'synthetic-session-token');
    assert.equal(await tokenStore.get(), 'synthetic-session-token');
    await tokenStore.clear();
  });
});

test('WebAuthn browser cancellation is classified without creating a session', () => {
  assert.equal(isPasskeyCancellation({ name: 'NotAllowedError' }), true);
  assert.equal(isPasskeyCancellation({ name: 'AbortError' }), true);
  assert.equal(isPasskeyCancellation({ name: 'SecurityError' }), false);
});
