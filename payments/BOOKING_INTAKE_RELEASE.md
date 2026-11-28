# Booking intake corrections — deployment review

Prepared November 28, 2026. Not deployed. Backend target: `feature/provider-payments`, Render `bms-provider-payments`, root `payments`. Static room script is a separate proposed change against current `main`; do not merge the old payment branch wholesale into the website branch.

## Behavior

- General consulting, tax, wedding and vendor inquiries persist separately from notary assignments. Every acknowledgment includes its service and original reference; no notary assignment or private notary payment link is promised for those departments.
- Both inquiry paths save a CRM outbox row in the same SQLite transaction as the inquiry and notification queue. Local intake works with CRM delivery paused or unavailable.
- The Close worker reads contacts and compares normalized identities. It reuses exact email matches, flags phone-only/conflicting matches for manual review, and never overwrites existing statuses, suppression or descriptions. New lead/contact creation uses an explicitly configured intake status; one task per request includes original details, reference, source and inquiry-only permission, assigned to the configured owner.
- A local identity cache prevents duplicate creation when the Close listing lags. Lookup failures/429s retry with backoff. Ambiguous writes or interrupted work stop for manual reconciliation; they never automatically repeat a possibly accepted POST. The administration page shows delivery state and validates supplied existing Close lead/task IDs before reconciling.
- QA/test/DO NOT CONTACT requests and configured internal mailboxes are retained locally but excluded from CRM. No campaign enrollment, outbound email, SMS or calls are performed by the worker. Existing organization-triggered CRM automations must still be checked before enabling intake.
- Public room submissions cannot create checkout, including legacy `payNow: true` requests. Admin review requires reviewer name, suitability, access, itemized scope, written cancellation/rescheduling/refund terms and a record of customer acceptance. These are saved before a payment link can be created.
- Newly created bookings require review before a paid webhook confirms the reservation. Existing open checkout sessions and paid records retain the previous fulfillment behavior and are not falsely labeled reviewed. Additive migrations preserve records. Existing unreviewed open payment links should be reconciled by Jennifer before rollout.

## Configuration required before CRM activation

Keep `CLOSE_INTAKE_ENABLED=false` while deploying and checking the local intake/review pages. Configure these using the server's secret manager; do not commit values:

- `CLOSE_API_KEY`: intended BMS organization, permission to read all contacts and create leads/tasks; authentication was checked against current official documentation, but live credentials have not been configured or tested in this work.
- `CLOSE_INTAKE_OWNER_ID`: verified Jennifer user ID.
- `CLOSE_INTAKE_STATUS_ID`: verified inbound status with no automatic marketing enrollment. Audit organization workflows before activation; the implementation does not enroll sequences but cannot disable unrelated organization rules.
- `CLOSE_INTERNAL_EMAILS`: comma-separated additional BMS/QNP mailboxes. `BMS_ADMIN_EMAIL` is always excluded.
- `CLOSE_INTAKE_ENABLED=true` only after the configured identities, status and organization behavior are verified and activation is approved.

Missing config leaves all requests durably pending; `/intake-admin` shows the paused state. Neither API credentials nor public inquiry details are returned without admin authentication. Contact lookup is bounded at 10,000 records and stops for review rather than assuming no duplicate if incomplete.

## Validation and rollout

Run `npm ci` then `npm test` in `payments`; syntax-check changed source and browser scripts. Tests mock Close, Stripe and email delivery: they do not send messages, create real CRM records, reserve production slots or charge anything.

After production deployment approval: back up the SQLite database; deploy the exact reviewed backend commit with CRM sync paused; publish the separate request-only room script to `main`; verify authenticated administration and public request-only UI. Configure/verify the CRM identities/status securely, then explicitly enable intake. A further live end-to-end test requires approval; do not repeat completed email tests merely to demonstrate activity.

No historical backfill is automatic. Review prior generic inquiries stored in the notary table and any unsynced real inquiries separately before import. No records are migrated into Close on startup.

Rollback code without deleting the new additive tables or resetting review/outbox states. Never reset `review` rows to pending blindly: look for the original reference and preserve discovered remote IDs. If a remote write failed ambiguously, create/verify the one intended review task manually in Close and use the protected reconciliation form; no API retry is needed.

## Official API references used

- https://developer.close.com/api/resources/contacts/list
- https://developer.close.com/api/resources/leads/create
- https://developer.close.com/api/resources/tasks/create
- https://developer.close.com/api/overview/api-key-authentication
