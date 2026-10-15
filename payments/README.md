# BMS Provider Network — sandbox payment service

This service implements the provider-led arrangement Jennifer selected. It is separate from the public GitHub Pages website. It does not accept live Stripe keys and refuses keys belonging to another sandbox.

## Implemented experience

1. Jennifer signs into `/admin` and creates a private invitation for an approved provider.
2. The provider connects an existing Stripe account through Connect OAuth, or creates a full-dashboard account using Accounts v2 and Stripe-hosted onboarding.
3. Jennifer creates a fixed service quote and chooses standard ($65) or expanded ($99) coordination.
4. The provider's private approval page shows the customer total, BMS fee and provider share before Stripe processing. Approval is recorded against the immutable quote.
5. The customer opens a separate private payment link. The server checks provider approval and Stripe readiness, then creates a direct-charge Checkout Session in the connected account. The amount, account and fee come only from stored records.
6. Signed connected-account webhooks verify the payment, account, quote and fee before marking the request paid. BMS follows up to confirm the appointment. A success-page visit never confirms a payment.

No emails or invitations are sent automatically. The application creates private links for Jennifer to share. Application review, credential checks, scheduling and appointment confirmation remain with BMS in this phase.

## Fee and responsibility configuration

- Full Stripe Dashboard for providers.
- New Accounts v2: `defaults.responsibilities.fees_collector = stripe` and `losses_collector = stripe`; merchant card-payments capability requested.
- Direct charges using the connected account request scope; no destination transfer.
- `application_fee_amount` is exactly 6,500 or 9,900 USD cents. Processing fees are deducted separately by Stripe from the provider. No estimated processing markup is added.
- Providers manage refunds and disputes in their Stripe Dashboard. Any refund of BMS's application fee remains a separate operational decision; this service does not issue refunds.
- Existing-account OAuth is necessary for linking existing Stripe accounts. Tokens are discarded after obtaining the account ID, state is browser-bound and single-use, and deauthorization blocks new checkouts. Providers can disconnect, so account status is rechecked before every payment.

## What is verified

Run `npm ci`, `npm run check`, and `npm test` with Node 24. Tests exercise the HTTP handlers with a fake Stripe transport and real Stripe webhook signature verification. They cover permission separation, expired invitations, CSRF, OAuth replay protection, Accounts v2 configuration, provider readiness, immutable quotes, $65/$99 fees, retry idempotency, account-bound webhooks, duplicate events, refunds, disputes and disconnects.

These tests are **not** an end-to-end Stripe payment test. Hosted onboarding, OAuth consent, Stripe-created direct charges, event delivery and visual browser QA are still unverified. The earlier BMS-led destination-charge sandbox demonstration does not validate this direct-charge implementation.

## Deployment requirements

The static GitHub Pages site cannot execute this service or hold payment credentials. Deploy this directory as a Node 24 service or Docker container behind HTTPS, with a persistent disk mounted at `/app/data`. Run a single instance; SQLite is local to that disk. Back up the database securely. Invitations, quote approval links and customer payment links expire after seven days. An expired Checkout Session requires a new quote in this phase.

Configure the following through the host's secret manager (not chat, source code, GitHub Pages settings or client JavaScript):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test-mode platform API credential belonging to `acct_1UQIaJ5uSGpjnhUc` |
| `STRIPE_CONNECT_CLIENT_ID` | Development Connect OAuth client ID |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for the connected-account event destination |
| `ADMIN_TOKEN` | Random administration access code, at least 32 characters |
| `BASE_URL` | Exact HTTPS origin of the hosted payment service |
| `DATABASE_PATH` | Persistent SQLite path, default `./data/payments.sqlite` |
| `PORT` | Backend listening port, default `4242` |

Prefer a restricted Stripe API credential with only the required permissions. Confirm account creation, OAuth token exchange, connected-account read access, Checkout creation and PaymentIntent retrieval are supported by the chosen credential; Connect OAuth token exchange may require a test secret key. Never loosen permissions simply to make an unexplained error disappear.

The installed Stripe 23.0.0 SDK selects API version `2026-09-30.endive`. Register the webhook event destination with the matching API version and **connected accounts** scope:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `account.updated`
- `account.application.deauthorized`
- `charge.refunded`
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

Webhook URL: `<BASE_URL>/api/webhooks/stripe`. Register the exact OAuth redirect `<BASE_URL>/oauth/callback` in the sandbox's Connect OAuth settings. The callback must be opened in the same browser that started connection.

For local work only, copy `.env.example` to the ignored `.env`, supply the sandbox configuration securely, and run `npm start`. This service can start without a Stripe key to inspect the UI, but payment and onboarding writes return unavailable until Stripe and the signing secret are configured. Requests from scripts to non-webhook POST routes must send `Origin: <BASE_URL>`.

## Before enabling the public integration

Complete a hosted test with a new provider, a connected existing provider, both fee tiers, a test card payment, a refund, a dispute and a disconnect. Check application fees in BMS's sandbox and the direct charge in the provider's sandbox. Verify event retries and delayed/async payment behavior. Verify mobile layouts and keyboard access. Confirm HTTPS, persistent storage/backups and the access-code handoff. This build intentionally does not enable live payments or add public website payment links.

Phase-two provider portal improvements: embedded account management and requirement notifications, payments and payouts views. The current phase uses Stripe-hosted onboarding and the provider's full Stripe Dashboard for ongoing requirements and payment operations.

## Official references

- [Direct charges and application fees](https://docs.stripe.com/connect/direct-charges)
- [Accounts v2 configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- [Connect OAuth reference](https://docs.stripe.com/connect/oauth-reference)
- [Stripe-hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding)
- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
