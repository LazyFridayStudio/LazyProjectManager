import { readComment } from '@lpm/shared';

import styles from './CardActivity.module.css';

export interface CommentBodyProps {
  readonly body: string;
  /** Opens a card named in the remark, in the panel that is already open. */
  readonly onOpenCard: (cardId: string) => void;
  /** Opens an asset named in it, over whatever screen this is on. */
  readonly onOpenAsset: (assetId: string) => void;
}

/**
 * A remark, with the things it names worth pressing.
 *
 * Everything that is not a mark is the text somebody typed, printed as they
 * typed it. A comment is not markdown and is not about to become it — the marks
 * are the only thing here with any meaning beyond the words.
 *
 * A person's name is not a link. There is nowhere to go: this install has no
 * screen about one person, and a name that looked pressable and did nothing
 * would be worse than one that plainly does not. It is drawn as a mention so
 * the sentence reads right, and that is all.
 */
export function CommentBody({
  body,
  onOpenCard,
  onOpenAsset,
}: CommentBodyProps): React.JSX.Element {
  return (
    <p className={styles.commentText}>
      {readComment(body).map((piece, index) => {
        // The index is the key on purpose: a comment is immutable once said, so
        // these never reorder, and two identical marks in one sentence have
        // nothing else to tell them apart.
        const key = String(index);

        if (piece.kind === 'text') {
          return <span key={key}>{piece.text}</span>;
        }

        if (piece.markKind === 'user') {
          return (
            <span key={key} className={styles.mention}>
              @{piece.label}
            </span>
          );
        }

        return (
          <button
            key={key}
            type="button"
            className={styles.reference}
            onClick={() => {
              if (piece.markKind === 'card') {
                onOpenCard(piece.id);
                return;
              }

              onOpenAsset(piece.id);
            }}
          >
            #{piece.label}
          </button>
        );
      })}
    </p>
  );
}
