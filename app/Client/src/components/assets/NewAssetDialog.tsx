import {
  ASSET_PHASES,
  describeAssetPhase,
  describeTemplateTabs,
  type AssetPhase,
} from '@lpm/shared';
import { useState, type ChangeEvent } from 'react';

import { readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, Select, useModalDialog } from '../ui/index.js';
import { MarkdownField } from '../markdown/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { toMinorUnits } from '../../logic/projects/format-project-values.js';
import { useCreateAsset } from '../../logic/assets/use-assets.js';
import { useAssetTemplates } from '../../logic/assets/use-asset-tabs.js';
import styles from './AssetLibraryScreen.module.css';

const PHASE_OPTIONS = ASSET_PHASES.map((phase) => ({
  value: phase,
  label: describeAssetPhase(phase),
}));

/**
 * The one control here that is not a `Field`, because it is prose — and the
 * same box the asset's description is edited in afterwards, so the markdown
 * somebody writes now is written the way it will be written later.
 *
 * The box stays the height it was. Nothing is written at length before the
 * asset exists, and there is nowhere to put a dropped file until it does.
 */
function Description({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  return (
    <div className={styles.dialogField}>
      <span className={styles.dialogLabel}>Description</span>
      <MarkdownField
        label="Description"
        className={joinClassNames(styles.dialogTextArea)}
        placeholder="What it is, where it appears, what the estimate covers"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onReplace={onChange}
      />
    </div>
  );
}

export interface NewAssetDialogProps {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly currency: string;
  readonly category: {
    readonly id: string;
    readonly name: string;
    /** The template it offers, which the dialog starts on. */
    readonly defaultTemplateId: string | null;
  };
  readonly onDone: () => void;
}

/**
 * Adds a thing the game needs.
 *
 * Only a name is insisted on. Everything else about an asset is learned while
 * making it, and a form that demands a cost estimate before the concept exists
 * is a form people put invented numbers into.
 */
export function NewAssetDialog({
  projectId,
  projectSlug,
  currency,
  category,
  onDone,
}: NewAssetDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const createAsset = useCreateAsset(projectSlug);
  const problems = readFieldProblems(createAsset.error);
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<AssetPhase>('pre_dev');
  // Whatever the category offers, and an empty string for none — which a select
  // cannot say as null. Sent either way, so what the dialog showed is what the
  // asset gets, rather than the server deciding again.
  const [templateId, setTemplateId] = useState(category.defaultTemplateId ?? '');
  const templates = useAssetTemplates(projectId);
  const [cost, setCost] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [description, setDescription] = useState('');

  const submit = (): void => {
    createAsset.mutate(
      {
        projectId,
        categoryId: category.id,
        name: name.trim(),
        phase,
        templateId: templateId === '' ? null : templateId,
        estimatedCostMinor: cost.trim() === '' ? null : toMinorUnits(cost),
        dueOn: dueOn === '' ? null : dueOn,
        description: description.trim() === '' ? null : description,
      },
      { onSuccess: dialog.close },
    );
  };

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="New asset">
      <form
        className={styles.dialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className={styles.dialogHeading}>New asset</h2>
        <p className={styles.dialogExplanation}>It goes to the end of {category.name}.</p>

        <Field
          label="Asset name"
          autoFocus
          placeholder="What it is — which variant"
          value={name}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setName(event.target.value);
          }}
          problem={problems.name}
        />

        <div className={styles.dialogPair}>
          <Select
            label="Phase"
            options={PHASE_OPTIONS}
            value={phase}
            onChange={(event) => {
              setPhase(event.target.value as AssetPhase);
            }}
          />
          {(templates.data?.templates.length ?? 0) > 0 && (
            <Select
              label="Start with tabs from"
              options={[
                { value: '', label: 'No template' },
                ...(templates.data?.templates ?? []).map((template) => ({
                  value: template.id,
                  label: `${template.name} — ${describeTemplateTabs(template.definition)}`,
                })),
              ]}
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
              }}
            />
          )}
        </div>

        <div className={styles.dialogPair}>
          <Field
            label={`Estimated cost (${currency})`}
            placeholder="1800"
            value={cost}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setCost(event.target.value);
            }}
            problem={problems.estimatedCostMinor}
          />
          <Field
            label="Target date"
            type="date"
            value={dueOn}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setDueOn(event.target.value);
            }}
            problem={problems.dueOn}
          />
        </div>

        <Description value={description} onChange={setDescription} />

        <div className={styles.dialogActions}>
          <Button tone="stop" onClick={dialog.close}>
            Cancel
          </Button>
          <Button
            tone="go"
            type="submit"
            busy={createAsset.isPending}
            busyLabel="Adding…"
            disabled={name.trim() === ''}
          >
            Add asset
          </Button>
        </div>
      </form>
    </dialog>
  );
}
