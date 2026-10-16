# BMS Provider Network — sandbox payment service

This service implements the provider-led arrangement Jennifer selected. It is separate from the public GitHub Pages website. It does not accept live Stripe keys and refuses keys belonging to another sandbox.

## Implemented experience

1. Jennifer signs into `/admin` and creates a private invitation for an approved provider.
2. The provider connects an existing Stripe account through Connect OAuth, or creates a full-dashboard account using Accounts v2 and Stripe-hosted onboarding.
3. Jennifer creates a fixed service quote and chooses standard ($65) or expanded ($99) coordination.
4. The provider's private approval page shows the customer total, BMS fee and provider share before Stripe processing. Approval is recorded against the immutable quote.
5. The customer opens a separate private payment link. The server checks provider approval and Stripe readiness, then creates a direct-charge Checkout Session in the connected account. The amount, account and fee come only from stored records.
6. Signed connected-account webhooks verify the payment, account, quote and fee before marking the request paid. BMS follows up to confirm the appointment. A success-page visit never confirms a payment.

Verified paid webhooks queue separate customer, provider and BMS emails. Jennifer arranges the appointment and saves its date, location and optional notes in administration to queue appointment confirmations. Private invitations and quote links are still shared manually. Email delivery stays paused until the sender connection is configured. This app does not check calendar availability or create Google Calendar events.

## Fee and responsibility configuration

- Full Stripe Dashboard for providers.
- New Accounts v2: `defaults.responsibilities.fees_collector = stripe` and `losses_collector = stripe`; merchant card-payments capability requested.
- Direct charges using the connected account request scope; no destination transfer.
- `application_fee_amount` is exactly 6,500 or 9,900 USD cents. Processing fees are deducted separately by Stripe from the provider. No estimated processing markup is added.
- Providers manage refunds and disputes in their Stripe Dashboard. Any refund of BMS's application fee remains a separate operational decision; this service does not issue refunds.
- Existing-account OAuth is necessary for linking existing Stripe accounts. Tokens are discarded after obtaining the account ID, state is browser-bound and single-use, and deauthorization blocks new checkouts. Providers can disconnect, so account status is rechecked before every payment.

## What is verified

Run `npm ci`, `npm run check`, and `npm test` with Node 24. Tests exercise the HTTP handlers with a fake Stripe transport and real Stripe webhook signature verification. They cover permission separation, expired invitations, CSRF, OAuth replay protection, Accounts v2 configuration, provider readiness, immutable quotes, $65/$99 fees, retry idempotency, account-bound webhooks, duplicate events, refunds, disputes and disconnects.

On October 16, 2026, hosted sandbox tests verified existing-account OAuth, new Accounts v2 onboarding, direct charges with both $65/$99 fees, signed payment updates, card decline/unpaid state, Checkout expiration and a full customer refund. BMS application fee reversal was not part of that refund. Email inbox delivery remains unverified until a sender is connected. Automated tests also cover durable email enqueueing, duplicate events, retry keys, sandbox recipient restrictions, appointment validation, refund/dispute guards and old-payment email recovery.

## Deployment requirements

### Prepared browser-based Render setup

The repository-root `render.yaml` prepares one Node 24 Starter service and a 1 GB persistent disk in Virginia. Auto-deploys are off. The service starts without Stripe credentials so its HTTPS URL is available before configuring OAuth redirects and webhooks. Review the cost estimate in Render before creating resources; published starting rates checked October 16, 2026 are $7/month for Starter plus $0.25/month for a 1 GB disk, before tax and additional usage. A workspace upgrade is not required for this configuration.

[Review the Render deployment](https://render.com/deploy?repo=https://github.com/jennychere15/bonita-multi-services-website/tree/feature/provider-payments).

Sign in using GitHub and, if Render requests repository access, limit it to this website repository. Review the prepared service and cost before approving deployment. After the service is created, get the generated `ADMIN_TOKEN` from its Environment settings and use it to sign into the service's `/admin` page. Do not send that token in chat. The service uses Render's assigned HTTPS URL automatically; a custom domain can later be supplied using `BASE_URL`.

Next configure the sandbox Stripe key, development Connect client ID and connected-account webhook signing secret in Render Environment settings. Then perform the end-to-end tests below before adding any link to the public website. The approved sandbox service is deployed at https://bms-provider-payments-sandbox.onrender.com with its disk at /var/data and SQLite at /var/data/payments.sqlite.

The static GitHub Pages site cannot execute this service or hold payment credentials. Deploy this directory as a Node 24 service or Docker container behind HTTPS, with a persistent disk mounted at `/app/data`. Run a single instance; SQLite is local to that disk. Back up the database securely. Invitations, quote approval links and customer payment links expire after seven days. An expired Checkout Session requires a new quote in this phase.

Configure the following through the host's secret manager (not chat, source code, GitHub Pages settings or client JavaScript):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test-mode platform API credential belonging to `acct_1UQIaJ5uSGpjnhUc` |
| `STRIPE_OAUTH_SECRET_KEY` | Separate standard sandbox key for OAuth exchange; payment operations retain the restricted key |
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


## Email connection and appointment follow-up

Use Resend for transactional messages. Verify `updates.bonitamultiservices.com` using the DNS records Resend provides; leave existing Workspace mail records intact. Store a sending-only Resend key in Render as `RESEND_API_KEY`. Set `EMAIL_FROM` to `Bonita Multi-Services <notifications@updates.bonitamultiservices.com>`, `BMS_ADMIN_EMAIL` to `Admin@bonitamultiservices.com`, and `EMAIL_ENABLED=true` only when the sender is verified. No email service account or paid email subscription is provisioned by this change.

The sandbox only sends to exact addresses in `SANDBOX_EMAIL_ALLOWLIST`, initially `Admin@bonitamultiservices.com,admin+provider-test@bonitamultiservices.com`. Add only test addresses the owner controls. Every subject and message identifies the sandbox. Customer confirmations omit the internal BMS fee. Replies go to BMS administration. Templates are stored with the queued message, so keep the planned sender address when enabling the connection.

The admin page shows paused/enabled connection state and recent queue activity. `accepted` means Resend accepted the message, not that it arrived in an inbox. `blocked` means the recipient is outside the sandbox allowlist; `review` requires operator review of the sender/API response or an expired retry window. Transient failures retry with an unchanged payload/idempotency key for at most 23 hours, within Resend's documented 24-hour retention. Queued messages survive a service restart. A full refund cancels unsent payment confirmations; refunds, disputes and appointment revisions suppress unsent appointment messages. Already accepted emails cannot be recalled.

Use **Send connection test to BMS**, then verify the actual inbox. Use **Queue payment confirmations** on an existing paid sandbox job to recover its email from its matching Stripe Checkout Session; repeated clicks do not duplicate notifications. Otherwise, new verified paid webhooks enqueue messages automatically. **Confirm appointment** is only available for paid, unrefunded, undisputed jobs; date/time uses the administrator's displayed device timezone and emails display Eastern Time. Saving a later revision queues an update and suppresses unsent older revisions. No appointment is inferred from a payment or payment-return page.

Official email references: [Send email](https://resend.com/docs/api-reference/emails/send-email), [Verified domains](https://resend.com/docs/dashboard/domains/introduction), [24-hour idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
