/* Completed inquiries only. Never call on a click, draft, checkout start or payment return. */
(function () {
  'use strict';
  const prefix = 'bms-ads-v1:';
  const destinations = {
    '/property-service-thank-you.html': 'property_service_request',
    '/real-estate-thank-you.html': 'real_estate_request',
    '/relocation-thank-you.html': 'relocation_request',
    '/corporate-lodging-thank-you.html': 'corporate_lodging_request',
    '/senior-placement-thank-you.html': 'senior_placement_request',
    '/rental-placement-thank-you.html': 'rental_request'
  };
  function confirmedInquiry(action, id) {
    const label = (window.BMS_ADS_CONVERSIONS || {})[action];
    // Missing IDs cannot be deduplicated. Never fabricate a label or a revenue value.
    if (!/^[-\w]+$/.test(label || '') || typeof id !== 'string' ||
        !/^[\w-]{1,160}$/.test(id) || typeof window.gtag !== 'function') return false;
    const transaction = action + ':' + id;
    try {
      if (sessionStorage.getItem(prefix + transaction)) return false;
      sessionStorage.setItem(prefix + transaction, 'queued');
    } catch (_) {
      // Fail closed if local replay protection is unavailable.
      return false;
    }
    try {
      window.gtag('event', 'conversion', {
        send_to: 'AW-18509547187/' + label,
        transaction_id: transaction
      });
      return true; // Queued locally, not proof of Google Ads receipt or attribution.
    } catch (_) {
      try { sessionStorage.removeItem(prefix + transaction); } catch (_) {}
      return false;
    }
  }
  window.BMSConversions = Object.freeze({ confirmedInquiry });

  // FormSubmit returns only after its own submission/verification workflow.
  // Require the matching same-tab attempt: direct visits and refreshes do not count.
  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (event.defaultPrevented || !form.elements || !form.checkValidity()) return;
    let endpoint, next;
    try {
      endpoint = new URL(form.action);
      next = new URL(form.elements._next.value);
    } catch (_) { return; }
    if (endpoint.origin !== 'https://formsubmit.co' || next.origin !== location.origin ||
        !destinations[next.pathname]) return;
    try {
      const token = crypto.randomUUID();
      sessionStorage.setItem(prefix + 'pending:' + token, JSON.stringify({
        action: destinations[next.pathname], path: next.pathname, time: Date.now()
      }));
      next.searchParams.set('bms_request', token);
      form.elements._next.value = next.href;
    } catch (_) { /* Submission remains usable without measurement. */ }
  });
  const token = new URL(location.href).searchParams.get('bms_request');
  if (token && /^[\w-]{1,160}$/.test(token) && destinations[location.pathname]) {
    try {
      const key = prefix + 'pending:' + token;
      const pending = JSON.parse(sessionStorage.getItem(key));
      sessionStorage.removeItem(key);
      if (pending && pending.path === location.pathname &&
          pending.action === destinations[location.pathname] &&
          Date.now() >= pending.time && Date.now() - pending.time < 30 * 60 * 1000) {
        confirmedInquiry(pending.action, token);
      }
    } catch (_) { /* No matching browser receipt: do not count. */ }
  }
}());
