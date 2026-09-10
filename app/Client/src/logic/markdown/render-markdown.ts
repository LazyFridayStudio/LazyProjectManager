import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * How an image is written into a description.
 *
 * Alignment and scale go in the image title, which is standard markdown — any
 * other editor still renders the image, just at its own size. Putting them in
 * the alt text would corrupt the caption, and raw HTML would mean letting
 * `<img>` through the sanitiser for everybody.
 */
export type ImageAlignment = 'left' | 'center' | 'right';

export interface ImagePlacement {
  readonly alignment: ImageAlignment;
  /** A fraction of the box's width, 0 to 1. */
  readonly scale: number;
}

const DEFAULT_PLACEMENT: ImagePlacement = { alignment: 'center', scale: 1 };

const ALIGNMENTS = new Set<string>(['left', 'center', 'right']);

/** `![Alt text](/api/f/018f… "center 0.5")` */
export function writeImageMarkdown(
  altText: string,
  url: string,
  placement: ImagePlacement = DEFAULT_PLACEMENT,
): string {
  return `![${altText}](${url} "${placement.alignment} ${String(placement.scale)}")`;
}

/** Reads a title back, falling back rather than refusing what it cannot parse. */
export function readPlacement(title: string | null | undefined): ImagePlacement {
  const [alignment, scale] = (title ?? '').trim().toLowerCase().split(/\s+/);

  return {
    alignment: ALIGNMENTS.has(alignment ?? '') ? (alignment as ImageAlignment) : 'center',
    scale: clampScale(Number(scale)),
  };
}

/** 0 would be invisible and above 1 would spill out of the box it is in. */
function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }

  return Math.min(1, Math.round(scale * 100) / 100);
}

/**
 * Turns a description into HTML that is safe to put on the page.
 *
 * Sanitised without exception. A description is text one person writes and
 * others read, which is the shape of every stored cross-site scripting bug
 * there has ever been — so `marked` produces the HTML and `DOMPurify` decides
 * what survives, rather than trusting the input because it came from a
 * colleague.
 *
 * Images are rewritten from their title into inline styles here, so the sizing
 * lives in the markdown and nowhere else.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, breaks: true, gfm: true });

  const clean = DOMPurify.sanitize(html, {
    // Scripts, event handlers and iframes go by default and nothing here adds
    // them back.
    ADD_ATTR: ['target', 'rel'],
    // Forms do not go by default, and a form inside a description is somewhere
    // to draw a convincing "sign in again" box on a page somebody already
    // trusts. Nothing a description needs to say requires a control.
    FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'object', 'embed'],
  });

  return applyImagePlacement(clean);
}

/**
 * Reads each image's title and turns it into how the image is drawn.
 *
 * Done on the sanitised HTML rather than by overriding the renderer, so the
 * markdown stays the only place a size is stored and nothing can smuggle a
 * style in through the title.
 */
function applyImagePlacement(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  for (const image of container.querySelectorAll('img')) {
    const placement = readPlacement(image.getAttribute('title'));

    image.removeAttribute('title');
    image.style.width = `${String(Math.round(placement.scale * 100))}%`;
    image.style.height = 'auto';
    image.style.display = 'block';
    image.style.marginLeft = placement.alignment === 'left' ? '0' : 'auto';
    image.style.marginRight = placement.alignment === 'right' ? '0' : 'auto';
  }

  return container.innerHTML;
}
