export function serviceCategory(service) {
  const label = service.replace(/^BMS appointment:\s*/i, '').toLowerCase();
  if (/notary|notarization|apostille|signing|witness|i-9/.test(label)) return { notary: true, label: 'notary or apostille', next: 'BMS will review the document-service scope, confirm an itemized quote and arrange the appropriate assignment.' };
  if (/tax/.test(label)) return { label: 'tax preparation', next: 'Choose a tax consultation time. Your preparer will confirm the scope and secure document-exchange instructions.', url: 'https://calendar.app.google/nbDSKFHGidPsuRhU6' };
  if (/wedding|marriage|ceremony|vow|premarital/.test(label)) return { label: 'marriage or wedding service', next: 'BMS will review your ceremony or marriage-service details and confirm the next step.', url: 'https://bonitamultiservices.com/wedding-services.html' };
  if (/vendor|facility|facilities|network/.test(label)) return { label: 'Preferred Vendor Network', next: 'BMS will review the requested service, location and provider availability. No provider assignment is confirmed.', url: 'https://bonitamultiservices.com/provider-network.html' };
  if (/room|space rental/.test(label)) return { label: 'office space', next: 'BMS must review suitability, access, itemized charges and accepted terms before payment or confirmation.', url: 'https://bonitamultiservices.com/meeting-room.html' };
  return { label: /consult|business|sales/.test(label) ? 'business or sales consulting' : 'service', next: 'Choose a consultation time so BMS can review your needs and service scope.', url: 'https://calendar.app.google/6BNgcTPhgPHVEg3n8' };
}
