export type PasskeyBrowserCapabilities = {
  publicKeyCredentialAvailable: boolean;
  secureContext: boolean;
};

export const isPasskeyBrowserAvailable = ({ publicKeyCredentialAvailable, secureContext }: PasskeyBrowserCapabilities) =>
  publicKeyCredentialAvailable && secureContext === true;

export const isPasskeyCancellation = (error: unknown) => {
  const name = String((error as any)?.name || '');
  return name === 'NotAllowedError' || name === 'AbortError';
};
