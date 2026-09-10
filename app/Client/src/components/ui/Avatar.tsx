import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './Avatar.module.css';

/**
 * A person, drawn small.
 *
 * Their picture if they have chosen one, and the two or three letters they are
 * known by if they have not. Every place that drew a person drew the letters
 * and nothing else — a card chip, a comment, a row of a team, a bar on the
 * timeline — so a picture set in the account window showed up in exactly two
 * places and nowhere anybody else would see it.
 *
 * One component rather than an `img` added beside eleven spans, because the
 * choice between the two is the same choice every time and the fallback is the
 * half that gets forgotten.
 *
 * The shape stays with the caller. A chip's avatar, a table row's and the
 * sidebar's are different sizes and different corners, and that is the screen's
 * business — this decides only what goes inside, and that a picture is cropped
 * to the box rather than stretched into it.
 */
export function Avatar({
  url,
  initials,
  className,
}: {
  /** Where their picture is, or null for somebody who has not set one. */
  readonly url: string | null | undefined;
  readonly initials: string;
  readonly className?: string | undefined;
}): React.JSX.Element {
  if (url === null || url === undefined || url === '') {
    return (
      <span className={className} aria-hidden>
        {initials}
      </span>
    );
  }

  /*
   * Empty `alt`, and hidden, exactly as the initials are.
   *
   * Everywhere this is used, the person's name is already beside it in text. A
   * picture that announced the name again would have a screen reader say it
   * twice, and the second time in a worse voice.
   */
  return <img className={joinClassNames(className, styles.picture)} src={url} alt="" aria-hidden />;
}
