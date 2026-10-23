# BMS Google Ads conversion audit — October 23, 2026

## Status

Audited website main commit `7cd00c433927a8a01aaba286afec6c65f2da321b`.
This change prepares explicit conversion hooks; it does not verify Google Ads reporting.
Conversion labels remain blank, so the new hooks intentionally send no Ads conversions until account configuration is checked. Changes are proposed on a branch, not deployed to the live website.

The base tag `AW-18509547187` is present on the homepage, book.html and most service / thank-you pages. It was absent from meeting-room.html; this change adds the same base snippet there once. The live meeting-room page was also fetched read-only and had no AW tag. The live external notary booking entry page likewise had no AW tag in its returned HTML. Loading a script and a correctly shaped config call does not prove destination ownership, receipt or attribution.

No explicit `gtag('event','conversion', {send_to: ...})`, conversion labels, GA4 measurement ID or GTM container was found in the audited repository. Google-managed URL conversions, remote tag destinations and account imports cannot be ruled out by source inspection. Google Ads currently opens a signed-out account chooser; account reporting and settings were not accessible.

## Workflow findings and proposed changes

| Journey | Existing behavior | Proposed measurement / remaining work |
| --- | --- | --- |
| Business & sales consulting | POST /api/consulting/inquiries; generic generate_lead after HTTP success | Explicit consulting_request hook only after API acceptance, using its returned ID; requires real label |
| Notary / apostille inquiry | POST /api/notary/inquiries; generic generate_lead after HTTP success | Explicit notary_request hook with returned ID; inquiry only, not appointment or payment |
| Meeting-room inquiry | Availability lookup then POST /api/room/requests; no lead event or base tag | Add base tag; room_request hook for accepted non-checkout inquiry with ID. Calendar view, availability lookup and Stripe checkout start are not conversions |
| Room checkout / paid reservation | Stripe redirect from checkoutUrl; completion is outside this repository | No purchase or booking-success event added. Requires backend review and a verified paid, live, finalized reservation |
| Property service, real estate, relocation, corporate lodging, senior placement | Native FormSubmit POST and specific thank-you redirect | Match same-tab pending attempt to return token, expire after 30 minutes, consume once; receipt of provider redirect is browser evidence, not proof of email delivery or qualified lead |
| Rental owner / renter | FormSubmit with type=owner or type=renter; generic rental_inquiry_submit_attempt | Preserve type and existing attempt diagnostic; conversion only on matching return. Both use rental_request; never mark the attempt diagnostic as a primary outcome |
| Preferred-vendor request | Current provider-network.html uses native FormSubmit | property_service_request confirmation hook. network-forms.js is an unused older mail-draft helper and is not loaded by this page |
| Vendor / notary recruitment | Supplier applications / onboarding | Excluded from customer conversion hooks |
| Google Calendar consultation | External calendar.app.google link | Opening the calendar is not a completed booking. No booking-success integration is present here; use a supported confirmed booking integration or deduplicated offline outcome import tied to original attribution |
| Notary network services / commercial subscriptions | External Render portal / Stripe checkout | Subscribe request and portal navigation are not sales. Initial paid purchase and later renewal events need separate definitions and verified backend evidence |
| Phone, text, email links | Intent to contact | No completed inquiry inferred from a click or email draft |
| Legacy notary/business thank-you pages | Base tag only; not current API confirmation path | No automatic conversion added to avoid counting stale/direct visits |

## Deduplication and data limits

- Only labels copied from verified BMS conversion actions may populate conversion-config.js. The base ID alone is insufficient. Labels are public tag identifiers, not secrets.
- API inquiry IDs become action-prefixed transaction_id values. Session storage suppresses local replays, and the same stable transaction ID is sent for Google-side deduplication within the action.
- Native FormSubmit forms get a random, non-personal token in their _next return URL. Only a matching pending record for that exact page can emit, once, within 30 minutes. Direct visits, refreshes, failed validation, cancelled submissions, foreign redirects and supplier applications do not emit.
- This FormSubmit method is deliberately conservative: a closed tab, disabled storage, delayed CAPTCHA, blocked scripts, or a changed return URL can cause undercounting. A trusted server receipt is stronger than this client flow. Repeated independent submissions are different inquiries, not automatically the same customer.
- Session storage is not an end-to-end delivery guarantee. Queuing gtag does not prove delivery; blockers, consent and network failures may prevent measurement. No blind retry or claim of successful reporting.
- No names, emails, phones, addresses, document contents, budgets, request summaries, or invented sales values are included in these event payloads. No enhanced conversions were enabled.
- Do not count a single outcome via both Google Ads native events and a GA4/offline import as primary. Google deduplication within an action does not protect two different actions for the same outcome.

## Google Ads settings to verify before activation

1. Confirm AW-18509547187 belongs to the BMS advertising conversion account, including any manager-account conversion ownership and Google tag destinations. Check tag diagnostics with Tag Assistant on live landing, form and confirmation pages.
2. Inventory existing conversion actions, labels, categories, source, primary/secondary status, count setting, attribution/window, value rules, campaign goals and URL-based rules. Reuse an appropriate existing action instead of creating duplicates.
3. For accepted customer inquiries use the appropriate lead category and normally Count = One. Initially keep unvalidated actions secondary; promote the verified outcome actions that match each campaign's service after the test plan passes. Exclude page views, outbound Calendar clicks, drafts, attempts and supplier applications from primary bidding goals.
4. Populate the nine inquiry label fields with the corresponding actual Ads labels (or deliberately consolidate actions with one clear shared definition). Do not put the AW ID or full send_to string in a label field. Where actions are consolidated, review cross-category repeat behavior and stable IDs.
5. Check auto-tagging, preservation of ad click attribution across landing-page redirects, consent behavior, privacy disclosures, and supported external-domain attribution. Do not blindly append ad click identifiers or personal information to Google Calendar / Stripe links.
6. Audit and remove overlapping URL rules / imported conversions before enabling explicit events. Confirm rental submit-attempt events are not treated as successful leads elsewhere.
7. Payment outcomes: use a distinct purchase action, normally Count = Every, with real currency/amount and a stable order/session ID. Use only live payments (not sandbox), verified paid status and the intended fulfilled/confirmed outcome. Do not report a temporary hold or submitted plan request as a confirmed booking. Do not count recurring subscription renewals as repeated initial acquisitions.

## Backend work needed for payments and completed bookings

The payment backend is not in the accessible website repository. Render requires explicit selection of its workspace before service inspection; the returned workspace is `My Workspace` for Admin@bonitamultiservices.com (`tea-db94a7u7bikc73dlfecg`). It has not been selected automatically.

After workspace confirmation, locate the deployed service and its source. Review server verification of Stripe webhooks and Checkout sessions; distinguish live/test, paid/unpaid, async success/failure, cancellation, refund, repeated webhook delivery and actual booking state. Do not expose secrets or customer records. Use stable, persisted deduplication keyed to the appropriate order/invoice/outcome.

Payment confirmation must come from verified backend state (signed webhooks and/or server retrieval), never a `success=true`, `paid=1` query string or a success-page visit. A return page may request limited server-verified outcome data, but must not decide fulfillment. Handle both completed and asynchronous success appropriately and gate on paid status. Ensure fulfillment and measurement are idempotent. Account for delayed/never-returning customers, cross-domain attribution, and first subscription purchase versus renewals. No backend payment tracking has been implemented or verified by this frontend change.

For Calendar, determine whether the current booking product offers a supported completion integration. Otherwise use confirmed appointment records and a supported offline import with the correct click attribution and stable booking IDs; do not infer attribution from names or email addresses. No speculative cross-origin iframe messages are trusted.

## Validation

Local tests: `node --test tests/conversions.test.cjs` (8 passing), plus JavaScript syntax checks for conversions.js, consulting.js, notary.js and meeting-room.js. Tests use local fakes, not real customers or payments.

Before enabling primary goals / claiming reporting works:

- On a test branch or controlled session, use verified action labels and Tag Assistant to inspect the exact destination and transaction ID for one accepted request per API journey and native form route. Confirm an acknowledgment reaches Admin separately; browser redirects do not prove email delivery.
- Test invalid forms, API rejection/timeouts, cancellation, direct thank-you access, refresh/back, storage denial, duplicate callbacks and provider verification abandonment. No outcome should count from these.
- Confirm Google Calendar opening does not count as booking and Stripe opening/cancelling does not count as purchase. Verify live/test exclusion, async success, delayed webhooks, duplicate webhook handling and paid reservation finalization on the backend before enabling payment events.
- Verify the event in tag/network diagnostics, then independently check the intended Google Ads action diagnostics and subsequent attributed reporting after the platform's processing delay. A direct test without an eligible ad interaction need not appear as an attributed ad conversion. Do not click paid ads merely to test tracking.
- Reconcile accepted inquiries / confirmed bookings / real payments against Ads by action and date, explain attribution and consent differences, and calculate cost per accepted inquiry, qualified lead and confirmed booking separately. Inquiry counts alone do not establish return on ad spend.

## Primary references

- Google tag and conversion-event setup: https://support.google.com/google-ads/answer/7548399?hl=en
- Google conversion-event routing: https://developers.google.com/tag-platform/devguides/conversions
- Stripe Checkout fulfillment and payment verification: https://docs.stripe.com/checkout/fulfillment
