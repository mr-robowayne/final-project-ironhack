const HTML_TAG_RE = /<[^>]*>/g;
const WHITESPACE_RE = /\s+/g;
const MENTION_PART_RE = /(@[A-Za-z0-9_.-]{2,32})/g;
const MENTION_ONLY_RE = /^@[A-Za-z0-9_.-]{2,32}$/;

export function sanitizeRichTextToPlainText(input, maxLength = null) {
  let text = String(input || '');

  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parsed = new window.DOMParser().parseFromString(text, 'text/html');
      text = parsed?.body?.textContent || '';
    } catch {
      text = text.replace(HTML_TAG_RE, ' ');
    }
  } else {
    text = text.replace(HTML_TAG_RE, ' ');
  }

  text = text.replace(WHITESPACE_RE, ' ').trim();
  if (Number.isFinite(maxLength) && maxLength >= 0 && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

export function splitTextByMentions(input) {
  const text = sanitizeRichTextToPlainText(input);
  const parts = text.split(MENTION_PART_RE).filter((part) => part !== '');
  return parts.map((part) => ({
    text: part,
    isMention: MENTION_ONLY_RE.test(part),
  }));
}
