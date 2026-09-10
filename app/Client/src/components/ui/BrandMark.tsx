import styles from './BrandMark.module.css';

export interface BrandMarkProps {
  /** Drawn square, at the size the place it sits in has room for. */
  readonly size: number;
}

/**
 * The mark drawn wherever a logo belongs.
 *
 * It is the product's own, and it is a default: there is nowhere for a studio
 * to put theirs yet, so every logo area draws this until there is. One
 * component rather than an `<img>` at each of them, so when a studio can
 * upload one there is a single place it has to land — and until then, one place
 * that decides what a logo area shows.
 *
 * The same file the browser puts in the tab, fetched rather than redrawn. A
 * second copy of the shapes is a second thing to remember when the mark
 * changes, and this one has already changed several times.
 *
 * It replaced two letters taken off the front of the server's name. Initials
 * are a reasonable guess at a logo and a poor one at this size: `LF` for Lazy
 * Friday Studio said nothing the name beside it was not already saying.
 */
export function BrandMark({ size }: BrandMarkProps): React.JSX.Element {
  return (
    <img
      className={styles.mark}
      src="/icon.svg"
      alt="LazyProjectManager"
      width={size}
      height={size}
    />
  );
}
