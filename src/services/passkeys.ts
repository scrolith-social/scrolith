import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import api from './api';
import { tokenStore } from './tokenStore';
import type { User } from '../types';
import { rememberAuthenticatedProfile } from './rememberedProfiles';
import { getDeviceMetadata } from './deviceSecurity';
import { isPasskeyBrowserAvailable } from './passkeyAvailability';

export type PasskeyRecord = {
  id: string;
  label: string;
  deviceType?: string | null;
  backedUp?: boolean;
  transports?: string[];
  createdAt?: string;
  lastUsedAt?: string | null;
};

const isEnabled = () => String(import.meta.env.VITE_PASSKEYS_ENABLED || '').toLowerCase() === 'true';
const browserSupportsPasskeys = () =>
  typeof window !== 'undefined' &&
  isPasskeyBrowserAvailable({
    publicKeyCredentialAvailable: typeof window.PublicKeyCredential !== 'undefined',
    secureContext: typeof navigator !== 'undefined' && window.isSecureContext === true
  });

const unwrap = <T,>(response: any): T => {
  if (response?.data?.data !== undefined) return response.data.data as T;
  return response?.data as T;
};

const errorMessage = (error: any, fallback: string) =>
  error?.response?.data?.error || error?.response?.data?.message || error?.message || fallback;

export const passkeySupport = {
  enabled: isEnabled,
  available: () => isEnabled() && browserSupportsPasskeys(),
  browserSupported: browserSupportsPasskeys,
};

export const PasskeyService = {
  async register(label: string, currentPassword?: string) {
    if (!passkeySupport.available()) throw new Error('Passkeys are not enabled on this device.');
    const optionsResponse = await api.post('/auth/passkeys/registration/options', {
      label: label.trim() || 'Scrolith passkey',
      currentPassword: currentPassword || undefined,
      platform: 'web',
    });
    const optionsPayload = {
      data: optionsResponse?.data?.data,
      challengeId: String(optionsResponse?.data?.challengeId || ''),
    };
    const credential: RegistrationResponseJSON = await startRegistration({
      optionsJSON: optionsPayload.data,
    });
    await api.post('/auth/passkeys/registration/verify', {
      challengeId: optionsPayload.challengeId,
      response: credential,
      label: label.trim() || 'Scrolith passkey',
      platform: 'web',
    });
    return true;
  },

  async authenticate(email?: string, options: { humanVerificationToken?: string | null; expectedUserId?: string } = {}) {
    if (!passkeySupport.available()) throw new Error('Passkeys are not enabled on this device.');
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const device = await getDeviceMetadata();
    const optionsResponse = await api.post('/auth/passkeys/authentication/options', {
      platform: 'web',
      device,
      humanVerificationToken: options.humanVerificationToken || undefined,
      expectedUserId: options.expectedUserId || undefined,
      ...(normalizedEmail ? { email: normalizedEmail } : {})
    });
    const optionsPayload = {
      data: optionsResponse?.data?.data,
      challengeId: String(optionsResponse?.data?.challengeId || ''),
    };
    const credential: AuthenticationResponseJSON = await startAuthentication({
      optionsJSON: optionsPayload.data,
    });
    const verifiedResponse = await api.post('/auth/passkeys/authentication/verify', {
      challengeId: optionsPayload.challengeId,
      response: credential,
      platform: 'web'
    });
    const payload = verifiedResponse?.data || {};
    if (payload?.requires2FA || payload?.code === '2FA_REQUIRED') {
      return {
        requires2FA: true as const,
        challengeToken: String(payload?.challengeToken || payload?.challenge_token || ''),
        message: String(payload?.message || 'Authenticator verification is required.')
      };
    }
    if (payload?.requiresLoginApproval || payload?.code === 'LOGIN_APPROVAL_REQUIRED') {
      return {
        requiresLoginApproval: true as const,
        loginApproval: payload?.loginApproval || payload?.login_approval,
        message: String(payload?.message || 'Approve this login from an existing trusted session.')
      };
    }
    const user = payload?.user as User | undefined;
    const token = payload?.token || payload?.accessToken;
    if (!user || !token) throw new Error('Passkey sign-in did not return a valid session.');
    if (options.expectedUserId && String(user.id) !== options.expectedUserId) {
      throw new Error('The authenticated account did not match the selected account.');
    }
    await tokenStore.setSessionOnly(token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    try {
      localStorage.setItem('user', JSON.stringify(user));
    } catch {
      // Storage may be unavailable in private browsing; the API session remains usable.
    }
    rememberAuthenticatedProfile(user);
    return { user, token };
  },

  async list() {
    const response = await api.get('/auth/passkeys');
    return unwrap<PasskeyRecord[]>(response) || [];
  },

  async rename(id: string, label: string) {
    await api.patch(`/auth/passkeys/${encodeURIComponent(id)}`, { label: label.trim() });
  },

  async revoke(id: string, currentPassword?: string) {
    await api.delete(`/auth/passkeys/${encodeURIComponent(id)}`, {
      data: { currentPassword: currentPassword || undefined }
    });
  },

  getErrorMessage(error: unknown, fallback = 'Passkey operation failed.') {
    const typedError = error as any;
    const name = String(typedError?.name || '').trim();
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return 'No matching Scrolith passkey was selected. If you have not added one yet, sign in with your password first, then open Settings > Passkeys to add this device.';
    }
    if (name === 'InvalidStateError') {
      return 'This device could not use the selected passkey. Try another passkey or add this device again from Settings > Passkeys.';
    }
    return errorMessage(error, fallback);
  },
};
