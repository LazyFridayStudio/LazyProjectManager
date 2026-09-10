import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import {
  useAddAssetSubtask,
  useRemoveAssetSubtask,
  useUpdateAssetSubtask,
} from '../../logic/assets/use-assets.js';
import styles from './AssetSubtasks.module.css';

export interface AssetSubtasksProps {
  readonly assetId: string;
  readonly projectSlug: string;
  readonly subtasks: readonly {
    readonly id: string;
    readonly title: string;
    readonly done: boolean;
  }[];
  readonly canWrite: boolean;
}

/**
 * The stages an asset is made in: Mesh, UV, Texture, Animation.
 *
 * The status above says how far along the whole thing is, and that is all it
 * can say — a character at `wip` might have a finished mesh and no textures, or
 * the reverse. These are the jobs inside that word, and they are what an art
 * lead schedules around.
 *
 * Freeform, and typed per asset. A prop, a sound and a cinematic each want a
 * different list, so nothing here offers a fixed pipeline to choose from.
 *
 * Live outside edit mode, like the tags below it, and for the same reason:
 * ticking a stage off is what somebody does while looking at the thing, and a
 * trip through Edit is enough friction to stop them writing it down at all.
 */
export function AssetSubtasks({
  assetId,
  projectSlug,
  subtasks,
  canWrite,
}: AssetSubtasksProps): React.JSX.Element | null {
  const [adding, setAdding] = useState<string | null>(null);
  const display = useDisplay();
  const add = useAddAssetSubtask(projectSlug, assetId);
  const update = useUpdateAssetSubtask(projectSlug, assetId);
  const remove = useRemoveAssetSubtask(projectSlug, assetId);

  const report = {
    onError: (error: Error) => {
      display.showError(describeFailure(error));
    },
  };

  // Nothing here and nothing to be done about it: the heading would only be
  // saying the asset is empty, which the space it takes says better.
  if (subtasks.length === 0 && !canWrite) {
    return null;
  }

  /**
   * What a box shows, which is what somebody just asked for while it is in
   * flight and the stored answer the rest of the time.
   *
   * A checkbox driven straight from the server ticks, snaps back, and ticks
   * again a round trip later — the browser paints the click, React repaints the
   * old value underneath it, and the refetch finally agrees. That reads as a
   * checkbox that did not take, and on a slow connection somebody presses it
   * twice and turns it back off.
   *
   * Read from the mutation rather than kept in a second piece of state, so
   * there is nothing to leave out of step: while it is pending this is exactly
   * what was sent, and the moment it settles the panel is showing the answer.
   */
  const inFlight = update.isPending ? update.variables : undefined;

  const shows = (subtask: { id: string; done: boolean }): boolean =>
    inFlight?.assetSubtaskId === subtask.id && inFlight.done !== undefined
      ? inFlight.done
      : subtask.done;

  const done = subtasks.filter((subtask) => shows(subtask)).length;

  const submit = (): void => {
    const wanted = adding?.trim() ?? '';

    if (wanted === '') {
      setAdding(null);

      return;
    }

    add.mutate(
      { assetId, title: wanted },
      {
        ...report,
        // Cleared rather than closed: somebody adding Mesh is usually adding UV
        // and Texture straight after, and reopening the field each time is
        // three extra presses.
        onSuccess: () => {
          setAdding('');
        },
      },
    );
  };

  return (
    <section className={styles.stages} aria-label="Stages">
      <h3 className={styles.heading}>
        Stages
        {subtasks.length > 0 && (
          <span className={styles.progress}>
            {done}/{subtasks.length}
          </span>
        )}
      </h3>

      <ul className={styles.rows}>
        {subtasks.map((subtask) => (
          <Stage
            key={subtask.id}
            subtask={subtask}
            done={shows(subtask)}
            canWrite={canWrite}
            // Only the row being removed, rather than every row while any one of
            // them is in flight: somebody ticking four stages off does it in
            // four quick presses, and disabling the list between them loses the
            // second and third.
            busy={remove.isPending && remove.variables.assetSubtaskId === subtask.id}
            onToggle={(done) => {
              update.mutate({ assetSubtaskId: subtask.id, done }, report);
            }}
            onRemove={() => {
              void (async () => {
                const said = await display.askToConfirm({
                  question: `Remove ${subtask.title}?`,
                  // Small, but gone: a stage is one line somebody typed and
                  // there is nowhere here it can be got back from.
                  consequence: 'The stage is taken off the asset for good.',
                  confirmLabel: 'Remove',
                });

                if (said) remove.mutate({ assetSubtaskId: subtask.id }, report);
              })();
            }}
          />
        ))}
      </ul>

      <StageAdder
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

      {subtasks.length === 0 && !canWrite && <p className={styles.empty}>None yet.</p>}
    </section>
  );
}

interface StageProps {
  readonly subtask: { readonly id: string; readonly title: string };
  /** What the box shows, which is not `subtask.done` while a tick is in flight. */
  readonly done: boolean;
  readonly canWrite: boolean;
  readonly busy: boolean;
  readonly onToggle: (done: boolean) => void;
  readonly onRemove: () => void;
}

/** One stage: a checkbox, what it is called, and the way to take it off. */
function Stage({
  subtask,
  done,
  canWrite,
  busy,
  onToggle,
  onRemove,
}: StageProps): React.JSX.Element {
  return (
    <li className={styles.row} data-done={done}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={done}
        disabled={!canWrite || busy}
        aria-label={subtask.title}
        onChange={(event) => {
          onToggle(event.target.checked);
        }}
      />
      <span className={styles.title} data-done={done}>
        {subtask.title}
      </span>
      {canWrite && (
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${subtask.title}`}
          disabled={busy}
          onClick={onRemove}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </li>
  );
}

interface StageAdderProps {
  readonly canWrite: boolean;
  /** What has been typed, or null while the field is closed. */
  readonly adding: string | null;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onType: (typed: string) => void;
  readonly onSubmit: () => void;
  readonly onGiveUp: () => void;
}

/** The button that opens a field for a new stage, and the field it opens. */
function StageAdder({
  canWrite,
  adding,
  busy,
  onOpen,
  onType,
  onSubmit,
  onGiveUp,
}: StageAdderProps): React.JSX.Element | null {
  if (!canWrite) return null;

  if (adding === null) {
    return (
      <Button tone="go" size="compact" aria-label="Add stage" title="Add stage" onClick={onOpen}>
        <span className={styles.addLabel}>
          <ButtonIcon>
            <PlusIcon size={12} />
          </ButtonIcon>
          Add stage
        </span>
      </Button>
    );
  }

  return (
    <input
      className={styles.input}
      aria-label="New stage"
      placeholder="Mesh"
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
