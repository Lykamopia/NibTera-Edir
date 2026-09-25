import { ALLOWED_TAGS } from '@/lib/sanitize-html';

/**
 * Opens a print window for a rich-text document WITHOUT document.write() or
 * any HTML string concatenation. The popup shares our origin, so anything that
 * executed in it would run with the user's session; every node is therefore
 * created with createElement()/createTextNode() and every user-controlled
 * string is assigned via textContent.
 *
 * The rich-text body (already sanitized server-side) is parsed with DOMParser —
 * an inert document where nothing executes — and re-built node-by-node through
 * the same tag allowlist as src/lib/sanitize-html.ts. Attributes are dropped,
 * except a safe http(s)/mailto/relative href on links.
 */

const PRINT_CSS = `body{font-family:Georgia,'Times New Roman',serif;max-width:780px;margin:48px auto;padding:0 24px;color:#111;line-height:1.6}
h1,h2,h3,h4{font-family:Arial,Helvetica,sans-serif;line-height:1.3} h1{font-size:24px}
.meta{color:#666;font-size:12px;margin:8px 0 28px;border-bottom:1px solid #ddd;padding-bottom:12px}
ul,ol{padding-left:24px} blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#555}`;

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function copySafe(source: Node, target: Node, doc: Document): void {
  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return; // comments, PIs, etc.
    const tag = (child as Element).tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown wrapper: keep its text/allowed children, drop the element itself.
      // Script-like containers are dropped entirely.
      if (!['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math'].includes(tag)) {
        copySafe(child, target, doc);
      }
      return;
    }
    const el = doc.createElement(tag);
    if (tag === 'a') {
      const href = ((child as Element).getAttribute('href') || '').trim();
      if (SAFE_HREF.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    copySafe(child, el, doc);
    target.appendChild(el);
  });
}

/** Returns false when the popup was blocked. */
export function printRichDocument(title: string, html: string, meta: string): boolean {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false;
  const doc = w.document;

  doc.title = title; // title setter treats the value as text
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const style = doc.createElement('style');
  style.textContent = PRINT_CSS;
  doc.head.replaceChildren(charset, style);

  const h1 = doc.createElement('h1');
  h1.textContent = title;
  const metaEl = doc.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = meta;
  const content = doc.createElement('div');
  const parsed = new DOMParser().parseFromString(html || '', 'text/html');
  copySafe(parsed.body, content, doc);
  doc.body.replaceChildren(h1, metaEl, content);

  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}
