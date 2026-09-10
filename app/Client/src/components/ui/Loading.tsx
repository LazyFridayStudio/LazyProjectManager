import styles from './Loading.module.css';

/**
 * Something is on its way.
 *
 * One of these rather than the twelve `Loading…` paragraphs there were, each
 * against a different stylesheet and each landing wherever its screen happened
 * to put it — which on every full-page load was the top left corner. A word
 * that appears and vanishes in the top corner inside a single blink does not
 * read as loading, it reads as the page glitching.
 *
 * It centres itself in the box it is given, so the caller decides which region
 * it belongs to: a screen puts it in the content area, a dialog puts it in the
 * dialog. See "The three regions of a screen" in `docs/Engineering-Rules.md`.
 *
 * `role="status"` rather than `aria-live` by hand: it is the polite live region
 * already, so what `what` says is announced once when this appears and does not
 * interrupt anything being read.
 */
export function Loading({ what = 'Loading' }: { what?: string }): React.JSX.Element {
  return (
    <div className={styles.loading} role="status">
      <div className={styles.ring} aria-hidden />
      <span className={styles.word}>{what}…</span>
    </div>
  );
}
