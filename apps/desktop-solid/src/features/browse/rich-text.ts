import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { unwrapLinkout } from './browse-model';

/**
 * Project descriptions and changelogs are untrusted provider markup (Markdown or HTML). They
 * become a sanitised DOM fragment, never an HTML string handed to the page:
 * - DOMPurify with no scripts, forms, styles, ids, names or data attributes (no DOM clobbering,
 *   and no borrowing the app's own hooks);
 * - links unwrapped from CurseForge's linkout and limited to http(s) and mailto;
 * - images upgraded to https and lazy; inline styles reduced to text alignment;
 * - iframes kept only for YouTube embeds, sandboxed (the CSP allows only those frames);
 * - BBCode and CurseForge spoilers become native <details>.
 * Clicks are handled by the view (external links open in the system browser).
 */

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
const purifier = hasDom ? DOMPurify(window) : undefined;

const youtubeHosts = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
const alignments = new Set(['left', 'center', 'right', 'justify']);
const safeLink = /^(https?:|mailto:)/i;

export interface RichTextLabels {
  /** Summary of a spoiler that has no title of its own. */
  spoiler: string;
}

const spoilerBlock = /\[spoiler(?:=(["']?)(.*?)\1)?\]((?:(?!\[spoiler)[\s\S])*?)\[\/spoiler\]/gi;
const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `[spoiler]…[/spoiler]` (innermost first, so nesting unwinds) to <details>. */
function convertSpoilers(source: string, labels: RichTextLabels): string {
  let text = source;
  for (let pass = 0; pass < 20 && spoilerBlock.test(text); pass++) {
    spoilerBlock.lastIndex = 0;
    text = text.replace(
      spoilerBlock,
      (_match, _quote, title: string | undefined, body: string) =>
        `<details><summary>${escapeText(title || labels.spoiler)}</summary>\n\n${body}\n\n</details>`,
    );
  }
  spoilerBlock.lastIndex = 0;
  return text;
}

function cleanLink(link: HTMLAnchorElement) {
  const raw = link.getAttribute('href')?.trim() ?? '';
  const href = unwrapLinkout(raw.startsWith('//') ? `https:${raw}` : raw);
  link.removeAttribute('target');
  if (!safeLink.test(href)) {
    link.removeAttribute('href');
    return;
  }
  link.setAttribute('href', href.replace(/^http:/i, 'https:'));
  link.setAttribute('rel', 'noopener noreferrer');
  // A bare URL as the text reads better unwrapped too.
  if (link.textContent?.trim() === raw) link.textContent = href;
}

function cleanImage(image: HTMLImageElement) {
  const src = image.getAttribute('src')?.trim() ?? '';
  const upgraded = src.startsWith('//') ? `https:${src}` : src.replace(/^http:/i, 'https:');
  if (!/^(https:|data:image\/)/i.test(upgraded)) {
    image.remove();
    return;
  }
  image.setAttribute('src', upgraded);
  image.removeAttribute('srcset');
  image.setAttribute('loading', 'lazy');
  image.setAttribute('decoding', 'async');
  image.setAttribute('referrerpolicy', 'no-referrer');
}

function cleanFrame(frame: HTMLIFrameElement) {
  let url: URL | undefined;
  try {
    const src = frame.getAttribute('src') ?? '';
    url = new URL(src.startsWith('//') ? `https:${src}` : src);
  } catch {
    url = undefined;
  }
  if (!url || !youtubeHosts.has(url.hostname) || !url.pathname.startsWith('/embed/')) {
    frame.remove();
    return;
  }
  url.protocol = 'https:';
  for (const name of frame.getAttributeNames()) frame.removeAttribute(name);
  frame.setAttribute('src', url.toString());
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
  frame.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('loading', 'lazy');
  // YouTube refuses to play (error 153) without the embedding origin as referrer.
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  const wrap = frame.ownerDocument.createElement('div');
  wrap.dataset.embed = 'video';
  frame.replaceWith(wrap);
  wrap.append(frame);
}

/** CurseForge writes spoilers as `<div class="spoiler">`; they become <details> too. */
function convertSpoilerBlocks(root: DocumentFragment, labels: RichTextLabels) {
  // querySelectorAll is a static list, so replacing nodes while iterating is safe.
  for (const block of root.querySelectorAll('.spoiler')) {
    if (block.closest('details')) continue;
    const details = block.ownerDocument.createElement('details');
    const summary = block.ownerDocument.createElement('summary');
    const header = block.querySelector(':scope > .spoiler-header');
    summary.textContent = header?.textContent?.trim() || labels.spoiler;
    header?.remove();
    details.append(summary, ...block.childNodes);
    block.replaceWith(details);
  }
}

function keepAlignment(element: Element) {
  const style = element.getAttribute('style');
  if (style === null) return;
  const align = /text-align\s*:\s*([a-z]+)/i.exec(style)?.[1]?.toLowerCase();
  if (align && alignments.has(align)) element.setAttribute('style', `text-align: ${align}`);
  else element.removeAttribute('style');
}

function finish(root: DocumentFragment, labels: RichTextLabels) {
  convertSpoilerBlocks(root, labels);
  for (const element of root.querySelectorAll('*')) {
    element.removeAttribute('class');
    keepAlignment(element);
    if (element instanceof HTMLAnchorElement) cleanLink(element);
    else if (element instanceof HTMLImageElement) cleanImage(element);
    else if (element instanceof HTMLIFrameElement) cleanFrame(element);
    else if (element instanceof HTMLTableElement && !element.parentElement?.dataset.embed) {
      // Wide tables scroll inside their own box instead of widening the page.
      const wrap = element.ownerDocument.createElement('div');
      wrap.dataset.embed = 'table';
      element.replaceWith(wrap);
      wrap.append(element);
    }
  }
}

export function renderRichText(source: string, format: 'markdown' | 'html', labels: RichTextLabels): DocumentFragment {
  if (!purifier) throw new Error('Rich text needs a document');
  const input = convertSpoilers(source, labels);
  const html = format === 'markdown' ? (marked.parse(input, { gfm: true, breaks: false, async: false }) as string) : input;
  const fragment = purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    // Provider data-* attributes could otherwise borrow the app's hooks (data-vesta, data-tip).
    ALLOW_DATA_ATTR: false,
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['id', 'name', 'target', 'srcset', 'tabindex', 'contenteditable'],
  });
  finish(fragment, labels);
  return fragment;
}
