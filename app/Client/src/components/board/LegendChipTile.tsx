import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { describeCardType, type CardChip, type GatheredCard } from '@lpm/shared';
import { useState } from 'react';

import { getColorForCardType } from '../../tokens/card-type-colors.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { ChevronIcon } from '../ui/index.js';
import styles from './LegendChipTile.module.css';

export interface LegendChipTileProps {
  readonly card: CardChip;
  readonly onOpen: (cardId: string) => void;
  /** False on an archived project, where nothing may be moved. */
  readonly canMove: boolean;
  /**
   * How many of the cards under it survive the filter, while the board is
   * narrowed. Undefined when it is not, and then the clump says how much is
   * done instead — which is what it is opened with the rest of the time.
   */
  readonly matching?: number;
}

/**
 * A card that gathers other cards, on the board.
 *
 * Drawn as its own thing rather than as a card with a badge, because it is its
 * own thing: an ordinary card is one piece of work and this is a heading over
 * several. Wider bar down the side, the accent rather than the list's colour,
 * and room for the clump — a legend that looked like everything else would be a
 * heading nobody could find in a column of forty.
 *
 * A `div` rather than a `button`, unlike `CardChipTile`. This one has controls
 * inside it — open the legend, open the clump, open a card in the clump — and a
 * button inside a button is not a thing HTML has.
 *
 * The whole card drags, all the same. `useSortable`'s attributes carry
 * `role="button"`, which is the part that cannot go on a card with buttons in
 * it, so the role is overridden and everything else — the tab stop, the
 * keyboard handler, the sortable description — stays. The pointer sensor waits
 * five pixels before it starts a drag, which is what lets a press on the
 * expander through.
 */
export function LegendChipTile({
  card,
  onOpen,
  canMove,
  matching,
}: LegendChipTileProps): React.JSX.Element {
  const sortable = useSortable({ id: card.id, disabled: !canMove });
  const [isOpen, setIsOpen] = useState(false);

  const done = card.gathers.filter((gathered) => gathered.closed).length;

  return (
    <div
      ref={sortable.setNodeRef}
      className={joinClassNames(styles.legend, sortable.isDragging && styles.dragging)}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      {...sortable.attributes}
      {...sortable.listeners}
      // After the spread, deliberately: the attributes say `button`, and this
      // one holds buttons. A group that describes itself as sortable is what it
      // actually is, and it keeps the tab stop and the keyboard drag.
      role="group"
    >
      <button
        type="button"
        className={styles.open}
        onClick={() => {
          onOpen(card.id);
        }}
      >
        <span className={styles.head}>
          <span className={styles.key}>{card.cardKey}</span>
          {/* On the key's line and pushed to the end, where a card puts its
              type — the same place the eye already goes for what a card is. */}
          <span className={styles.banner}>Legend</span>
        </span>
        <span className={styles.title}>{card.title}</span>
      </button>

      {card.gathers.length === 0 ? (
        <span className={styles.empty}>Nothing under it yet</span>
      ) : (
        <>
          <button
            type="button"
            className={styles.expander}
            aria-expanded={isOpen}
            onClick={() => {
              setIsOpen((open) => !open);
            }}
          >
            <ChevronIcon isOpen={isOpen} size={10} className={styles.chevron} />
            {/* How much is left, which is the question a clump is opened with —
                and the answer often makes opening it unnecessary. */}
            {card.gathers.length} under this
            <span className={styles.progress}>
              {/* Under a filter, how many of them are the reason this clump is
                  still on the board. Nobody is assigned a clump of work, so a
                  legend has to say what kept it rather than claim it matched. */}
              {matching === undefined
                ? `${String(done)} of ${String(card.gathers.length)} done`
                : `${String(matching)} of ${String(card.gathers.length)} shown`}
            </span>
          </button>

          {isOpen && (
            <ul className={styles.clump}>
              {card.gathers.map((gathered) => (
                <Gathered key={gathered.id} card={gathered} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** One card in the clump: its type, its key, and what it is called. */
function Gathered({
  card,
  onOpen,
}: {
  card: GatheredCard;
  onOpen: (cardId: string) => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={styles.gathered}
        style={{ '--type-color': getColorForCardType(card.type) } as React.CSSProperties}
        onClick={() => {
          onOpen(card.id);
        }}
      >
        <span className={styles.typeDot} aria-hidden title={describeCardType(card.type)} />
        <span className={styles.gatheredKey}>{card.cardKey}</span>
        <span className={joinClassNames(styles.gatheredTitle, card.closed && styles.gatheredDone)}>
          {card.title}
        </span>
      </button>
    </li>
  );
}

/** The legend under the pointer while it is being dragged. */
export function DraggedLegend({ card }: { card: CardChip }): React.JSX.Element {
  return (
    <div className={joinClassNames(styles.legend, styles.lifted)}>
      <span className={styles.open}>
        <span className={styles.head}>
          <span className={styles.key}>{card.cardKey}</span>
          <span className={styles.banner}>Legend</span>
        </span>
        <span className={styles.title}>{card.title}</span>
      </span>
      {card.gathers.length > 0 && (
        <span className={styles.empty}>{card.gathers.length} under this — they come with it</span>
      )}
    </div>
  );
}
