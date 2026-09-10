import {
  describePermissionEffect,
  PERMISSION_EFFECTS,
  type PermissionCatalogue,
  type PermissionEffect,
  type PermissionGroup,
  type PermissionsView,
} from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ChevronIcon, Loading } from '../ui/index.js';
import { InstallShell } from '../shell/InstallShell.js';
import { EditPermissionGroupDialog } from './EditPermissionGroupDialog.js';
import { NewPermissionGroupDialog } from './NewPermissionGroupDialog.js';
import { PickLayout, PickList, type Pickable } from '../shell/PickList.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { usePermissions, useSetRule } from '../../logic/permissions/index.js';
import styles from './PermissionsScreen.module.css';

/** Not set first: it is where every rule starts, and it is not a denial. */
const CHOICES = [null, ...PERMISSION_EFFECTS] as const;

/**
 * What each team may and may not do.
 *
 * `read` and `write` were one word for a whole project, so anybody who could
 * move a card could also edit it, rename the list and delete it — all four are
 * `write`. The distinctions studios actually make are about *what*, not how
 * much: a partner writes the content of a card and must not move it, because
 * where a card sits is the producer's statement about the schedule.
 *
 * This screen says what. Which projects a team reaches is still Teams, and the
 * split is deliberate — a hundred projects times twenty actions is a screen
 * nobody can hold in their head.
 */
export function PermissionsScreen(): React.JSX.Element {
  const permissions = usePermissions();

  if (permissions.isPending) {
    return (
      <InstallShell active="permissions" title="Permissions">
        <Loading what="Loading the permission groups" />
      </InstallShell>
    );
  }

  if (permissions.isError) {
    return (
      <InstallShell active="permissions" title="Permissions">
        <p className={styles.problem} role="alert">
          {describeFailure(permissions.error)}
        </p>
      </InstallShell>
    );
  }

  return <Permissions view={permissions.data} />;
}

function Permissions({ view }: { view: PermissionsView }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // The one being read, or the first, so the right-hand side is never blank
  // while there is something to put in it.
  const open = view.groups.find((group) => group.id === openId) ?? view.groups[0] ?? null;

  return (
    <InstallShell
      active="permissions"
      title="Permissions"
      actions={
        <>
          {/* Beside New, because naming a group and taking one away are what
              you do *to* a group rather than part of reading it. */}
          {open !== null && (
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Edit permission group
            </Button>
          )}
          <Button
            tone="go"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            New permission group
          </Button>
        </>
      }
    >
      {view.groups.length === 0 ? (
        <p className={styles.empty}>
          No groups yet. A group is a set of things a team may and may not do — an outsourcer who
          writes cards but never moves them, a junior who makes them but cannot delete one. Make
          one, fill it in, and give it to a team.
        </p>
      ) : (
        <PickLayout
          list={
            <PickList
              label="Permission groups"
              items={view.groups.map(asPickable)}
              pickedId={open?.id ?? null}
              onPick={setOpenId}
            />
          }
        >
          {open !== null && <GroupDetail group={open} catalogues={view.catalogues} />}
        </PickLayout>
      )}

      {isEditing && open !== null && (
        <EditPermissionGroupDialog
          group={open}
          onClose={() => {
            setIsEditing(false);
          }}
          onDeleted={() => {
            // Back to whichever group the list falls to, rather than at a
            // detail panel for something that no longer exists.
            setOpenId(null);
          }}
        />
      )}

      {isAdding && (
        <NewPermissionGroupDialog
          catalogues={view.catalogues}
          onClose={() => {
            setIsAdding(false);
          }}
          onCreated={setOpenId}
        />
      )}
    </InstallShell>
  );
}

/** What a group says, in the six words the list has room for. */
function asPickable(group: PermissionGroup): Pickable {
  const rules = `${String(group.rules.length)} ${group.rules.length === 1 ? 'rule' : 'rules'}`;
  const teams = `${String(group.teams.length)} ${group.teams.length === 1 ? 'team' : 'teams'}`;

  return { id: group.id, name: group.name, facts: `${rules} · ${teams}` };
}

function GroupDetail({
  group,
  catalogues,
}: {
  group: PermissionGroup;
  catalogues: readonly PermissionCatalogue[];
}): React.JSX.Element {
  const chosen = new Map(group.rules.map((rule) => [rule.subject, rule.effect]));

  return (
    <section className={styles.group} aria-label={group.name}>
      {catalogues.map((catalogue) => (
        <Catalogue key={catalogue.value} catalogue={catalogue} group={group} chosen={chosen} />
      ))}
    </section>
  );
}

/**
 * A heading, and everything filed under it.
 *
 * Pressing Allow here writes Allow on every action beneath it — the heading is
 * a way of setting them, not a rule of its own. So it can never disagree with
 * what is under it: it reads back whatever they say, and says `Custom` when
 * they do not all say the same thing.
 */
function Catalogue({
  catalogue,
  group,
  chosen,
}: {
  catalogue: PermissionCatalogue;
  group: PermissionGroup;
  chosen: Map<string, PermissionEffect>;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const setRule = useSetRule();

  const effects = catalogue.actions.map((action) => chosen.get(action.value) ?? null);
  const summary = summarise(effects);

  const setEveryChild = (effect: PermissionEffect | null): void => {
    for (const action of catalogue.actions) {
      setRule.mutate({ groupId: group.id, subject: action.value, effect });
    }
  };

  return (
    <section className={styles.catalogue} aria-label={catalogue.label}>
      <div className={styles.catalogueRow}>
        <button
          type="button"
          className={styles.catalogueName}
          aria-expanded={isOpen}
          onClick={() => {
            setIsOpen((open) => !open);
          }}
        >
          <ChevronIcon isOpen={isOpen} size={11} className={styles.chevron} />
          {catalogue.label}
          {/* What the children add up to, so the heading can be read without
              opening it — and `Custom` is the whole reason this is a summary
              rather than a rule. */}
          <Summary summary={summary} effects={effects} />
        </button>

        <Switch
          name={`Everything under ${catalogue.label}`}
          effect={summary === 'custom' ? null : summary}
          isCustom={summary === 'custom'}
          onChoose={setEveryChild}
        />
      </div>

      {isOpen && (
        <>
          <p className={styles.catalogueAbout}>{catalogue.description}</p>

          <ul className={styles.rules}>
            {catalogue.actions.map((action) => (
              <li key={action.value} className={styles.rule}>
                <div className={styles.ruleRow}>
                  <span className={styles.ruleName}>{action.label}</span>
                  <Switch
                    name={action.label}
                    effect={chosen.get(action.value) ?? null}
                    isCustom={false}
                    onChoose={(effect) => {
                      setRule.mutate({ groupId: group.id, subject: action.value, effect });
                    }}
                  />
                </div>
                <p className={styles.ruleDescription}>{action.description}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Allow, Deny, or nothing at all.
 *
 * Three states rather than a checkbox, because "no rule" is not "denied": a
 * group silent about an action leaves it as the person's role had it, and that
 * is what makes a new group safe to make.
 */
function Switch({
  name,
  effect,
  isCustom,
  onChoose,
}: {
  name: string;
  effect: PermissionEffect | null;
  /** A heading whose children disagree: nothing is checked, and it says so. */
  isCustom: boolean;
  onChoose: (effect: PermissionEffect | null) => void;
}): React.JSX.Element {
  return (
    <div
      className={styles.switch}
      role="radiogroup"
      aria-label={`What this group says about ${name}`}
    >
      {CHOICES.map((choice) => (
        <button
          key={choice ?? 'unset'}
          type="button"
          role="radio"
          aria-checked={!isCustom && effect === choice}
          className={joinClassNames(
            styles.choice,
            choice === 'allow' && styles.allow,
            choice === 'deny' && styles.deny,
          )}
          onClick={() => {
            onChoose(choice);
          }}
        >
          {choice === null ? 'Not set' : describePermissionEffect(choice)}
        </button>
      ))}
    </div>
  );
}

type SummaryOfChildren = PermissionEffect | null | 'custom';

/**
 * What a heading's children add up to.
 *
 * `custom` is the interesting one and the reason the heading is a summary: it
 * is what a group looks like after somebody allows the whole board and then
 * denies moving a card, which is the sentence the feature exists for.
 */
function summarise(effects: readonly (PermissionEffect | null)[]): SummaryOfChildren {
  const first = effects[0] ?? null;

  return effects.every((effect) => effect === first) ? first : 'custom';
}

/**
 * What the children add up to, in the colours of the answers.
 *
 * `Custom` is two answers at once, so it is said as two: the allowed count in
 * the green the Allow button uses and the denied count in the red the Deny
 * button uses, with a rule between them. Reading "6 allowed, 1 denied" in one
 * colour makes somebody count the words to find out which number is which.
 */
function Summary({
  summary,
  effects,
}: {
  summary: SummaryOfChildren;
  effects: readonly (PermissionEffect | null)[];
}): React.JSX.Element {
  if (summary !== 'custom') {
    return (
      <span className={joinClassNames(styles.summary, styles[toneOf(summary)])}>
        {summary === null ? 'Nothing set' : summary === 'allow' ? 'All allowed' : 'All denied'}
      </span>
    );
  }

  const allowed = effects.filter((effect) => effect === 'allow').length;
  const denied = effects.filter((effect) => effect === 'deny').length;

  return (
    <span className={styles.summary}>
      <span className={styles.custom}>Custom</span>
      {/* Hidden from the reading of it: the two counts are their own words and
          a screen reader saying "vertical bar" between them helps nobody. */}
      <span className={styles.separator} aria-hidden>
        |
      </span>
      <span className={styles.allAllowed}>{allowed} allowed</span>
      <span className={styles.separator} aria-hidden>
        |
      </span>
      <span className={styles.allDenied}>{denied} denied</span>
    </span>
  );
}

/**
 * The colour a settled summary is said in.
 *
 * The same three the switch under it uses, because the heading and the buttons
 * are answering the same question and reading them as two different scales is
 * the mistake worth removing. Nothing set stays grey: it is the absence of an
 * answer rather than a third one.
 */
function toneOf(summary: PermissionEffect | null): 'allAllowed' | 'allDenied' | 'nothingSet' {
  if (summary === 'allow') return 'allAllowed';

  return summary === 'deny' ? 'allDenied' : 'nothingSet';
}
