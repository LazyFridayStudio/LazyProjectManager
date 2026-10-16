import { describeTemplateTabs, type AssetTemplate } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import {
  useAssetTemplates,
  useDeleteAssetTemplate,
  useUpdateAssetTemplate,
} from '../../logic/assets/use-asset-tabs.js';
import {
  Button,
  ButtonIcon,
  Field,
  Loading,
  PencilIcon,
  TrashIcon,
  useDisplay,
  useModalDialog,
} from '../ui/index.js';
import libraryStyles from './AssetLibraryScreen.module.css';
import styles from './AssetTabs.module.css';

export interface AssetTemplatesDialogProps {
  readonly projectId: string;
  readonly onDone: () => void;
}

/**
 * The project's templates, kept: renamed, or deleted.
 *
 * Made from an asset rather than here, because a template is the tabs an asset
 * already has — saving the one that shows how a creature should be built is
 * clearer than describing it in a form. This is where they are tidied up.
 */
export function AssetTemplatesDialog({
  projectId,
  onDone,
}: AssetTemplatesDialogProps): React.JSX.Element {
  const dialog = useModalDialog(onDone);
  const templates = useAssetTemplates(projectId);

  return (
    <dialog {...dialog.dialogProps} className={libraryStyles.dialog} aria-label="Templates">
      <div className={libraryStyles.dialogForm}>
        <h2 className={libraryStyles.dialogHeading}>Templates</h2>
        <p className={libraryStyles.dialogExplanation}>
          Sets of tabs a new asset can start from. Save one from an asset whose tabs are set up the
          way you want; a category can offer it to everything added there. Assets already started
          from one keep their tabs whatever happens to it.
        </p>

        {templates.isPending && <Loading what="Loading the templates" />}

        {templates.isError && (
          <p className={libraryStyles.problem} role="alert">
            {describeFailure(templates.error)}
          </p>
        )}

        {templates.isSuccess && templates.data.templates.length === 0 && (
          <p className={styles.empty}>
            None yet. Open an asset, give it tabs, and save them as a template from its Overview.
          </p>
        )}

        {templates.isSuccess && templates.data.templates.length > 0 && (
          <ul className={styles.templates}>
            {templates.data.templates.map((template) => (
              <TemplateRow
                key={template.id}
                projectId={projectId}
                template={template}
                canManage={templates.data.canManage}
              />
            ))}
          </ul>
        )}

        <div className={libraryStyles.dialogActions}>
          <Button onClick={dialog.close}>Close</Button>
        </div>
      </div>
    </dialog>
  );
}

/** One template: its name, what it would make, and the two things to do to it. */
function TemplateRow({
  projectId,
  template,
  canManage,
}: {
  readonly projectId: string;
  readonly template: AssetTemplate;
  readonly canManage: boolean;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  const display = useDisplay();
  const update = useUpdateAssetTemplate(projectId);
  const remove = useDeleteAssetTemplate(projectId);
  const problems = readFieldProblems(update.error);

  if (renaming !== null) {
    return (
      <li className={styles.template}>
        <div className={styles.templateText}>
          <Field
            label="Name"
            autoFocus
            value={renaming}
            problem={problems.name}
            onChange={(event) => {
              setRenaming(event.target.value);
            }}
          />
        </div>
        <Button
          tone="go"
          busy={update.isPending}
          busyLabel="Saving…"
          disabled={renaming.trim() === ''}
          onClick={() => {
            update.mutate(
              { templateId: template.id, name: renaming.trim() },
              {
                onSuccess: () => {
                  setRenaming(null);
                },
              },
            );
          }}
        >
          Save name
        </Button>
        <Button
          tone="stop"
          onClick={() => {
            update.reset();
            setRenaming(null);
          }}
        >
          Cancel
        </Button>
      </li>
    );
  }

  return (
    <li className={styles.template}>
      <span className={styles.templateText}>
        <span className={styles.templateName}>{template.name}</span>
        <span className={styles.templateTabs}>{describeTemplateTabs(template.definition)}</span>
      </span>

      {canManage && (
        <>
          <Button
            size="compact"
            aria-label="Rename template"
            title={`Rename ${template.name}`}
            onClick={() => {
              setRenaming(template.name);
            }}
          >
            <ButtonIcon>
              <PencilIcon size={12} />
            </ButtonIcon>
          </Button>
          <Button
            tone="stop"
            size="compact"
            aria-label="Delete template"
            title={`Delete ${template.name}`}
            busy={remove.isPending}
            onClick={() => {
              void (async () => {
                const said = await display.askToConfirm({
                  question: `Delete ${template.name}?`,
                  consequence:
                    'Assets started from it keep their tabs, and a category that offered it offers nothing. It is not kept in the bin.',
                  confirmLabel: 'Delete template',
                });

                if (!said) return;

                remove.mutate(
                  { templateId: template.id },
                  {
                    onError: (error) => {
                      display.showError(describeFailure(error));
                    },
                  },
                );
              })();
            }}
          >
            <ButtonIcon>
              <TrashIcon size={12} />
            </ButtonIcon>
          </Button>
        </>
      )}
    </li>
  );
}
