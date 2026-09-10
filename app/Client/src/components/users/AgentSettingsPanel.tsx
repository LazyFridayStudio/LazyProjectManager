import type { Agent } from '@lpm/shared';
import { useEffect, useRef, useState } from 'react';

import { Avatar, Button, Field } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { useSetAgentPicture, useUpdateAgent } from '../../logic/auth/use-agents.js';
import { HowToUseDialog } from './HowToUseDialog.js';
import styles from './AgentsSection.module.css';

/**
 * What an agent is called, and the face it is drawn with.
 *
 * Both are things a person does for themselves on the account window. An agent
 * has no account window — it never signs in and has no screen of its own — so
 * somebody does it here, which is the only reason the product allows either.
 */
export function AgentSettingsPanel({ agent }: { readonly agent: Agent }): React.JSX.Element {
  const [displayName, setDisplayName] = useState(agent.displayName);
  const picker = useRef<HTMLInputElement>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const update = useUpdateAgent();
  const setPicture = useSetAgentPicture(agent.userId);

  // Picking a different agent puts that one's name in the box. Without this the
  // box keeps the last one's, and Save would rename the wrong agent.
  useEffect(() => {
    setDisplayName(agent.displayName);
  }, [agent.userId, agent.displayName]);

  return (
    <section className={styles.panel} aria-label="Agent">
      <h2 className={styles.heading}>
        Agent
        <span className={styles.headingActions}>
          {/* Beside Save rather than at the bottom: somebody who has just made a
              key is looking at this panel and wants the thing to paste. */}
          <Button
            onClick={() => {
              setIsExplaining(true);
            }}
          >
            How to use
          </Button>
          <Button
            tone="go"
            busy={update.isPending}
            busyLabel="Saving…"
            onClick={() => {
              if (displayName.trim() !== '') {
                update.mutate({ userId: agent.userId, displayName: displayName.trim() });
              }
            }}
          >
            Save name
          </Button>
        </span>
      </h2>

      <div className={styles.settings}>
        {/*
          Pressing the face is how the picture is chosen, the same gesture the
          account window uses, rather than a second control beside it saying so.
        */}
        <button
          type="button"
          className={styles.pictureButton}
          aria-label={`Choose a picture for ${agent.displayName}`}
          disabled={setPicture.isPending}
          onClick={() => {
            picker.current?.click();
          }}
        >
          <Avatar url={agent.avatarUrl} initials={agent.initials} className={styles.bigFace} />
        </button>

        <input
          ref={picker}
          className={styles.hiddenPicker}
          type="file"
          accept="image/*"
          aria-label={`Picture for ${agent.displayName}`}
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file !== undefined) setPicture.mutate(file);
          }}
        />

        <div className={styles.settingsFields}>
          <Field
            label="Name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            hint="What it is called in the audit trail and on a card."
          />
        </div>
      </div>

      {update.error !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(update.error)}
        </p>
      )}

      {setPicture.error !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(setPicture.error)}
        </p>
      )}

      {isExplaining && (
        <HowToUseDialog
          agent={agent}
          onClose={() => {
            setIsExplaining(false);
          }}
        />
      )}
    </section>
  );
}
