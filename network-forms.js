"use strict";
function formatSubmissionTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
  }).format(date);
}
function buildDraft(formData, heading) {
  const lines = [heading, "", "Request prepared on: " + formatSubmissionTime()];
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
  form.querySelectorAll(".requires-js").forEach(button => button.disabled = false);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const body = buildDraft(new FormData(form), heading);
    const fallback = form.querySelector(".email-fallback");
    fallback.hidden = false;
    fallback.querySelector(".draft-text").value = body;
    fallback.querySelector(".open-draft").href = emailLink(subject, body);
    fallback.scrollIntoView({ behavior: "auto", block: "center" });
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

