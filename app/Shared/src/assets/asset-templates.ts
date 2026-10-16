import type { AssetTemplateBlock, AssetTemplateDefinition } from './asset-vocabulary.js';
import type { AssetTab, AssetTabBlock } from './queries/asset-detail.js';

/**
 * What a template saved from these tabs would hold.
 *
 * Here rather than on the server, because the panel already has the tabs and
 * `assets.createTemplate` takes a definition: an agent writing a template by
 * hand and a person saving one from an asset send the same thing.
 *
 * What the tabs say, and nothing about who did it. Titles, notes and checklist
 * lines are kept; ticks, people and dates are not, because a template is where
 * the next asset starts. A files or work block is kept as a block and comes back
 * empty, since the files and hours belonged to this asset.
 */
export function templateFromTabs(tabs: readonly AssetTab[]): AssetTemplateDefinition {
  return {
    tabs: tabs.map((tab) => ({
      title: tab.title,
      blocks: tab.blocks.map(templateBlockFrom),
    })),
  };
}

function templateBlockFrom(block: AssetTabBlock): AssetTemplateBlock {
  switch (block.kind) {
    case 'notes':
      return { kind: 'notes', body: block.body ?? '' };
    case 'checklist':
      return { kind: 'checklist', items: block.items.map((item) => item.title) };
    case 'files':
      return { kind: 'files' };
    case 'work':
      return { kind: 'work' };
  }
}

/**
 * The tab titles a template would make, as one line: "Mesh, UVs, Rig".
 *
 * What a picker says under a template's name, so choosing one is choosing what
 * it does rather than trusting what it is called.
 */
export function describeTemplateTabs(definition: AssetTemplateDefinition): string {
  return definition.tabs.length === 0
    ? 'No tabs'
    : definition.tabs.map((tab) => tab.title).join(', ');
}
