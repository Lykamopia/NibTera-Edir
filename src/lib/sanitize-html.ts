/**
 * Conservative allowlist HTML sanitizer for member-authored rich text (rules &
 * bylaws). Keeps only semantic formatting tags, strips ALL attributes except a
 * safe `href` on links, and removes scripts/styles/comments/event handlers.
 *
 * The WYSIWYG editor emits semantic tags (h1–h4, strong/em, ul/ol/li, etc.), so
 * dropping style/class attributes does not lose meaningful formatting. Content
 * is double-gated by a Maker–Checker workflow, but we still sanitize so a
 * compromised draft can never inject script into the member-facing view.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
  'blockquote', 'a', 'span', 'div', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // Drop dangerous element blocks entirely (including their content).
  s = s.replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1>/gi, '');
  // Drop self-closing/standalone dangerous or metadata tags.
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button|svg|math)[^>]*>/gi, '');
  // Strip HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Rewrite opening tags: allowlist tag, drop all attributes except safe href on <a>.
  s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_m, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (tag === 'a') {
      const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? '').trim();
      const safe = /^(https?:\/\/|mailto:|\/)/i.test(href) ? href.replace(/"/g, '&quot;') : '';
      return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">` : '<a>';
    }
    return `<${tag}>`;
  });

  // Rewrite closing tags: keep only allowlisted.
  s = s.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, (_m, rawTag: string) => {
    const tag = rawTag.toLowerCase();
    return ALLOWED_TAGS.has(tag) ? `</${tag}>` : '';
  });

  return s.trim();
}

/** Plain-text excerpt of sanitized HTML (for search and summaries). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
