import { describeCardType, type CardDetailView } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../../api/failure-messages.js';
import { Button, Field } from '../../ui/index.js';
import { joinClassNames } from '../../../lib/join-class-names.js';
import type { CardActivityActions } from '../../../logic/board/card-detail/use-card-activity.js';
import { useSuggestions } from '../../../logic/board/card-detail/use-card-search.js';
import styles from './CardActivity.module.css';

export interface CardLegendProps {
  readonly card: CardDetailView;
  readonly actions: CardActivityActions;
  readonly canWrite: boolean;
  /** Follows a card in the clump, in this panel rather than a new one. */
  readonly onOpenCard: (cardId: string) => void;
}

/**
 * The clump this card gathers, or the one it belongs to.
 *
 * Work arrives in clumps — a pass over one asset set is nine bugs and four
 * art tasks — and until this there was nowhere to put the clump. The nearest
 * thing was a naming convention typed into every title, which nothing could
 * count and nothing could close.
 *
 * One section rather than two, because a card is only ever one of the two
 * things: a legend gathers and is under nothing, and anything under a legend
 * cannot be one. Which half is drawn says which it is, and there is no state
 * where both are on screen arguing.
 */
export function CardLegend({
  card,
  actions,
  canWrite,
  onOpenCard,
}: CardLegendProps): React.JSX.Element | null {
  // Nothing to say about a card that is neither, unless you can make it one.
  if (!card.isLegend && card.legend === null && !canWrite) {
    return null;
  }

  const name = card.isLegend ? 'Gathered under this' : 'Legend';

  return (
    // Named, so it is a region somebody navigating by landmark can reach — and
    // so a card that is both in a clump and linked to something has two lists
    // of card keys that can be told apart.
    <section className={styles.section} aria-label={name}>
      <h3 className={styles.heading}>{name}</h3>

      {card.isLegend ? (
        <TheClump card={card} actions={actions} canWrite={canWrite} onOpenCard={onOpenCard} />
      ) : (
        <ItsLegend card={card} actions={actions} canWrite={canWrite} onOpenCard={onOpenCard} />
      )}
    </section>
  );
}

/** What is under a legend, and the way to put something else there. */
function TheClump({ card, actions, canWrite, onOpenCard }: CardLegendProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const failure = actions.putUnderLegend.error ?? actions.setLegend.error;

  return (
    <>
      {card.children.length === 0 ? (
        <p className={styles.empty}>
          Nothing under it yet. Add a card by its key, or open a card and name this legend on it.
        </p>
      ) : (
        <ul className={styles.tiles}>
          {card.children.map((child) => (
            <li key={child.id} className={styles.tile}>
              {/* The row is the thing you press: a card in a clump is a card,
                  and the useful thing to do with one from here is open it. */}
              <button
                type="button"
                className={styles.tileOpen}
                onClick={() => {
                  onOpenCard(child.id);
                }}
              >
                <span className={styles.linkKind}>{describeCardType(child.type)}</span>
                <span className={styles.linkKey}>{child.cardKey}</span>
                <span
                  className={joinClassNames(styles.rowTitle, child.closed && styles.linkClosed)}
                  title={child.title}
                >
                  {child.title}
                </span>
                {/* Where it sits, which is the question a clump is opened
                    with: what is left in this. */}
                <span className={styles.state}>{child.listName}</span>
              </button>
              {canWrite && (
                <button
                  type="button"
                  className={styles.rowAction}
                  onClick={() => {
                    actions.putUnderLegend.mutate({ cardId: child.id, legendKey: null });
                  }}
                >
                  Take out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <>
          <div className={styles.adder}>
            {/* Searched rather than typed, and not for the reason the link
                field is: `board.putUnderLegend` names the child by id, and a
                typed key is only ever a key. Picking one from the search is
                what turns it into a card. */}
            <div className={styles.adderField}>
              <Field
                label="Search for a card"
                placeholder="BUG- or part of the title"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              <Gatherable
                card={card}
                search={search}
                isBusy={actions.putUnderLegend.isPending}
                onPick={(cardId) => {
                  actions.putUnderLegend.mutate(
                    { cardId, legendKey: card.cardKey },
                    {
                      onSuccess: () => {
                        setSearch('');
                      },
                    },
                  );
                }}
              />
            </div>
            <Button
              tone="stop"
              busy={actions.setLegend.isPending}
              busyLabel="Saving…"
              onClick={() => {
                actions.setLegend.mutate({ isLegend: false });
              }}
            >
              Stop being a legend
            </Button>
          </div>
        </>
      )}

      {failure !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(failure)}
        </p>
      )}
    </>
  );
}

/**
 * The legend this card is under, or the offer to make it one.
 *
 * A card under a legend is not offered the make-a-legend button, because it
 * cannot be one — the model is one level deep, and a button that always refuses
 * is worse than no button.
 */
function ItsLegend({ card, actions, canWrite, onOpenCard }: CardLegendProps): React.JSX.Element {
  const [key, setKey] = useState('');
  const failure = actions.putUnderLegend.error ?? actions.setLegend.error;

  if (card.legend !== null) {
    const legend = card.legend;

    return (
      <>
        <ul className={styles.tiles}>
          <li className={styles.tile}>
            <button
              type="button"
              className={styles.tileOpen}
              onClick={() => {
                onOpenCard(legend.id);
              }}
            >
              <span className={styles.linkKey}>{legend.cardKey}</span>
              <span className={styles.rowTitle}>{legend.title}</span>
            </button>
            {canWrite && (
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => {
                  actions.putUnderLegend.mutate({ cardId: card.id, legendKey: null });
                }}
              >
                Take out
              </button>
            )}
          </li>
        </ul>

        {failure !== null && (
          <p className={styles.problem} role="alert">
            {describeFailure(failure)}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.adder}>
        <Field
          label="Legend key"
          placeholder="EXMP-TASK-8"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
        <Button
          tone="go"
          disabled={key.trim() === ''}
          busy={actions.putUnderLegend.isPending}
          busyLabel="Saving…"
          onClick={() => {
            actions.putUnderLegend.mutate(
              { cardId: card.id, legendKey: key },
              {
                onSuccess: () => {
                  setKey('');
                },
              },
            );
          }}
        >
          Put under it
        </Button>
        <Button
          tone="go"
          busy={actions.setLegend.isPending}
          busyLabel="Saving…"
          onClick={() => {
            actions.setLegend.mutate({ isLegend: true });
          }}
        >
          Make this a legend
        </Button>
      </div>

      {failure !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(failure)}
        </p>
      )}
    </>
  );
}

/**
 * The cards this legend could gather.
 *
 * Anything already under it is filtered out, and so is the legend — a list
 * offering something that is already there is a list that makes somebody press
 * it to find out.
 */
function Gatherable({
  card,
  search,
  isBusy,
  onPick,
}: {
  card: CardDetailView;
  search: string;
  isBusy: boolean;
  onPick: (cardId: string) => void;
}): React.JSX.Element | null {
  const suggestions = useSuggestions(card.projectId, search);
  const gathered = card.children.map((child) => child.id);
  const offered = suggestions.cards.filter(
    (suggestion) => suggestion.id !== card.id && !gathered.includes(suggestion.id),
  );

  if (offered.length === 0) {
    return null;
  }

  return (
    <ul className={styles.suggestions}>
      {offered.map((suggestion) => (
        <li key={suggestion.id}>
          <button
            type="button"
            className={styles.suggestion}
            disabled={isBusy}
            onClick={() => {
              onPick(suggestion.id);
            }}
          >
            <span className={styles.linkKey}>{suggestion.cardKey}</span>
            <span
              className={joinClassNames(styles.rowTitle, suggestion.closed && styles.linkClosed)}
            >
              {suggestion.title}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
