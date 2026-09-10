import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { ApiClientProvider } from './ApiClientProvider.js';
import { Backdrop } from './shell/Backdrop.js';
import { describeFailure, isRefusal, readFieldProblems } from '../api/failure-messages.js';
import { DisplayProvider, useDisplay, type Display } from './ui/index.js';
import { AuthScreen } from './auth/AuthScreen.js';
import { useSignedInUser } from '../logic/auth/use-identity.js';
import { router } from '../router.js';
import { useTheme } from '../logic/auth/use-theme.js';

/**
 * Every command that fails says so, in one place.
 *
 * It used to be said in twenty: each screen grew its own paragraph under
 * whatever control had just failed, and each one was a chance to forget. The
 * ones that got forgotten were the quiet failures — a card that did not move, a
 * repository that did not disconnect — where the screen simply did not change
 * and nobody could tell whether they had pressed it.
 *
 * On the mutation cache rather than in each hook, because a command failing is
 * one kind of event however many hooks there are, and a rule written once
 * cannot be left out of the twenty-first.
 *
 * Queries are deliberately not here. A screen whose data will not load says so
 * in its own body: a message in the corner that fades after ten seconds would
 * leave somebody looking at an empty page with no explanation.
 */
function createQueryClient(display: Display): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        /*
         * A problem with a field belongs on that field.
         *
         * The form draws it under the control it is about, where somebody is
         * already looking, and repeating it in the corner would be the same
         * sentence twice.
         */
        if (Object.keys(readFieldProblems(error)).length > 0) {
          return;
        }

        /*
         * A rule saying no is yellow; a fault is red.
         *
         * A card refused by a work-in-progress limit is the limit working, and
         * red is how the product says it broke. The message is the same either
         * way — what changes is whether somebody reads it as "you cannot do
         * that" or as "something is wrong with this software".
         */
        if (isRefusal(error)) {
          display.showWarning(describeFailure(error));
          return;
        }

        display.showError(describeFailure(error));
      },
    }),
    defaultOptions: {
      queries: {
        // The board and project views are pushed at by WebSocket invalidation
        // from step 4 onward, so polling on focus would duplicate that work.
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
}

export function AppRoot(): React.JSX.Element {
  return (
    /*
     * Above the query client, so a failed command can be announced by the thing
     * that noticed it. Nothing in the display needs a query, so it costs
     * nothing to have it outermost — and it is outside the signed-in gate
     * either way, so the sign-in screen can say things too.
     */
    <DisplayProvider>
      <WithQueryClient>
        <ApiClientProvider>
          <SignedInGate />
        </ApiClientProvider>
      </WithQueryClient>
    </DisplayProvider>
  );
}

/**
 * The query client, built once with a way to speak.
 *
 * `useState` rather than `useMemo`: this must survive a re-render, and a memo is
 * a hint rather than a promise.
 */
function WithQueryClient({ children }: { children: React.ReactNode }): React.JSX.Element {
  const display = useDisplay();
  const [queryClient] = useState(() => createQueryClient(display));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * Chooses between the app and the login screen.
 *
 * Renders nothing while the first `identity.me` is in flight. A flash of the
 * login screen for an already-signed-in user is worse than a blank moment: it
 * reads as having been signed out.
 *
 * The router is mounted only inside the signed-in branch, so no route can be
 * reached without an identity behind it.
 */
function SignedInGate(): React.JSX.Element | null {
  const signedInUser = useSignedInUser();

  /*
   * Before the branch, because a hook cannot be called after a return — and
   * because it is right anyway: signing out should leave the theme where it
   * was, so the sign-in screen looks like the app the person just left.
   */
  useTheme(signedInUser.data?.user.theme, signedInUser.data?.user.themeColors ?? null);

  if (signedInUser.isPending) {
    return null;
  }

  const identity = signedInUser.data;

  if (identity === null || identity === undefined) {
    return <AuthScreen />;
  }

  /*
   * The same field of motes the sign-in screen has, quieter, behind the whole
   * app. Drawn once here rather than by each screen: it is the ground the app
   * sits on, and a canvas that remounted on every route change would restart
   * its drift every time somebody opened a project.
   */
  return (
    <>
      <Backdrop mood="app" />
      <RouterProvider router={router} />
    </>
  );
}
