import { sql, type Kysely } from 'kysely';

/**
 * A rule names one action. A heading is a summary, not a rule.
 *
 * `permission_rule.action` used to hold either an action or a coarse name that
 * stood for several — `card.master` covered seven. That had one advantage: an
 * action added to the product later was covered by every group holding the
 * coarse rule. And one problem that outweighed it: a coarse rule and a specific
 * rule that disagreed needed a precedence, the precedence was invisible on the
 * screen, and "why can they do that" stopped having a readable answer.
 *
 * The headings are now drawn from the actions rather than stored beside them.
 * Pressing Allow on one writes Allow on each action under it, and the heading
 * reads back whatever those say — including `Custom`, when some of them differ.
 *
 * So the coarse rows have to become the rows they stood for. The mapping is
 * written out here rather than imported, because it is a fact about what those
 * words meant on the day this ran, and the application's own list is free to
 * move afterwards.
 */
const WHAT_THE_COARSE_RULES_MEANT: Readonly<Record<string, readonly string[]>> = {
  'card.master': [
    'card.view',
    'card.create',
    'card.update',
    'card.move',
    'card.comment',
    'board.viewList',
    'board.manageList',
  ],
  'card.reader': ['card.view', 'board.viewList'],
  'card.contributor': ['card.view', 'card.update', 'card.comment', 'board.viewList'],
  'project.master': ['project.view', 'project.update', 'project.archive', 'scm.connect'],
  'install.master': ['user.view', 'user.manage', 'team.view', 'team.manage', 'settings.manage'],
};

export async function up(database: Kysely<unknown>): Promise<void> {
  for (const [coarse, actions] of Object.entries(WHAT_THE_COARSE_RULES_MEANT)) {
    /*
     * The children first, then the heading.
     *
     * `on conflict do nothing` because a group may already say something about
     * one of them — and if it does, that is the more specific statement and the
     * one the old precedence would have honoured. Expanding the coarse rule over
     * the top would silently reverse a deny somebody meant.
     */
    await sql`
      insert into permission_rule (account_id, group_id, action, effect)
      select rule.account_id, rule.group_id, unnest(${sql.val(actions)}::text[]), rule.effect
      from permission_rule as rule
      where rule.action = ${coarse}
      on conflict (group_id, action) do nothing
    `.execute(database);

    await sql`delete from permission_rule where action = ${coarse}`.execute(database);
  }

  /*
   * Anything left that is not an action this build knows is dropped.
   *
   * A rule nothing checks is a permission that silently does nothing, which is
   * the worst way for one to be wrong — worse than it being absent, because an
   * absent rule is visibly absent on the screen.
   */
  await sql`
    delete from permission_rule
    where action not in (
      'project.view', 'project.create', 'project.update', 'project.archive',
      'board.viewList', 'board.manageList',
      'card.view', 'card.create', 'card.update', 'card.move', 'card.comment',
      'member.invite', 'member.remove',
      'user.view', 'user.manage', 'team.view', 'team.manage', 'settings.manage',
      'scm.connect'
    )
  `.execute(database);
}

/**
 * Nothing to put back.
 *
 * Rolling this back leaves the expanded rules where they are, which is the
 * honest outcome: seven rows that each say what they mean cannot be folded back
 * into one word without deciding which of them the word was meant to cover, and
 * by then somebody may have changed three of them.
 *
 * Not a no-op by accident. The column still accepts the coarse strings — this
 * migration changed no schema — so a rolled-back build reads these rows exactly
 * as it would have read them before, only more of them.
 */
export async function down(): Promise<void> {
  return Promise.resolve();
}
