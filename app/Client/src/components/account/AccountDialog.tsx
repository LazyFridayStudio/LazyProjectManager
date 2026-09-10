import { THEMES, type Theme } from '@lpm/shared';
import { useEffect, useRef, useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { Button, Field, useDisplay, useModalDialog } from '../ui/index.js';
import { useRequiredIdentity, useSignOut } from '../../logic/auth/use-identity.js';
import { useSetAvatar, useUpdateProfile } from '../../logic/auth/use-account.js';
import { STARTING_COLORS, ThemePanel } from './ThemePanel.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';
import styles from './AccountDialog.module.css';

/**
 * Everything about you, in one window.
 *
 * There was nowhere to change anything about yourself. Your password was on the
 * Users screen — which is behind `user.view`, so on a real install most people
 * could not reach it — and your name and the letters drawn in your place were
 * set once when the account was made and never again.
 *
 * Opened from the same thing in both shells: the block with your name in it, at
 * the foot of a project's sidebar and in the corner of every screen outside
 * one. Nothing here answers to a permission, because everything here is about
 * the person who opened it.
 */
export function AccountDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dialog = useModalDialog(onClose);

  return (
    <dialog {...dialog.dialogProps} className={styles.dialog} aria-label="Your account">
      <div className={styles.body}>
        {/* Two columns: who you are on one side, how you get in on the other.
            The window is wide enough for both, and a single column of fields
            across that width would be inputs a foot long. */}
        <div className={styles.column}>
          <Identity />
          <Picture />
        </div>

        <div className={styles.column}>
          <Appearance />

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Password</h3>
            <ChangePasswordForm onDone={dialog.close} />
          </section>
        </div>

        <Footer onDone={dialog.close} />
      </div>
    </dialog>
  );
}

/**
 * Which theme they read the app in.
 *
 * Saved on the press rather than behind a Save, because the whole of the answer
 * is on screen the moment it lands: somebody choosing a theme is looking at the
 * thing they are choosing. A Save button beside it would be asking them to
 * confirm what they can already see.
 *
 * The choice goes to the server, so it follows them to another machine — and
 * comes back down through `identity.me`, which is what actually turns the app.
 * Nothing here writes to the document.
 */
function Appearance(): React.JSX.Element {
  const identity = useRequiredIdentity();
  const save = useUpdateProfile();

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Appearance</h3>

      <div className={styles.themes} role="radiogroup" aria-label="Theme">
        {THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={identity.user.theme === theme}
            className={joinClassNames(
              styles.theme,
              identity.user.theme === theme && styles.themeChosen,
            )}
            disabled={save.isPending}
            onClick={() => {
              /*
               * Choosing "Yours" with nothing written yet saves the starting
               * palette rather than a theme that is only a word — a person on
               * `custom` with no colours falls back to dark, which would read
               * as a swatch that does nothing.
               */
              save.mutate(
                theme === 'custom'
                  ? { theme, themeColors: identity.user.themeColors ?? STARTING_COLORS }
                  : { theme },
              );
            }}
          >
            {/* The grounds and an accent, which is what the choice is. */}
            <span className={styles.swatch} data-theme={theme} aria-hidden>
              <span className={styles.swatchPanel} />
              <span className={styles.swatchAccent} />
            </span>
            {describeTheme(theme)}
          </button>
        ))}
      </div>

      {/* Under the swatches, and only for the one that has anything to set.
          Dark and Light are not things anybody edits. */}
      {identity.user.theme === 'custom' && (
        <ThemePanel colors={identity.user.themeColors} isChosen />
      )}
    </section>
  );
}

/** What each swatch is called. `custom` is theirs, and says so. */
function describeTheme(theme: Theme): string {
  if (theme === 'dark') {
    return 'Dark';
  }

  return theme === 'light' ? 'Light' : 'Yours';
}

/**
 * What you are called, and what is drawn where a name will not fit.
 *
 * Two fields rather than one that derives the other. The server picks initials
 * from the name when an account is made, and after that they are a choice: a
 * person who writes `JW` for Jacob Winters means it, and a name changed on
 * marriage should not quietly rewrite the mark on four hundred cards.
 */
function Identity(): React.JSX.Element {
  const identity = useRequiredIdentity();
  const [displayName, setDisplayName] = useState(identity.user.displayName);
  const [initials, setInitials] = useState(identity.user.initials);
  const save = useUpdateProfile();
  const { showInfo } = useDisplay();
  const problems = readFieldProblems(save.error);

  // What the server says is the authority, once it has said it.
  useEffect(() => {
    setDisplayName(identity.user.displayName);
    setInitials(identity.user.initials);
  }, [identity.user.displayName, identity.user.initials]);

  const isUnchanged =
    displayName === identity.user.displayName && initials === identity.user.initials;

  return (
    <form
      className={styles.section}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          { displayName, initials },
          {
            onSuccess: () => {
              showInfo('Saved.');
            },
          },
        );
      }}
    >
      <div className={styles.sectionHeading}>
        <h3 className={styles.sectionTitle}>You</h3>
        <span className={styles.headingAction}>
          <Button
            tone="go"
            type="submit"
            disabled={isUnchanged}
            busy={save.isPending}
            busyLabel="Saving…"
          >
            Save
          </Button>
        </span>
      </div>

      <Field
        label="Display name"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
        }}
        problem={problems.displayName}
      />

      <Field
        label="Initials"
        value={initials}
        onChange={(event) => {
          setInitials(event.target.value.toUpperCase());
        }}
        hint="Drawn on cards and in lists, where a name will not fit."
        problem={problems.initials}
      />

      <Problem error={save.error} problems={problems} />

      {/* Read out and not editable. Changing it changes what you sign in with,
          and there is nothing here that could send you an email to prove the
          new one is yours. */}
      <p className={styles.aside}>
        You sign in as <strong>{identity.user.email}</strong>. An admin changes that.
      </p>
    </form>
  );
}

/**
 * Your picture, or the initials drawn in its place.
 *
 * The preview is the thing itself at the size it is actually drawn, so choosing
 * one shows what everybody else will see rather than a picture of it.
 */
function Picture(): React.JSX.Element {
  const identity = useRequiredIdentity();
  const setAvatar = useSetAvatar();
  const picker = useRef<HTMLInputElement>(null);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Picture</h3>

      <div className={styles.pictureRow}>
        {identity.user.avatarUrl === null ? (
          <span className={styles.preview} aria-hidden>
            {identity.user.initials}
          </span>
        ) : (
          <img className={styles.preview} src={identity.user.avatarUrl} alt="" />
        )}

        <Button
          busy={setAvatar.isPending}
          busyLabel="Uploading…"
          onClick={() => {
            picker.current?.click();
          }}
        >
          Choose an image
        </Button>

        <span className={styles.hint}>
          {setAvatar.error === null
            ? 'Square. Shown where there is room for a face.'
            : describeFailure(setAvatar.error)}
        </span>

        <input
          ref={picker}
          type="file"
          accept="image/*"
          className={styles.hiddenPicker}
          aria-label="Picture"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file !== undefined) {
              setAvatar.mutate(file);
            }

            // Cleared so choosing the same file twice in a row still fires.
            event.target.value = '';
          }}
        />
      </div>
    </section>
  );
}

/**
 * The way out, and the way out of the whole app.
 *
 * Signing out lives here now rather than in the header. It is a thing you do to
 * your own session, which is what this window is for, and a button sitting
 * beside every screen's own controls read as another place to go.
 */
function Footer({ onDone }: { onDone: () => void }): React.JSX.Element {
  const signOut = useSignOut();

  return (
    <div className={styles.footer}>
      {/* The accent, not red. `Engineering-Rules` names Sign out among the ones
          that do neither: it ends a session rather than taking something away,
          and signing back in is the whole of undoing it. */}
      <Button
        busy={signOut.isPending}
        busyLabel="Signing out…"
        onClick={() => {
          signOut.mutate();
        }}
      >
        Sign out
      </Button>

      <Button onClick={onDone}>Close</Button>
    </div>
  );
}

/** Whatever went wrong that no field is showing. */
function Problem({
  error,
  problems,
}: {
  readonly error: Error | null;
  readonly problems: Readonly<Record<string, string>>;
}): React.ReactNode {
  if (error === null || Object.keys(problems).length > 0) {
    return null;
  }

  return (
    <p className={styles.problem} role="alert">
      {describeFailure(error)}
    </p>
  );
}
