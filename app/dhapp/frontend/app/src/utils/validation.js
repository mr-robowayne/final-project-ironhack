// Centralized validation and formatting utilities (GDPR/ISO minded)

// Name: only letters (incl. umlauts), min 2 chars
export function isValidName(value) {
  const v = String(value || '').trim();
  if (v.length < 2) return false;
  // Letters incl. Latin-1 supplement and ß; allow hyphen and space for real names
  return /^[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß\- ]+$/.test(v);
}

// RFC 5322-compliant-ish email regex (practical variant)
export function isValidEmailRFC5322(email) {
  const v = String(email || '').trim();
  if (!v) return false;
  // eslint-disable-next-line no-control-regex
  const re = /^(?:[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)]$)/i;
  return re.test(v);
}

export function isValidPLZ(plz) {
  const v = String(plz || '').trim();
  return /^\d{4}$/.test(v);
}

export function isValidBirthdateNotFuture(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d <= today;
}

export function formatSwissPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0041')) d = '0' + d.slice(4);
  else if (d.startsWith('41')) d = '0' + d.slice(2);
  else if (d.startsWith('041')) d = '0' + d.slice(3); // safety
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 8) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}

export function validateSwissPhone(nr) {
  const d = String(nr || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return true;
  if (d.length === 11 && d.startsWith('41')) return true; // 41xxxxxxxxx after stripping +
  if (d.length === 12 && d.startsWith('0041')) return true;
  return false;
}

export function formatAhvLive(ahv) {
  const digits = String(ahv || '').replace(/\D/g, '').slice(0, 13);
  if (!digits) return '';
  let out = digits;
  if (digits.length > 3) out = out.slice(0, 3) + '.' + out.slice(3);
  if (digits.length > 7) out = out.slice(0, 8) + '.' + out.slice(8);
  if (digits.length > 11) out = out.slice(0, 13) + '.' + out.slice(13);
  return out;
}

export function validateAhv(ahv) {
  const digits = String(ahv || '').replace(/\D/g, '');
  if (digits.length !== 13 || !digits.startsWith('756')) return false;
  let sum = 0;
  const factors = [3, 1];
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i], 10) * factors[i % 2];
  const check = (11 - (sum % 11)) % 11;
  return check === parseInt(digits[12], 10);
}

export function sanitizeFormData(obj) {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string') out[k] = out[k].trim();
  }
  return out;
}

export function debounce(fn, delay = 300) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

