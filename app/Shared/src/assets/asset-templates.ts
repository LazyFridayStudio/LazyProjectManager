import type {
  AssetTemplateBlock,
  AssetTemplateDefinition,
  AssetTemplateOverviewBlock,
} from './asset-vocabulary.js';
import type { AssetDetailView, AssetTabBlock } from './queries/asset-detail.js';

/**
 * What a template saved from this asset would hold: its tabs, and what its
 * Overview shows.
 *
 * Here rather than on the server, because the panel already has the tabs and
 * `assets.createTemplate` takes a definition: an agent writing a template by
 * hand and a person saving one from an asset send the same thing.
 *
 * What the tabs say, and nothing about who did it. Titles, notes and checklist
 * lines are kept; ticks, people and dates are not, because a template is where
 * the next asset starts. A block that shows something the asset has — its
 * files, hours, cost, tags, links — is kept as a block and comes back empty,
 * since what it showed belonged to this asset.
 */
export function templateFromAsset(
  asset: Pick<AssetDetailView, 'tabs' | 'overview'>,
): AssetTemplateDefinition {
  return {
    tabs: asset.tabs.map((tab) => ({
      title: tab.title,
      // A tab only ever holds a tab's kinds; anything else is left out rather
      // than written into a template that could not take it.
      blocks: tab.blocks.map(overviewBlockFrom).filter(isTabBlock),
    })),
    overview: asset.overview.map(overviewBlockFrom),
  };
}

function overviewBlockFrom(block: AssetTabBlock): AssetTemplateOverviewBlock {
  switch (block.kind) {
    case 'notes':
      return { kind: 'notes', body: block.body ?? '' };
    case 'checklist':
      return { kind: 'checklist', items: block.items.map((item) => item.title) };
    default:
      return { kind: block.kind };
  }
}

function isTabBlock(block: AssetTemplateOverviewBlock): block is AssetTemplateBlock {
  return (
    block.kind === 'notes' ||
    block.kind === 'checklist' ||
    block.kind === 'files' ||
    block.kind === 'work'
  );
}

/**
 * The tab titles a template would make, as one line: "Mesh, UVs, Rig".
 *
 * What a picker says under a template's name, so choosing one is choosing what
 * it does rather than trusting what it is called.
 */
export function describeTemplateTabs(definition: Pick<AssetTemplateDefinition, 'tabs'>): string {
  return definition.tabs.length === 0
    ? 'No tabs'
    : definition.tabs.map((tab) => tab.title).join(', ');
}
