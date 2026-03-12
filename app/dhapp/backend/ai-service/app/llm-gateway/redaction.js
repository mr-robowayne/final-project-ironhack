'use strict';

function redactPII(input, { maxLen = 2000 } = {}) {
  let text = String(input || '');
  if (text.length > maxLen) text = text.slice(0, maxLen);

  // Emails
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');

  // Phone numbers (very rough, CH/EU-ish)
  text = text.replace(
    /(\+?\d{1,3}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{0,4}/g,
    (m) => (/\d{7,}/.test(m.replace(/\D/g, '')) ? '[REDACTED_PHONE]' : m)
  );

  // "Herr/Frau/Dr/Prof Patient ..." names
  text = text.replace(
    /\b(Herr|Frau|Dr\.?|Prof\.?|Patient(?:in)?|Pat\.?)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){0,2})\b/g,
    '$1 [REDACTED_NAME]'
  );

  // "Name: Max Muster"
  text = text.replace(/\b(Name|Patient|Patientin)\s*:\s*[^\n]{2,80}/gi, '$1: [REDACTED_NAME]');

  // Long IDs (insurance/patient numbers)
  text = text.replace(/\b\d{8,}\b/g, '[REDACTED_ID]');

  return text;
}

module.exports = { redactPII };

