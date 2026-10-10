import {
  acquireProviderAttempt,
  getCircuitSnapshot,
  recordProviderFailure,
  recordProviderSuccess
} from '../reliability';

describe('Scrolitha provider circuit recovery', () => {
  const provider = `TEST_PROVIDER_${Date.now()}_${Math.random()}` as any;

  afterEach(() => {
    recordProviderSuccess(provider);
    jest.useRealTimers();
  });

  test('permits one half-open recovery probe at a time', () => {
    jest.useFakeTimers();
    for (let i = 0; i < 5; i += 1) recordProviderFailure(provider);

    expect(acquireProviderAttempt(provider)).toBe(false);
    jest.advanceTimersByTime(60_001);

    expect(acquireProviderAttempt(provider)).toBe(true);
    expect(acquireProviderAttempt(provider)).toBe(false);
    expect(getCircuitSnapshot()[provider]).toMatchObject({
      open: false,
      halfOpen: true,
      halfOpenInFlight: true
    });

    recordProviderSuccess(provider);
    expect(acquireProviderAttempt(provider)).toBe(true);
  });
});
