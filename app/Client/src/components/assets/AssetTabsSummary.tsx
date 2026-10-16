import { describeTemplateTabs, templateFromTabs, type AssetDetailView } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import {
  useApplyAssetTemplate,
  useAssetTemplates,
  useCreateAssetTemplate,
  useUpdateAssetTab,
} from '../../logic/assets/use-asset-tabs.js';
import { Button, Field, Select, useDisplay } from '../ui/index.js';
import styles from './AssetTabs.module.css';

export interface AssetTabsSummaryProps {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
  readonly onOpenTab: (tabId: string) => void;
}

/**
 * The asset's tabs, listed on its Overview: how far along each job is, without
 * opening any of them.
 *
 * Ticking one off here is the same as ticking it off on the tab. Beneath the
 * list, the ways to fill it from the project's templates, and to keep this
 * asset's tabs as one.
 */
export function AssetTabsSummary({
  asset,
  projectSlug,
  canWrite,
  onOpenTab,
}: AssetTabsSummaryProps): React.JSX.Element | null {
  const display = useDisplay();
  const update = useUpdateAssetTab(projectSlug, asset.id);
  const inFlight = update.isPending ? update.variables : undefined;
  const shows = (tab: { id: string; done: boolean }): boolean =>
    inFlight?.assetTabId === tab.id && inFlight.done !== undefined ? inFlight.done : tab.done;
  const done = asset.tabs.filter((tab) => shows(tab)).length;

  // Nothing broken up and nothing to be done about it: the heading would only
  // be saying the asset is one job, which the space it takes says better.
  if (asset.tabs.length === 0 && !canWrite) {
    return null;
  }

  return (
    <section className={styles.summary} aria-label="Tabs">
      <h3 className={styles.blockHeading}>
        Tabs
        {asset.tabs.length > 0 && (
          <span className={styles.progress}>
            {done}/{asset.tabs.length}
          </span>
        )}
      </h3>

      {asset.tabs.length === 0 ? (
        <p className={styles.empty}>
          One job so far. Add a tab for each part of the work — Mesh, Rig, Animation — or start from
          a template.
        </p>
      ) : (
        <ul className={styles.summaryRows}>
          {asset.tabs.map((tab) => (
            <li key={tab.id} className={styles.summaryRow}>
              <input
                type="checkbox"
                checked={shows(tab)}
                disabled={!canWrite}
                aria-label={`${tab.title} done`}
                onChange={(event) => {
                  update.mutate(
                    { assetTabId: tab.id, done: event.target.checked },
                    {
                      onError: (error) => {
                        display.showError(describeFailure(error));
                      },
                    },
                  );
                }}
              />
              <button
                type="button"
                className={styles.summaryOpen}
                data-done={shows(tab)}
                onClick={() => {
                  onOpenTab(tab.id);
                }}
              >
                {tab.title}
              </button>
              <span className={styles.summaryWho}>
                {[tab.assignee?.initials, tab.dueOn]
                  .filter((part) => part !== undefined && part !== null)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canWrite && <ApplyTemplate asset={asset} projectSlug={projectSlug} />}

      {canWrite && asset.canManageTemplates && asset.tabs.length > 0 && (
        <SaveAsTemplate asset={asset} />
      )}
    </section>
  );
}

/**
 * Adds a template's tabs after the ones the asset has.
 *
 * Says what the template would make before anybody presses the button, so
 * choosing one is choosing what it does rather than trusting its name.
 */
function ApplyTemplate({
  asset,
  projectSlug,
}: {
  readonly asset: AssetDetailView;
  readonly projectSlug: string;
}): React.JSX.Element | null {
  const templates = useAssetTemplates(asset.project.id);
  const apply = useApplyAssetTemplate(projectSlug, asset.id);
  const display = useDisplay();
  const [chosen, setChosen] = useState('');
  const offered = templates.data?.templates ?? [];
  const picked = offered.find((template) => template.id === chosen);

  if (offered.length === 0) {
    return null;
  }

  return (
    <div className={styles.templateRow}>
      <Select
        label="Start from a template"
        options={[
          { value: '', label: 'Choose a template' },
          ...offered.map((template) => ({
            value: template.id,
            label: `${template.name} — ${describeTemplateTabs(template.definition)}`,
          })),
        ]}
        value={chosen}
        onChange={(event) => {
          setChosen(event.target.value);
        }}
      />
      <Button
        tone="go"
        busy={apply.isPending}
        busyLabel="Adding…"
        disabled={picked === undefined}
        onClick={() => {
          if (picked === undefined) return;

          apply.mutate(
            { assetId: asset.id, templateId: picked.id },
            {
              onSuccess: () => {
                setChosen('');
              },
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
  );
}

/**
 * Keeps this asset's tabs as one of the project's templates.
 *
 * What the tabs say, and nothing about who did it: ticks, people and dates stay
 * on this asset. A name already taken is said on the field, where the thing to
 * change is.
 */
function SaveAsTemplate({ asset }: { readonly asset: AssetDetailView }): React.JSX.Element {
  const [name, setName] = useState<string | null>(null);
  const create = useCreateAssetTemplate(asset.project.id);
  const display = useDisplay();
  const problems = readFieldProblems(create.error);

  if (name === null) {
    return (
      <div className={styles.actions}>
        <Button
          tone="go"
          size="compact"
          onClick={() => {
            create.reset();
            setName('');
          }}
        >
          Save tabs as a template
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.templateRow}>
      <Field
        label="Template name"
        placeholder="Rigged creature"
        autoFocus
        value={name}
        problem={problems.name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button
        tone="go"
        busy={create.isPending}
        busyLabel="Saving…"
        disabled={name.trim() === ''}
        onClick={() => {
          create.mutate(
            {
              projectId: asset.project.id,
              name: name.trim(),
              definition: templateFromTabs(asset.tabs),
            },
            {
              onSuccess: () => {
                setName(null);
                display.showInfo(`Saved as ${name.trim()}.`);
              },
            },
          );
        }}
      >
        Save template
      </Button>
      <Button
        tone="stop"
        onClick={() => {
          setName(null);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
