import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { permissionEffectSchema } from '../permission-vocabulary.js';

/**
 * One action, as the screen needs to draw it.
 *
 * Sent from the server rather than listed in this contract, because the list of
 * actions lives in the authorisation policy and that is the only place that can
 * be right about it. A new action appears on this screen the moment it exists,
 * under whichever catalogue it was filed in.
 */
export const permissionActionSchema = z.object({
  value: z.string(),
  label: z.string(),
  /** What it lets somebody do, in a sentence. */
  description: z.string(),
});

export type PermissionAction = z.infer<typeof permissionActionSchema>;

/**
 * A heading, and everything filed under it.
 *
 * Not a permission. Nothing stores a catalogue — pressing Allow on one writes
 * Allow on each action beneath it, and the heading reads back whatever those
 * say. A heading that could also be a rule is a heading that can disagree with
 * its own children, and then the screen has a precedence to explain.
 */
export const permissionCatalogueSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string(),
  actions: z.array(permissionActionSchema),
});

export type PermissionCatalogue = z.infer<typeof permissionCatalogueSchema>;

export const permissionRuleSchema = z.object({
  subject: z.string(),
  effect: permissionEffectSchema,
});

export const permissionGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Only the rules that say something. An action with no rule is absent. */
  rules: z.array(permissionRuleSchema),
  /** The teams holding this group, by name, so the screen says who it reaches. */
  teams: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      /**
       * Where this group sits in that team's list.
       *
       * On the holding rather than on the group, because the same group is in a
       * different place in each team that holds it. Reading order only — it
       * decides how the panel is drawn and nothing about what anybody may do.
       */
      position: z.number().int(),
    }),
  ),
});

export type PermissionGroup = z.infer<typeof permissionGroupSchema>;

export const permissionsViewSchema = z.object({
  groups: z.array(permissionGroupSchema),
  /** Every team, so a group can be given to one without a second request. */
  teams: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  /** Every action, filed under the heading it belongs to. */
  catalogues: z.array(permissionCatalogueSchema),
});

export type PermissionsView = z.infer<typeof permissionsViewSchema>;

/**
 * Every permission group, with what each says and who holds it.
 *
 * All of them rather than a page. A studio can have a hundred, which is a lot
 * of rows and not a lot of bytes — they are arrangements rather than people, and
 * each is a name and a handful of rules. Both screens that read this narrow it
 * where somebody is looking rather than asking again.
 *
 * The number to watch is rules, not groups: a hundred groups each saying
 * something about all forty-odd actions is the shape that would make this worth
 * paging.
 */
export const permissionsQuery = defineQuery(
  'permissions.groups',
  z.object({}),
  permissionsViewSchema,
);
