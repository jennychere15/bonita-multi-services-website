import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const TIERS = Object.freeze({ standard: 6500, expanded: 9900 });
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const equal = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function requireCondition(test, message, status = 400) {
  if (!test) throw Object.assign(new Error(message), { status });
}
export function text(value, max = 160) {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, 'Please check the required fields.');
  return value.trim();
}
export function quote(input) {
  const fee = TIERS[input.tier];
  requireCondition(fee && Number.isSafeInteger(input.amount) && input.amount > fee && input.amount <= 10000000,
    'Choose a valid tier and a total greater than the coordination fee (maximum $100,000).');
  return { title: text(input.title), amount: input.amount, tier: input.tier, fee };
}
export function accountReady(account) {
  // OAuth-connected, self-controlled Standard accounts omit the controller configuration.
  // Infer only missing fields from Stripe's Standard mapping; explicit conflicts still fail.
  const standard = account.type === 'standard' && account.controller?.type === 'account';
  const dashboard = account.controller?.stripe_dashboard?.type ?? (standard ? 'full' : undefined);
  const payer = account.controller?.fees?.payer ?? (standard ? 'account' : undefined);
  const losses = account.controller?.losses?.payments ?? (standard ? 'stripe' : undefined);
  return account.country === 'US' && account.charges_enabled === true && account.payouts_enabled === true &&
    account.capabilities?.card_payments === 'active' && dashboard === 'full' &&
    payer === 'account' && losses === 'stripe';
}
export function checkoutParams(job, baseUrl) {
  requireCondition(job.approved && ['approved', 'checkout_open'].includes(job.status), 'The provider must approve this quote before payment.', 409);
  return {
    mode: 'payment', client_reference_id: job.id,
    integration_identifier: 'bms-provider-' + Array.from(randomBytes(8), b => String.fromCharCode(97 + b % 26)).join(''),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: job.amount,
      product_data: { name: job.title } } }],
    payment_intent_data: { application_fee_amount: job.fee, metadata: { bms_job_id: job.id } },
    metadata: { bms_job_id: job.id, bms_tier: job.tier },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    success_url: baseUrl + '/payment-return', cancel_url: baseUrl + '/payment-return?cancelled=1'
  };
}
