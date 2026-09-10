import { readPlacement, writeImageMarkdown, type ImagePlacement } from './render-markdown.js';

/**
 * Every markdown image, in the order they appear.
 *
 * Deliberately the same expression used to rewrite one, so what the preview
 * counts and what a drag edits can never disagree about which image is which.
 */
const IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"([^"]*)")?\s*\)/g;

export interface MarkdownImage {
  readonly altText: string;
  readonly url: string;
  readonly placement: ImagePlacement;
}

export function listImages(source: string): readonly MarkdownImage[] {
  return [...source.matchAll(IMAGE)].map((match) => ({
    altText: match[1] ?? '',
    url: stripAngleBrackets(match[2] ?? ''),
    placement: readPlacement(match[3]),
  }));
}

/**
 * Rewrites how one image is placed, leaving everything else exactly as typed.
 *
 * By position rather than by URL: the same image can appear twice in a
 * description, and resizing one of them should not resize the other.
 *
 * The markdown is the only place a size is stored, so a drag ends here — there
 * is no second copy of the number to fall out of step.
 */
export function setImagePlacement(
  source: string,
  index: number,
  placement: ImagePlacement,
): string {
  let seen = -1;

  return source.replace(IMAGE, (whole, altText: string, url: string) => {
    seen += 1;

    return seen === index ? writeImageMarkdown(altText, stripAngleBrackets(url), placement) : whole;
  });
}

/** Markdown allows `<...>` around a URL that contains spaces. */
function stripAngleBrackets(url: string): string {
  return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;
}
