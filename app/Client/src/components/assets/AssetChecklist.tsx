import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import {
  useAddAssetChecklistItem,
  useRemoveAssetChecklistItem,
  useUpdateAssetChecklistItem,
} from '../../logic/assets/use-asset-tabs.js';
import styles from './AssetChecklist.module.css';

export interface AssetChecklistProps {
  readonly blockId: string;
  readonly assetId: string;
  readonly projectSlug: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly done: boolean;
  }[];
  readonly canWrite: boolean;
}

/**
 * A checklist block on one of an asset's tabs: the clips an animation tab has
 * to deliver, the passes a texture goes through.
 *
 * Down the block rather than across it, one line each: a line here is often a
 * sentence — "Charge, the run held for the length of the charge" — and a row of
 * chips wraps a sentence into something nobody can scan.
 *
 * Live without pressing Edit, as everything on a tab is: ticking a clip off is
 * what somebody does while looking at it, and a trip through a form is enough
 * friction to stop them writing it down at all.
 */
export function AssetChecklist({
  blockId,
  assetId,
  projectSlug,
  items,
  canWrite,
}: AssetChecklistProps): React.JSX.Element {
  const [adding, setAdding] = useState<string | null>(null);
  const display = useDisplay();
  const add = useAddAssetChecklistItem(projectSlug, assetId);
  const update = useUpdateAssetChecklistItem(projectSlug, assetId);
  const remove = useRemoveAssetChecklistItem(projectSlug, assetId);

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  /**
   * What a box shows, which is what somebody just asked for while it is in
   * flight and the stored answer the rest of the time.
   *
   * A checkbox driven straight from the server ticks, snaps back, and ticks
   * again a round trip later — which reads as a checkbox that did not take, and
   * on a slow connection somebody presses it twice and turns it back off. Read
   * from the mutation rather than kept in a second piece of state, so there is
   * nothing to leave out of step.
   */
  const inFlight = update.isPending ? update.variables : undefined;

  const shows = (item: { id: string; done: boolean }): boolean =>
    inFlight?.itemId === item.id && inFlight.done !== undefined ? inFlight.done : item.done;

  const submit = (): void => {
    const wanted = adding?.trim() ?? '';

    if (wanted === '') {
      setAdding(null);

      return;
    }

    add.mutate(
      { blockId, title: wanted },
      {
        ...report,
        // Cleared rather than closed: somebody adding Idle is usually adding
        // Walk and Run straight after.
        onSuccess: () => {
          setAdding('');
        },
      },
    );
  };

  return (
    <div className={styles.checklist}>
      {items.length === 0 && !canWrite && <p className={styles.empty}>Nothing on it yet.</p>}

      {items.length > 0 && (
        <ul className={styles.rows}>
          {items.map((item) => (
            <Line
              key={item.id}
              item={item}
              done={shows(item)}
              canWrite={canWrite}
              // Only the line being removed, rather than every line while any one
              // is in flight: ticking four off is four quick presses.
              busy={remove.isPending && remove.variables.itemId === item.id}
              onToggle={(done) => {
                update.mutate({ itemId: item.id, done }, report);
              }}
              onRemove={() => {
                void (async () => {
                  const said = await display.askToConfirm({
                    question: `Remove ${item.title}?`,
                    // Small, but gone: one line somebody typed, and there is
                    // nowhere it can be got back from.
                    consequence: 'The line is taken off the checklist for good.',
                    confirmLabel: 'Remove',
                  });

                  if (said) remove.mutate({ itemId: item.id }, report);
                })();
              }}
            />
          ))}
        </ul>
      )}

      <LineAdder
        canWrite={canWrite}
        adding={adding}
        busy={add.isPending}
        onOpen={() => {
          setAdding('');
        }}
        onType={setAdding}
        onSubmit={submit}
        onGiveUp={() => {
          setAdding(null);
        }}
      />
    </div>
  );
}

interface LineProps {
  readonly item: { readonly id: string; readonly title: string };
  /** What the box shows, which is not `item.done` while a tick is in flight. */
  readonly done: boolean;
  readonly canWrite: boolean;
  readonly busy: boolean;
  readonly onToggle: (done: boolean) => void;
  readonly onRemove: () => void;
}

/** One line: a checkbox, what it says, and the way to take it off. */
function Line({ item, done, canWrite, busy, onToggle, onRemove }: LineProps): React.JSX.Element {
  return (
    <li className={styles.row} data-done={done}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={done}
        disabled={!canWrite || busy}
        aria-label={item.title}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
      <span className={styles.title} data-done={done}>
        {item.title}
      </span>
      {canWrite && (
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${item.title}`}
          title={`Remove ${item.title}`}
          disabled={busy}
          onClick={onRemove}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </li>
  );
}

interface LineAdderProps {
  readonly canWrite: boolean;
  /** What has been typed, or null while the field is closed. */
  readonly adding: string | null;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onType: (typed: string) => void;
  readonly onSubmit: () => void;
  readonly onGiveUp: () => void;
}

/** The button that opens a field for a new line, and the field it opens. */
function LineAdder({
  canWrite,
  adding,
  busy,
  onOpen,
  onType,
  onSubmit,
  onGiveUp,
}: LineAdderProps): React.JSX.Element | null {
  if (!canWrite) return null;

  if (adding === null) {
    return (
      <Button tone="go" size="compact" aria-label="Add item" title="Add item" onClick={onOpen}>
        <span className={styles.addLabel}>
          <ButtonIcon>
            <PlusIcon size={12} />
          </ButtonIcon>
          Add item
        </span>
      </Button>
    );
  }

  return (
    <input
      className={styles.input}
      aria-label="New item"
      placeholder="Idle"
      autoFocus
      value={adding}
      disabled={busy}
      onChange={(event) => {
        onType(event.target.value);
      }}
      onKeyDown={(event) => {
        // Enter adds and stays; Escape gives up. The panel is a form, so
        // without this Enter would submit whatever else is on it.
        if (event.key === 'Enter') {
          event.preventDefault();
          onSubmit();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          onGiveUp();
        }
      }}
      onBlur={onGiveUp}
    />
  );
}
