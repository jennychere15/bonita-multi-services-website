# BMS production handoff

Prepared after the sandbox payment and email checks completed on October 17, 2026. No live charge has been made and live checkout remains off.

## Hosting

Create a separate Render Blueprint from this repository, branch `feature/provider-payments`, Blueprint path `render.production.yaml`. Do not change the existing sandbox Blueprint or mount its database. The production Blueprint creates one Node web service and its own 1 GB disk; review Render's current estimate before deployment. The existing sandbox estimate was $7.25/month; this production resource is additional while both run.

Production starts in `PAYMENT_MODE=live`, `LIVE_PAYMENTS_ENABLED=false`, `EMAIL_ENABLED=false`. It can boot for configuration without Stripe keys. Its new ADMIN_TOKEN must be copied privately from Render for admin sign-in. The database has an immutable environment/platform binding. Existing sandbox providers, jobs, invitation URLs, payments and email queues are never copied to live mode.

Use the actual URL assigned by Render as BASE_URL (HTTPS origin, no trailing slash), the Stripe OAuth redirect origin and the webhook origin. The proposed name is `bms-provider-payments`; verify the assigned URL before entering it in Stripe.

## Stripe and sender configuration

Approved live platform: `acct_1UQ8tWQhdCDcrQgc` (Bonita Multi Services LLC). Startup retrieves the configured Stripe account and refuses a different account. Sandbox keys and live keys cannot be interchanged. The live account reported card payments and payouts enabled, and no currently/past-due verification requirements during the read-only review. This does not verify connected-provider eligibility or successful live fee collection.

1. Review the live Connect platform setup in that exact account. Set the live OAuth callback to `<production-origin>/oauth/callback`; enable OAuth if using existing full-Dashboard provider accounts. Put the live client ID in `STRIPE_CONNECT_CLIENT_ID`.
2. Create a dedicated restricted live API key, matching the proven sandbox permission configuration. The backend needs platform account retrieval, v2 account creation/retrieval and account links, merchant configuration; connected-account Checkout Sessions creation/retrieval and PaymentIntents retrieval. It does not need payouts or transfers write access. Put it directly into production Render as `STRIPE_SECRET_KEY`. Never use the sandbox key.
3. For OAuth token exchange only, configure a separate standard live key as `STRIPE_OAUTH_SECRET_KEY` if required, matching the sandbox-tested flow. Keep payment operations on the restricted key. Verify both keys belong to the approved platform. Do not commit keys or share them in chat.
4. Register a LIVE connected-account webhook at `<production-origin>/api/webhooks/stripe`, API version `2026-09-30.endive`, for:
   - checkout.session.completed
   - checkout.session.async_payment_succeeded
   - checkout.session.async_payment_failed
   - checkout.session.expired
   - account.updated
   - account.application.deauthorized
   - charge.refunded
   - charge.dispute.created
   - charge.dispute.updated
   - charge.dispute.closed
5. Store that endpoint's signing secret in production Render as `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. Create a separate sending-only Resend key scoped to the verified `updates.bonitamultiservices.com` domain and save it as `RESEND_API_KEY`. EMAIL_FROM and BMS_ADMIN_EMAIL are in the Blueprint. Set `EMAIL_ENABLED=true` only after configuration. Verify the production connection test in the BMS inbox. Replies go to Admin@bonitamultiservices.com; receiving remains on Google Workspace.

Save/redeploy after configuration. Keep `LIVE_PAYMENTS_ENABLED=false`. Health returns `mode=live` and a truthful `livePaymentsEnabled` boolean; no credentials are returned. A paused service rejects all Checkout creation and reopening, including saved Checkout sessions. Webhook processing stays available so later payment/refund events are not lost if checkout is paused.

## Provider and launch review

Use a genuine, authorized provider with its own business email and Stripe account; the sandbox test provider cannot be reused. Use hosted Stripe onboarding for new accounts. Existing accounts connect through the platform's live OAuth flow. Providers retain their full Stripe Dashboard for requirements, refunds and disputes. Do not close existing BMS/QNP accounts or create duplicate businesses to clear setup errors.

New v2 providers must have an active merchant card_payments capability, full Dashboard and Stripe fee/loss responsibility, checked again before each Checkout attempt. The existing v1 compatibility checks remain for legacy OAuth accounts. Use Stripe Dashboard/hosted onboarding to remediate requirements; an embedded notification banner is recommended for a later provider dashboard enhancement.

The live flow keeps the approved direct-charge design: customer pays the full approved total on the provider's account; BMS application fee is $65 standard or $99 expanded; the provider pays Stripe processing costs. This is not a delayed escrow or payout-release system. Refund policy/application-fee refund handling must be decided operationally: the sandbox full customer refund did not automatically refund the BMS application fee. No automated refund write operation was added.

Before enabling checkout, review the production URL, real provider readiness, support/statement details and fees. Then explicitly set `LIVE_PAYMENTS_ENABLED=true` in production only and redeploy. Confirm health and privately review the first genuine client payment, BMS fee, payment emails and manually arranged appointment. Do not use sandbox cards or make synthetic live charges. Publish public payment/provider links only after the private production flow is reviewed.

## Evidence and boundaries

Sandbox manually verified: standard $65 and expanded $99 fee, new-provider onboarding, a declined payment, full customer refund status, signed paid-event updates, branded connection email, customer/provider/BMS payment emails, appointment confirmations and appointment updates in the BMS inbox. Automated checks cover cross-mode credentials/events/databases and a paused live Checkout, among existing authorization and idempotency checks. Live integration tests are simulated unit tests, not actual live Stripe transactions. Appointment actions record details and send emails; they do not check calendar availability or create Google Calendar events.
