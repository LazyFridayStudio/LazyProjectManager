import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { assetTemplateDefinitionSchema } from '../asset-vocabulary.js';

/**
 * One template, with what it would make.
 *
 * The whole definition rather than a count, because the picker says what an
 * asset is about to be given — "Mesh, UVs, Texture, Rig" — before anybody
 * presses Apply.
 */
export const assetTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  definition: assetTemplateDefinitionSchema,
});

export type AssetTemplate = z.infer<typeof assetTemplateSchema>;

export const assetTemplatesViewSchema = z.object({
  /** By name, which is how somebody looks for one. */
  templates: z.array(assetTemplateSchema),
  /**
   * Whether the person reading this may save, rename or delete them.
   *
   * Asked by the server, so the buttons and the commands behind them cannot
   * disagree about who that is. Applying one is changing an asset, and is not
   * this.
   */
  canManage: z.boolean(),
});

export type AssetTemplatesView = z.infer<typeof assetTemplatesViewSchema>;

/** A project's templates, for the pickers that offer them and the list that keeps them. */
export const assetTemplatesQuery = defineQuery(
  'assets.templates',
  z.object({ projectId: z.string().uuid() }),
  assetTemplatesViewSchema,
);
