import { evaluateLoginDevice, registerTrustedDevice, type LoginDeviceMetadata } from './loginApproval.service';
import { issueAuthSessionToken } from './authSession.service';

export type PasskeyLoginApprovalContext = {
  device: LoginDeviceMetadata;
  request: { ip?: string | null; userAgent?: string | null };
};

export const finishPasskeyLoginAfterMfa = async (
  user: { id: string; authSessionVersion: number },
  context: PasskeyLoginApprovalContext
) => {
  const approval = await evaluateLoginDevice(
    user.id,
    Number(user.authSessionVersion),
    context.device,
    context.request
  );
  if (approval.required) {
    return {
      requiresLoginApproval: true as const,
      loginApproval: {
        id: approval.attemptId,
        approvalToken: approval.approvalToken,
        expiresAt: approval.expiresAt.toISOString()
      }
    };
  }

  if (!('bypassed' in approval)) await registerTrustedDevice(user.id, context.device);
  const token = await issueAuthSessionToken(user.id, Number(user.authSessionVersion));
  return { token, requiresLoginApproval: false as const };
};
