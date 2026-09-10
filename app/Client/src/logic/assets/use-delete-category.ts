import { DEFAULT_ASSET_CATEGORY, type AssetCategory } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useDisplay } from '../../components/ui/index.js';
import { useDeleteAssetCategory } from './use-assets.js';

/**
 * Asks before a heading comes off the library, then takes it off.
 *
 * This was a component of its own, holding a dialog and a piece of state on the
 * library screen to remember which category it was about. It is a function now:
 * asking is something the display does for anybody, and the answer arrives as a
 * value rather than as a callback into a component that had to exist to catch
 * it.
 */
export function useDeleteCategory(projectSlug: string): (category: AssetCategory) => void {
  const display = useDisplay();
  const remove = useDeleteAssetCategory(projectSlug);

  return (category: AssetCategory): void => {
    void (async () => {
      const said = await display.askToConfirm({
        question: `Delete ${category.name}?`,
        // What happens to what it held is the whole of what somebody needs to
        // know before saying yes, and deleting a category cannot be undone.
        consequence:
          category.count === 0
            ? 'It holds nothing, so nothing moves.'
            : `Its ${String(category.count)} ${category.count === 1 ? 'asset moves' : 'assets move'} to ${DEFAULT_ASSET_CATEGORY.name}. Nothing is thrown away.`,
      });

      if (!said) return;

      remove.mutate(
        { categoryId: category.id },
        {
          onError: (error) => {
            display.showError(describeFailure(error));
          },
        },
      );
    })();
  };
}
