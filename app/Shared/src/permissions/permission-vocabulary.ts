import { z } from 'zod';

/**
 * A rule either lets something happen or stops it.
 *
 * Two, and no third. "Not set" is the absence of a rule rather than a rule
 * saying nothing: a stored third value is a thing every reader has to have an
 * opinion about, and the one thing a permission must not be is ambiguous.
 */
export const PERMISSION_EFFECTS = ['allow', 'deny'] as const;

export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

export const permissionEffectSchema = z.enum(PERMISSION_EFFECTS);

export function describePermissionEffect(effect: PermissionEffect): string {
  return effect === 'allow' ? 'Allow' : 'Deny';
}

export const permissionGroupNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the group a name.')
  .max(60, 'Keep the name under 60 characters.');

/**
 * The action a rule names.
 *
 * Not an enum here on purpose. The list of actions lives in the server's
 * authorisation policy, which is the only place that can be right about it, and
 * it arrives on the query that draws this screen. A copy in the contract would
 * be a second list to keep in step, and the failure mode is a rule naming an
 * action nothing checks.
 *
 * A catalogue name never reaches this. A heading is a way of setting the
 * actions under it, not a thing that is stored — the server refuses one here
 * the same way it refuses an action it has never heard of.
 */
export const ruleActionSchema = z
  .string()
  .trim()
  .min(1, 'Say which action the rule is about.')
  .max(60);
