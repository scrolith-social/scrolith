export {};

const mockUpdateAIConsent = jest.fn();

jest.mock('../../services/scrolithaAi', () => ({
  updateAIConsent: (...args: unknown[]) => mockUpdateAIConsent(...args)
}));

jest.mock('../../services/scrolithaAi/audit', () => ({
  writeAIAudit: jest.fn()
}));

import { aiPatchPreferences } from '../scrolithaAi.controller';

const createResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('aiPatchPreferences consent input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateAIConsent.mockResolvedValue({ aiFeaturesEnabled: false });
  });

  test.each(['false', 'true', 0, 1, null, {}, []])(
    'rejects a non-boolean consent value (%p) without writing consent',
    async (value) => {
      const req: any = {
        user: { id: 'synthetic-consent-user' },
        body: { aiFeaturesEnabled: value }
      };
      const res = createResponse();

      await aiPatchPreferences(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'invalid_preference_value',
        field: 'aiFeaturesEnabled'
      });
      expect(mockUpdateAIConsent).not.toHaveBeenCalled();
    }
  );

  test('persists an explicit boolean false without coercion', async () => {
    const req: any = {
      user: { id: 'synthetic-consent-user' },
      body: { aiFeaturesEnabled: false, aiSuggestionsAllowed: true }
    };
    const res = createResponse();

    await aiPatchPreferences(req, res);

    expect(mockUpdateAIConsent).toHaveBeenCalledWith('synthetic-consent-user', {
      aiFeaturesEnabled: false,
      aiSuggestionsAllowed: true
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { aiFeaturesEnabled: false } });
  });

  test.each([null, 'not-an-object', 42, []])('rejects malformed preference body %p', async (body) => {
    const req: any = { user: { id: 'synthetic-consent-user' }, body };
    const res = createResponse();

    await aiPatchPreferences(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUpdateAIConsent).not.toHaveBeenCalled();
  });
});
