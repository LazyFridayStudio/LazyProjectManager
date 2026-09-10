import { useEffect } from 'react';

/**
 * Scrolls to the category the address names, once there is one to scroll to.
 *
 * The sidebar's tree links to `/p/slug/assets#category-<id>`. A browser follows
 * a hash the moment a page loads, which here is several hundred milliseconds
 * before the library has arrived and the heading exists — so the jump lands
 * nowhere and the address bar keeps a hash that did nothing.
 *
 * Keyed on how many categories are drawn rather than on the hash alone, because
 * the thing that changes between "cannot scroll" and "can" is the content.
 */
export function useScrollToHashedCategory(categoryCount: number): void {
  useEffect(() => {
    const target = window.location.hash.slice(1);

    if (target === '' || categoryCount === 0) {
      return;
    }

    // `getElementById` rather than a selector: an id is what the hash names,
    // and one containing a colon or a dot would need escaping in a selector.
    window.document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [categoryCount]);
}
