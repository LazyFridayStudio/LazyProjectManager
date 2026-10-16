import { describeTemplateTabs, templateFromAsset, type AssetDetailView } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import {
  useAddAssetTab,
  useApplyAssetTemplate,
  useAssetTemplates,
  useCreateAssetTemplate,
  useDeleteAssetTemplate,
} from '../../logic/assets/use-asset-tabs.js';
import {
  Button,
  ButtonIcon,
  Field,
  Select,
  TrashIcon,
  useDisplay,
  useModalDialog,
} from '../ui/index.js';
import styles from './AssetLibraryScreen.module.css';

export interface AddTabDialogProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  /** Called with the new tab, so the panel can open it. */
  readonly onAdded: (tabId: string) => void;
  readonly onDone: () => void;
}

/**
 * Adds a tab: one named here, or the tabs of one of the project's templates.
 *
 * Both in one place, because they are the same question — what work does this
 * asset need next — and a template is the answer somebody has already written
 * down for the last asset like it.
 */
export function AddTabDialog({
  asset,
  projectSlug,
  onAdded,
  onDone,
}: AddTabDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const add = useAddAssetTab(projectSlug, asset.id);
  const problems = readFieldProblems(add.error);
  const [title, setTitle] = useState('');

  const submit = (): void => {
    if (title.trim() === '') return;

    add.mutate(
      { assetId: asset.id, title: title.trim() },
      {
        onSuccess: (made) => {
          if (made.id !== undefined) onAdded(made.id);
          dialog.close();
        },
      },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Add a tab">
      {/* Not a form: this opens inside the panel's own, and a form inside a
          form is not one. Enter is caught on the field instead, so it adds the
          tab rather than saving the asset. */}
      <div className={styles.dialogForm}>
        <h2 className={styles.dialogHeading}>Add a tab</h2>
        <p className={styles.dialogExplanation}>
          One part of the work on {asset.name}: Mesh, UVs, Rig, Animation.
        </p>

        <Field
          label="Name"
          autoFocus
          placeholder="Rig"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          problem={problems.title}
        />

        <div className={styles.dialogActions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button
            tone="go"
            busy={add.isPending}
            busyLabel="Adding…"
            disabled={title.trim() === ''}
            onClick={submit}
          >
            Add tab
          </Button>
        </div>

        <FromATemplate asset={asset} projectSlug={projectSlug} onApplied={dialog.close} />
      </div>
    </dialog>
  );
}

/**
 * The project's templates, as the other way to add tabs.
 *
 * Says what each would make before anybody presses the button, so choosing
 * one is choosing what it does rather than trusting its name. Nothing at all
 * while the project has none.
 */
function FromATemplate({
  asset,
  projectSlug,
  onApplied,
}: {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly onApplied: () => void;
}): React.JSX.Element | null {
  const templates = useAssetTemplates(asset.project.id);
  const apply = useApplyAssetTemplate(projectSlug, asset.id);
  const remove = useDeleteAssetTemplate(asset.project.id);
  const display = useDisplay();
  const offered = templates.data?.templates ?? [];
  const [chosen, setChosen] = useState('');
  const picked = offered.find((template) => template.id === chosen) ?? offered[0];

  if (picked === undefined) {
    return null;
  }

  return (
    <>
      <h3 className={styles.detailHeading}>Or start from a template</h3>
      <Select
        label="Template"
        options={offered.map((template) => ({
          value: template.id,
          label: `${template.name} — ${describeTemplateTabs(template.definition)}`,
        }))}
        value={picked.id}
        onChange={(event) => {
          setChosen(event.target.value);
        }}
      />
      <div className={styles.dialogActions}>
        {/* Deleted where it is chosen, by whoever keeps the project's
            templates: a template somebody is looking at and no longer wants is
            the one they will reach for the bin beside. */}
        {templates.data?.canManage === true && (
          <Button
            tone="stop"
            aria-label="Delete template"
            title={`Delete ${picked.name}`}
            busy={remove.isPending}
            onClick={() => {
              void (async () => {
                const said = await display.askToConfirm({
                  question: `Delete ${picked.name}?`,
                  consequence:
                    'Assets started from it keep their tabs, and a category that offered it offers nothing. It is not kept in the bin.',
                  confirmLabel: 'Delete template',
                });

                if (!said) return;

                remove.mutate(
                  { templateId: picked.id },
                  {
                    onSuccess: () => {
                      setChosen('');
                    },
                    onError: (error) => {
                      display.showError(describeFailure(error));
                    },
                  },
                );
              })();
            }}
          >
            <ButtonIcon>
              <TrashIcon size={14} />
            </ButtonIcon>
          </Button>
        )}
        <Button
          tone="go"
          busy={apply.isPending}
          busyLabel="Adding…"
          onClick={() => {
            apply.mutate(
              { assetId: asset.id, templateId: picked.id },
              {
                onSuccess: onApplied,
                onError: (error) => {
                  display.showError(describeFailure(error));
                },
              },
            );
          }}
        >
          Add its tabs
        </Button>
      </div>
    </>
  );
}

/**
 * Keeps this asset's tabs and Overview as one of the project's templates.
 *
 * What they say, and nothing about who did it: ticks, people and dates stay on
 * this asset. A name already taken is said on the field, where the thing to
 * change is.
 */
export function SaveTemplateDialog({
  asset,
  onDone,
}: {
  readonly asset: AssetDetailView;
  readonly onDone: () => void;
}): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const create = useCreateAssetTemplate(asset.project.id);
  const display = useDisplay();
  const problems = readFieldProblems(create.error);
  const [name, setName] = useState('');

  const submit = (): void => {
    if (name.trim() === '') return;

    create.mutate(
      { projectId: asset.project.id, name: name.trim(), definition: templateFromAsset(asset) },
      {
        onSuccess: () => {
          display.showInfo(`Saved as ${name.trim()}.`);
          dialog.close();
        },
      },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Save as a template">
      {/* Not a form, for the reason the tab dialog is not one. */}
      <div className={styles.dialogForm}>
        <h2 className={styles.dialogHeading}>Save as a template</h2>
        <p className={styles.dialogExplanation}>
          Its {String(asset.tabs.length)} {asset.tabs.length === 1 ? 'tab' : 'tabs'} and what the
          Overview shows, for the next asset like it. Ticks, people and dates stay here.
        </p>

        <Field
          label="Template name"
          autoFocus
          placeholder="Rigged creature"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          problem={problems.name}
        />

        <div className={styles.dialogActions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button
            tone="go"
            busy={create.isPending}
            busyLabel="Saving…"
            disabled={name.trim() === ''}
            onClick={submit}
          >
            Save template
          </Button>
        </div>
      </div>
    </dialog>
  );
}
