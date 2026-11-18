# Money-movement hard-off

The API is fail-closed for money-moving actions unless the server process is
explicitly configured with `SCROLITH_MONEY_MOVEMENT_ENABLED=true`. The value is
read server-side; it is not a `VITE_*` setting and must never be sent to the
browser. The default (unset, empty, or anything other than `true`) is disabled.

This policy is separate from `SystemSettings.paymentTestMode` and
`SystemSettings.walletFundingEnabled`. Test/sandbox mode and provider
configuration do not enable the hard-off.

When disabled, the server rejects financial mutation routes and payment
callbacks with HTTP 503 and `MONEY_MOVEMENT_DISABLED`. This includes wallet and
Gcoin mutations, top-ups, payments, withdrawals, payouts, escrow, paid plan and
marketplace purchases, founding-partner enrollment/distribution, affiliate
withdrawals, and ad-payment flows. Read-only financial views and unrelated
social/account/content operations remain available. Shared wallet, Gcoin,
order-payment, plan-purchase, affiliate, founding-partner, and reconciliation
services also assert the policy so non-HTTP callers cannot bypass it. The
payment reconciliation worker is not scheduled while the policy is off.

Provider callbacks receive 503 while disabled so providers may retry after a
later authorized activation. This behavior must be considered when any pending
provider transaction exists; do not enable movement merely to clear a callback
queue. In the current pilot candidate, payment initiation is disabled, and no
provider calls are authorized.

The Jest setup opts synthetic legacy financial tests into the enabled path for
compatibility. Hard-off tests explicitly clear the setting and verify rejection
before database/provider I/O. This test-only setting is not copied into runtime
configuration.

No `/api/integrations/v1` external-platform API route or
`EXTERNAL_PLATFORM_API_ENABLED` gate was found in this backend candidate. Do not
represent that feature as implemented or configurable here.
