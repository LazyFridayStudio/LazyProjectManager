import type { CardDetailView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useDisplay } from '../../components/ui/index.js';
import { useDeleteCard } from './use-cards.js';

/**
 * Asks before a card goes, then takes it off the board.
 *
 * A card looks small and is often not: the board shows a title, and everything
 * that would go with it — the conversation, the sub-tasks somebody ticked off,
 * the files attached to it — is behind a panel nobody is looking at while they
 * press Delete. So the question says what is on it rather than asking about a
 * title alone.
 */
export function useAskToDeleteCard(
  projectSlug: string,
  onDeleted: () => void,
): (card: CardDetailView) => void {
  const display = useDisplay();
  const remove = useDeleteCard(projectSlug);

  return (card: CardDetailView): void => {
    void (async () => {
      const said = await display.askToConfirm({
        question: `Delete ${card.cardKey}?`,
        consequence: whatGoesWithIt(card),
      });

      if (!said) return;

      remove.mutate(
        { cardId: card.id },
        {
          // The panel is showing a card that no longer exists, so it closes
          // rather than sitting there with a Save button on it.
          onSuccess: onDeleted,
          onError: (error) => {
            display.showError(describeFailure(error));
          },
        },
      );
    })();
  };
}

/**
 * What somebody is agreeing to, in the order it matters.
 *
 * What is on the card first, because that is the part that is out of sight.
 * Then the cards a legend was holding, which do *not* go — somebody deleting a
 * legend needs to know that before they press it, not afterwards. The week
 * last: it is what makes the answer easy to give, and saying it first would
 * make the rest read as small print.
 */
function whatGoesWithIt(card: CardDetailView): string {
  const held = [
    countOf(card.subtasks.length, 'sub-task', 'sub-tasks'),
    countOf(card.comments.length, 'comment', 'comments'),
    countOf(card.attachments.length, 'attachment', 'attachments'),
    countOf(card.links.length, 'link to another card', 'links to other cards'),
  ].filter((part) => part !== null);

  const goes = held.length === 0 ? 'Nothing else is on it.' : `Its ${asList(held)} go with it.`;

  return `${goes}${whatStays(card.children.length)} It waits a week in the bin, and can be put back until then.`;
}

/** The cards a legend was holding, which survive it unclumped. */
function whatStays(under: number): string {
  if (under === 0) {
    return '';
  }

  if (under === 1) {
    return ' The card under it stays on the board and stops being grouped.';
  }

  return ` The ${String(under)} cards under it stay on the board and stop being grouped.`;
}

/** Null for none of something, which is a thing to leave out rather than say. */
function countOf(many: number, one: string, several: string): string | null {
  return many === 0 ? null : `${String(many)} ${many === 1 ? one : several}`;
}

/** `a`, `a and b`, `a, b and c`. */
function asList(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? '';

  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}
