import {
  CARD_LINK_KINDS,
  describeCardLinkKind,
  describeScmLinkKind,
  type CardDetailView,
  type CardLinkKind,
} from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../../api/failure-messages.js';
import { Avatar, Button, ButtonIcon, Field, PlusIcon, Select, useDisplay } from '../../ui/index.js';
import { useLinkAsset } from '../../../logic/assets/use-assets.js';
import { joinClassNames } from '../../../lib/join-class-names.js';
import { formatTimeAgo } from '../../../logic/projects/format-project-values.js';
import styles from './CardActivity.module.css';
import { CardAssets } from './CardAssets.js';
import { CommentBody } from './CommentBody.js';
import { CommentComposer } from './CommentComposer.js';
import { CardFiles } from './CardFiles.js';
import { CardLegend } from './CardLegend.js';
import { useCardActivity } from '../../../logic/board/card-detail/use-card-activity.js';
import {
  useSuggestions,
  type Suggestions,
} from '../../../logic/board/card-detail/use-card-search.js';

const LINK_KIND_OPTIONS = CARD_LINK_KINDS.map((kind) => ({
  value: kind,
  label: describeCardLinkKind(kind),
}));

export interface CardActivityProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  /**
   * Whether the card itself is being changed — which is Edit, pressed.
   *
   * Everything here except the conversation is a field of the card by another
   * name: a subtask, a link, a file, the legend it sits under. Those follow the
   * panel's one rule, that a card opens to be read.
   */
  readonly canEdit: boolean;
  /**
   * Whether a remark can be left on it, which does not need Edit.
   *
   * A comment changes nothing that was already there. It appends something new,
   * signed and dated, and having something to say about a card is the ordinary
   * consequence of reading one — so making somebody arm every field on the card
   * to type a sentence is the wrong door, and the one moment the panel is most
   * likely to be half-changed by accident.
   */
  readonly canComment: boolean;
  /** Follows a link to another card, in this panel rather than a new one. */
  readonly onOpenCard: (cardId: string) => void;
  /** Opens an asset this card is about, over whatever screen it is on. */
  readonly onOpenAsset: (assetId: string) => void;
}

/**
 * The three things that accumulate on a card: the work broken down, the
 * conversation, and what it is tied to.
 *
 * Two permissions rather than one, and the seam is between changing the card
 * and talking about it. Everything above the conversation waits for Edit; the
 * conversation does not.
 */
export function CardActivity({
  card,
  projectSlug,
  canEdit,
  canComment,
  onOpenCard,
  onOpenAsset,
}: CardActivityProps): React.JSX.Element {
  const actions = useCardActivity(card.id, projectSlug);

  return (
    <>
      <Subtasks card={card} actions={actions} canWrite={canEdit} />
      {/* Above the links, because a clump is what the card belongs to and a
          link is what it happens to touch. */}
      <CardLegend card={card} actions={actions} canWrite={canEdit} onOpenCard={onOpenCard} />
      <Links
        card={card}
        actions={actions}
        canWrite={canEdit}
        projectSlug={projectSlug}
        onOpenCard={onOpenCard}
      />
      <CardAssets
        card={card}
        projectSlug={projectSlug}
        canWrite={canEdit}
        onOpenAsset={onOpenAsset}
      />
      <CardFiles card={card} projectSlug={projectSlug} canWrite={canEdit} />
      <Repository card={card} />
      <Comments
        card={card}
        actions={actions}
        canWrite={canComment}
        onOpenCard={onOpenCard}
        onOpenAsset={onOpenAsset}
      />
    </>
  );
}

interface SectionProps {
  readonly card: CardDetailView;
  readonly actions: ReturnType<typeof useCardActivity>;
  readonly canWrite: boolean;
}

function Subtasks({ card, actions, canWrite }: SectionProps): React.JSX.Element | null {
  const [title, setTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const display = useDisplay();

  // Nothing here and nothing to be done about it: the heading would only be
  // saying the card is empty, which the space it takes says better.
  if (card.subtasks.length === 0 && !canWrite) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>
        Sub-tasks
        {canWrite && (
          <button
            type="button"
            className={styles.headingAction}
            onClick={() => {
              setIsAdding(true);
            }}
          >
            + Add
          </button>
        )}
      </h3>

      <ul className={styles.rows}>
        {card.subtasks.map((subtask) => (
          <li key={subtask.id} className={styles.row}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={subtask.done}
              disabled={!canWrite}
              aria-label={subtask.title}
              onChange={(event) => {
                actions.updateSubtask.mutate({
                  subtaskId: subtask.id,
                  done: event.target.checked,
                });
              }}
            />
            <span className={joinClassNames(styles.rowTitle, subtask.done && styles.done)}>
              {subtask.title}
            </span>
            <span className={styles.state}>{subtask.done ? 'Done' : 'To do'}</span>
            {canWrite && (
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => {
                  void (async () => {
                    const said = await display.askToConfirm({
                      question: `Remove ${subtask.title}?`,
                      // Small, but gone: a step is one line somebody typed and
                      // there is nowhere here it can be got back from.
                      consequence: 'The step is taken off the card for good.',
                      confirmLabel: 'Remove',
                    });

                    if (said) actions.removeSubtask.mutate({ subtaskId: subtask.id });
                  })();
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {canWrite && isAdding && (
        <div className={styles.adder}>
          <div className={styles.adderField}>
            <Field
              label="Add a step"
              placeholder="Retopologise"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </div>
          <Button
            tone="go"
            aria-label="Add"
            title="Add"
            busy={actions.addSubtask.isPending}
            disabled={title.trim() === ''}
            onClick={() => {
              actions.addSubtask.mutate(
                { title },
                {
                  onSuccess: () => {
                    setTitle('');
                  },
                },
              );
            }}
          >
            <ButtonIcon>
              <PlusIcon size={14} />
            </ButtonIcon>
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * One card this card is tied to.
 *
 * The row is the thing you press: a linked card is a card, and the only useful
 * thing to do with one from here is open it. Unlink is a separate press beside
 * it rather than part of the row, so opening and severing cannot be confused.
 */
function LinkedCard({
  link,
  canWrite,
  onOpen,
  onUnlink,
}: {
  readonly link: CardDetailView['links'][number];
  readonly canWrite: boolean;
  readonly onOpen: () => void;
  readonly onUnlink: () => void;
}): React.JSX.Element {
  return (
    <li className={styles.tile}>
      <button type="button" className={styles.tileOpen} onClick={onOpen}>
        <span className={styles.linkKind}>{describeCardLinkKind(link.kind)}</span>
        <span className={styles.linkKey}>{link.cardKey}</span>
        {/* Named in full on hover: a card title is whatever somebody typed, and
            the column it sits in ends in an ellipsis. */}
        <span
          className={joinClassNames(styles.rowTitle, link.closed && styles.linkClosed)}
          title={link.title}
        >
          {link.title}
        </span>
        <span className={styles.state}>{link.closed ? 'Done' : 'To do'}</span>
      </button>

      {canWrite && (
        <button type="button" className={styles.rowAction} onClick={onUnlink}>
          Unlink
        </button>
      )}
    </li>
  );
}

function Links({
  card,
  actions,
  canWrite,
  projectSlug,
  onOpenCard,
}: SectionProps & {
  projectSlug: string;
  onOpenCard: (cardId: string) => void;
}): React.JSX.Element | null {
  const [kind, setKind] = useState<CardLinkKind>('blocks');
  const [search, setSearch] = useState('');
  const suggestions = useSuggestions(card.projectId, search);
  const linkAsset = useLinkAsset(projectSlug, card.id);
  const failure = actions.link.error;
  const isEmpty = card.links.length === 0 && !canWrite;

  const linkTo = (cardKey: string): void => {
    actions.link.mutate(
      { cardId: card.id, toCardKey: cardKey, kind },
      {
        onSuccess: () => {
          setSearch('');
        },
      },
    );
  };

  if (isEmpty) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Linked issues</h3>

      <ul className={styles.tiles}>
        {card.links.map((link) => (
          <LinkedCard
            key={link.id}
            link={link}
            canWrite={canWrite}
            onOpen={() => {
              onOpenCard(link.cardId);
            }}
            onUnlink={() => {
              actions.unlink.mutate({ linkId: link.id });
            }}
          />
        ))}
      </ul>

      {canWrite && (
        <>
          <div className={styles.adder}>
            <Select
              label="Link"
              options={LINK_KIND_OPTIONS}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as CardLinkKind);
              }}
            />
            <div className={styles.adderField}>
              <Field
                label="Search for a card or asset"
                placeholder="ART- or part of the name"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              {/* Anchored to the field and drawn over what is under it, the way
                  a date picker opens, so the rest of the panel does not shift
                  down every time somebody types. */}
              <SuggestionList
                suggestions={suggestions}
                currentCardId={card.id}
                linkedIds={[
                  ...card.links.map((link) => link.cardId),
                  ...card.assetLinks.map((link) => link.assetId),
                ]}
                isLinking={actions.link.isPending || linkAsset.isPending}
                onPickCard={linkTo}
                onPickAsset={(assetId) => {
                  // An asset is not an issue, so it has no link kind and lands
                  // in the section above rather than in this list.
                  linkAsset.mutate(
                    { cardId: card.id, assetId },
                    {
                      onSuccess: () => {
                        setSearch('');
                      },
                    },
                  );
                }}
              />
            </div>
          </div>

          {failure !== null && (
            <p className={styles.problem} role="alert">
              {describeFailure(failure)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface SuggestionListProps {
  readonly suggestions: Suggestions;
  /** The card being looked at, which cannot be linked to itself. */
  readonly currentCardId: string;
  /** Cards and assets already linked, which cannot be linked twice. */
  readonly linkedIds: readonly string[];
  readonly isLinking: boolean;
  readonly onPickCard: (cardKey: string) => void;
  readonly onPickAsset: (assetId: string) => void;
}

/**
 * What was found, as a list of things to press.
 *
 * Cards and assets together, marked by which they are. The card itself and
 * anything already linked are left out rather than shown and refused: an option
 * that cannot be taken is an option nobody should be offered.
 */
function SuggestionList({
  suggestions,
  currentCardId,
  linkedIds,
  isLinking,
  onPickCard,
  onPickAsset,
}: SuggestionListProps): React.JSX.Element | null {
  const cards = suggestions.cards.filter(
    (suggestion) => suggestion.id !== currentCardId && !linkedIds.includes(suggestion.id),
  );
  const assets = suggestions.assets.filter((suggestion) => !linkedIds.includes(suggestion.id));

  if (cards.length === 0 && assets.length === 0) {
    return null;
  }

  return (
    <ul className={styles.suggestions}>
      {cards.map((suggestion) => (
        <li key={suggestion.id}>
          <button
            type="button"
            className={styles.suggestion}
            disabled={isLinking}
            onClick={() => {
              onPickCard(suggestion.cardKey);
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

      {assets.map((suggestion) => (
        <li key={suggestion.id}>
          <button
            type="button"
            className={styles.suggestion}
            disabled={isLinking}
            onClick={() => {
              onPickAsset(suggestion.id);
            }}
          >
            <span className={styles.linkKey}>{suggestion.assetKey}</span>
            <span className={styles.rowTitle}>{suggestion.name}</span>
            {/* Which list it will land in, said before it is pressed rather
                than discovered afterwards. */}
            <span className={styles.state}>{suggestion.categoryName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the repository has said about this card.
 *
 * Read-only, and hidden when there is nothing: a heading saying a card has no
 * commits is a heading on every card that has not been started.
 */
function Repository({ card }: { card: CardDetailView }): React.JSX.Element | null {
  if (card.scmActivity.length === 0) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Repository</h3>

      <ul className={styles.tiles}>
        {card.scmActivity.map((activity) => (
          <li key={`${activity.kind}:${activity.ref}`} className={styles.tile}>
            <span className={styles.linkKind}>{describeScmLinkKind(activity.kind)}</span>
            <span className={styles.linkKey}>
              {activity.url === null ? (
                activity.ref
              ) : (
                <a className={styles.scmRef} href={activity.url} target="_blank" rel="noreferrer">
                  {activity.ref}
                </a>
              )}
            </span>
            <span className={styles.rowTitle}>{activity.message ?? ''}</span>
            <span className={styles.state}>
              {activity.author ?? 'somebody'} · {formatTimeAgo(activity.occurredAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comments({
  card,
  actions,
  canWrite,
  onOpenCard,
  onOpenAsset,
}: SectionProps & {
  readonly onOpenCard: (cardId: string) => void;
  readonly onOpenAsset: (assetId: string) => void;
}): React.JSX.Element | null {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Activity</h3>

      {/* Said rather than left blank. This section is on every card now, so one
          with no conversation has to say that is what it is — an empty heading
          reads as a thing that failed to load. */}
      {card.comments.length === 0 && (
        <p className={styles.empty}>
          {canWrite ? 'Nothing said yet. Be the first.' : 'Nothing said yet.'}
        </p>
      )}

      <div className={styles.comments}>
        {card.comments.map((comment) => {
          const who = comment.author?.displayName ?? 'Somebody who has left';

          return (
            <article key={comment.id} className={styles.comment}>
              <Avatar
                url={comment.author?.avatarUrl}
                // The letters the account stores, when there is somebody to ask.
                // Derived from the name only for a comment whose author has been
                // removed, which is the one case there is nothing to read.
                initials={comment.author?.initials ?? initialsOf(who)}
                className={styles.avatar}
              />
              <div className={styles.commentSaid}>
                <span className={styles.commentWho}>
                  {who} · {formatTimeAgo(comment.createdAt)}
                </span>
                <CommentBody
                  body={comment.body}
                  onOpenCard={onOpenCard}
                  onOpenAsset={onOpenAsset}
                />
              </div>
            </article>
          );
        })}

        {canWrite && (
          <CommentComposer
            projectId={card.projectId}
            busy={actions.comment.isPending}
            onPost={(body) => {
              actions.comment.mutate({ body });
            }}
          />
        )}
      </div>
    </section>
  );
}

/** `M. Kaur` becomes `MK`: at 24px square the name does not fit, and it is on
 * the line beside it anyway. */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .filter((letter) => letter !== '');

  return (letters[0] ?? '') + (letters.length > 1 ? (letters.at(-1) ?? '') : '');
}
