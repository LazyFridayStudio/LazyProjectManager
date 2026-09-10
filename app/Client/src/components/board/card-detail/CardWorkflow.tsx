import type { CardDetailView } from '@lpm/shared';

import { joinClassNames } from '../../../lib/join-class-names.js';
import { useMoveCardToList } from '../../../logic/board/use-cards.js';
import styles from './CardWorkflow.module.css';

export interface CardWorkflowProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}

/**
 * Where the card is on the board, and the way to move it.
 *
 * Live outside edit mode, unlike the fields below it. Dragging a card across the
 * board takes one gesture and asks nothing first, so making the same move from
 * the panel need a round trip through Edit would be the same product disagreeing
 * with itself — and this changes where a card is, not what it says.
 *
 * The card lands at the end of the list it is sent to. Somewhere in the middle
 * is a drag, which is a thing somebody did on purpose with a position in mind.
 *
 * **This is also how a card is closed and reopened**, because the list it sits
 * on is what finished means — the last step closes it and any other reopens it.
 * There is no second control, which is the whole point: a button that could
 * close a card without moving it would be a second answer to the same question.
 */
export function CardWorkflow({
  card,
  projectSlug,
  canWrite,
}: CardWorkflowProps): React.JSX.Element | null {
  const move = useMoveCardToList(projectSlug, card.id);

  if (card.lists.length === 0) {
    return null;
  }

  const finishing = card.lists.at(-1);

  return (
    <div className={styles.workflow}>
      <div className={styles.steps} role="group" aria-label="List">
        {card.lists.map((list) => {
          const isCurrent = list.id === card.listId;

          return (
            <button
              key={list.id}
              type="button"
              className={joinClassNames(styles.step, isCurrent && styles.stepCurrent)}
              style={{ '--list-color': list.color } as React.CSSProperties}
              aria-current={isCurrent}
              // The list it is already in is not somewhere to send it.
              disabled={!canWrite || isCurrent || move.isPending}
              onClick={() => {
                move.mutate({ toListId: list.id });
              }}
            >
              {list.name}
            </button>
          );
        })}
      </div>

      {/* Said in the same word the chip uses, so the panel and the board agree
          about what has happened to the card. */}
      {card.closedAt !== null && (
        <span className={styles.closed}>
          Closed{finishing === undefined ? '' : ` in ${finishing.name}`}
        </span>
      )}
    </div>
  );
}
