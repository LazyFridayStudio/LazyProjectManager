import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { describeCardType, type CardChip } from '@lpm/shared';

import { getColorForCardType } from '../../tokens/card-type-colors.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './CardChipTile.module.css';
import { formatShortDate, isOverdue } from '../../logic/board/format-card-values.js';
import { Avatar } from '../ui/index.js';

export interface CardChipTileProps {
  readonly card: CardChip;
  readonly onOpen: (cardId: string) => void;
  /** False on an archived project, where nothing may be moved. */
  readonly canMove: boolean;
}

/**
 * A card on the board: a button that opens it, and a handle that drags it.
 *
 * The whole tile is both. `PointerSensor` only starts a drag after the pointer
 * has travelled a few pixels, which is what lets a click through — otherwise
 * every attempt to open a card would begin a drag nobody asked for.
 */
export function CardChipTile({ card, onOpen, canMove }: CardChipTileProps): React.JSX.Element {
  const sortable = useSortable({ id: card.id, disabled: !canMove });

  return (
    <button
      type="button"
      ref={sortable.setNodeRef}
      className={joinClassNames(styles.card, sortable.isDragging && styles.dragging)}
      style={
        {
          '--type-color': getColorForCardType(card.type),
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
        } as React.CSSProperties
      }
      onClick={() => {
        onOpen(card.id);
      }}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className={styles.head}>
        <span className={styles.typeDot} aria-hidden />
        <span className={styles.key}>{card.cardKey}</span>
        {/* Beside the key, because who has it is part of naming the card and
            not one more number at the bottom of it. */}
        {card.assignee !== null && (
          <Avatar
            url={card.assignee.avatarUrl}
            initials={card.assignee.initials}
            className={styles.assignee}
          />
        )}
        <span className={styles.type}>{describeCardType(card.type)}</span>
      </span>

      <span className={styles.title}>{card.title}</span>

      {/* One mark, not two. A finished card that was stuck is history rather
          than a thing to act on, which is the same reading the burndown takes
          of a blocked card once it closes. */}
      {card.closed ? (
        <span className={styles.closed}>Closed</span>
      ) : (
        card.blocked && <span className={styles.blocked}>Blocked</span>
      )}

      <span className={styles.footer}>
        {card.dueOn !== null && (
          <span className={isOverdue(card.dueOn) ? styles.overdue : undefined}>
            {formatShortDate(card.dueOn)}
          </span>
        )}
        <span className={styles.points}>
          {card.points === null ? '—' : `${String(card.points)} pts`}
        </span>
      </span>
    </button>
  );
}

/** The card under the pointer while it is being dragged. */
export function DraggedCard({ card }: { card: CardChip }): React.JSX.Element {
  return (
    <div
      className={joinClassNames(styles.card, styles.lifted)}
      style={{ '--type-color': getColorForCardType(card.type) } as React.CSSProperties}
    >
      <span className={styles.head}>
        <span className={styles.typeDot} aria-hidden />
        <span className={styles.key}>{card.cardKey}</span>
        {card.assignee !== null && (
          <Avatar
            url={card.assignee.avatarUrl}
            initials={card.assignee.initials}
            className={styles.assignee}
          />
        )}
        <span className={styles.type}>{describeCardType(card.type)}</span>
      </span>
      <span className={styles.title}>{card.title}</span>
    </div>
  );
}
