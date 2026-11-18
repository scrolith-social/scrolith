jest.mock('../../../../utils/prismaClient', () => ({ __esModule: true, default: {} }));

import { isSkillMiniGameRewardGranted } from '../engagementExpansion.service';

describe('skill mini-game reward hard-off behavior', () => {
  const priorGate = process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;

  afterAll(() => {
    if (priorGate === undefined) delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    else process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = priorGate;
  });

  test('does not mark an earned reward as granted while the server money gate is off', () => {
    delete process.env.SCROLITH_MONEY_MOVEMENT_ENABLED;
    expect(isSkillMiniGameRewardGranted(true, 8)).toBe(false);
  });

  test('marks only positive correct rewards granted when the server gate is explicitly enabled', () => {
    process.env.SCROLITH_MONEY_MOVEMENT_ENABLED = 'true';
    expect(isSkillMiniGameRewardGranted(true, 8)).toBe(true);
    expect(isSkillMiniGameRewardGranted(false, 8)).toBe(false);
    expect(isSkillMiniGameRewardGranted(true, 0)).toBe(false);
  });
});
