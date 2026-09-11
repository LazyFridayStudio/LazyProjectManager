import type { AssetDetailView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useDisplay } from '../../components/ui/index.js';
import { asList, countOf } from '../../lib/counted-list.js';
import { useDeleteAsset } from './use-assets.js';

/**
 * Asks before an asset goes, then takes it out of the library.
 *
 * An asset looks like a tile with a name on it, and almost everything that
 * would go with it — the reference sheet, the working files, the stages
 * somebody ticked off — is behind a panel. So the question says what is on it
 * rather than asking about a name alone, the way deleting a card does.
 */
export function useAskToDeleteAsset(
  projectSlug: string,
  onDeleted: () => void,
): (asset: AssetDetailView) => void {
  const display = useDisplay();
  const remove = useDeleteAsset(projectSlug);

  return (asset: AssetDetailView): void => {
    void (async () => {
      const said = await display.askToConfirm({
        question: `Delete ${asset.name}?`,
        consequence: whatGoesWithIt(asset),
      });

      if (!said) return;

      remove.mutate(
        { assetId: asset.id },
        {
          // The panel is showing an asset that no longer exists, so it closes
          // rather than sitting there with an Edit button on it.
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
 * What is on the asset first, because that is the part out of sight. Then the
 * cards it was linked to, which do *not* go — somebody deleting the watchtower
 * needs to know the work on it stays on the board. The week last: it is what
 * makes the answer easy to give.
 */
function whatGoesWithIt(asset: AssetDetailView): string {
  const held = [
    countOf(asset.references.length, 'reference image', 'reference images'),
    countOf(asset.files.length, 'working file', 'working files'),
    countOf(asset.subtasks.length, 'stage', 'stages'),
    countOf(asset.tags.length, 'tag', 'tags'),
  ].filter((part) => part !== null);

  const goes = held.length === 0 ? 'Nothing else is on it.' : `It takes ${asList(held)} with it.`;

  return `${goes}${whatStays(asset.cards.length)} It waits a week in the bin, and can be put back until then.`;
}

/** The cards that were about it, which stay where they are. */
function whatStays(linked: number): string {
  if (linked === 0) {
    return '';
  }

  if (linked === 1) {
    return ' The card linked to it stays on the board.';
  }

  return ` The ${String(linked)} cards linked to it stay on the board.`;
}
