"use strict";
function buildDraft(formData, heading) {
  const lines = [heading, "", "Submitted on: " + new Date().toISOString()];
  for (const [key, value] of formData.entries()) lines.push(key.replaceAll("_", " ").toUpperCase() + ": " + value);
  return lines.join("\r\n");
}
function emailLink(subject, body) {
  return "mailto:Admin@bonitamultiservices.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}
for (const [id, heading, subject] of [
  ["requestForm", "BMS CUSTOMER SERVICE REQUEST", "BMS Florida Service Request"],
  ["providerForm", "BMS FLORIDA VENDOR APPLICATION", "BMS Florida Vendor Application"]
]) {
  const form = document.getElementById(id);
  if (!form) continue;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const body = buildDraft(new FormData(form), heading);
    const fallback = form.querySelector(".email-fallback");
    fallback.hidden = false;
    fallback.querySelector(".draft-text").value = body;
    window.location.href = emailLink(subject, body);
  });
  form.querySelector(".copy-draft").addEventListener("click", async function () {
    const field = form.querySelector(".draft-text");
    const status = form.querySelector(".copy-status");
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = "Copied. Paste into an email to Admin@bonitamultiservices.com and send.";
    } catch {
      field.focus(); field.select();
      status.textContent = "Select and copy the draft above, then email Admin@bonitamultiservices.com.";
    }
  });
}
