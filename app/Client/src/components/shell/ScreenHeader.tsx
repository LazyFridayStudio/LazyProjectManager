import styles from './ScreenHeader.module.css';

export interface ScreenHeaderProps {
  /**
   * What the screen is about, drawn as its `<h1>`.
   *
   * Still the heading when `lead` replaces it on screen, so a page always has
   * one and somebody moving by headings always lands somewhere named.
   */
  readonly title: string;
  /**
   * Drawn where the title would be.
   *
   * For the screens outside a project, whose row of places names them better
   * than a word repeating the tab they just pressed.
   */
  readonly lead?: React.ReactNode;
  /**
   * Drawn on the title's own line, after it.
   *
   * For a stamp that belongs to the name rather than to the screen — when a
   * document was last written to, say. Anything you press goes in `actions`.
   */
  readonly beside?: React.ReactNode;
  /**
   * The facts under the title: how many, how much, where from.
   *
   * Short, and set in the monospace face so a column of them lines up. Not a
   * sentence — an explanation belongs in the body of the screen, where there is
   * room to read it.
   */
  readonly facts?: React.ReactNode;
  /** What you can do here: a search, a New something. */
  readonly actions?: React.ReactNode;
}

/**
 * The bar across the top of every screen.
 *
 * Taken from the asset library, which is the one the rest were being compared
 * to: a title with its facts tucked under it, the actions at the other end, and
 * a hairline under the lot. Five screens had already copied it by eye and three
 * had drifted — `align-items: flex-end` here, a 16-pixel gap there, no rule at
 * the bottom on a third — which is exactly what copying by eye does.
 *
 * One component now, so a screen cannot drift again without deleting it.
 */
export function ScreenHeader({
  title,
  lead,
  beside,
  facts,
  actions,
}: ScreenHeaderProps): React.JSX.Element {
  return (
    <div className={styles.header}>
      {/* The name and what is under it, stacked tight: they are one thing said
          in two lines, so nothing separates them. */}
      <div className={styles.names}>
        {lead ?? (
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {beside}
          </div>
        )}
        {/* A row of places names the screen well enough to draw, but a page
            still needs a heading for anybody moving by them. */}
        {lead !== undefined && <h1 className={styles.hiddenTitle}>{title}</h1>}
        {facts !== undefined && <div className={styles.facts}>{facts}</div>}
      </div>

      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
