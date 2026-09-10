import { describe, expect, it } from 'vitest';

import { connectScmCommand } from './commands/scm-commands.js';
import {
  describeScmLinkKind,
  describeScmProvider,
  repoFullNameSchema,
  SCM_LINK_KINDS,
  SCM_PROVIDERS,
} from './scm-vocabulary.js';

describe('GIVEN the words the repository feature is described in', () => {
  describe('WHEN a provider is named on screen', () => {
    it('THEN every one of them has a name a person would recognise', () => {
      expect(SCM_PROVIDERS.map(describeScmProvider)).toEqual(['GitHub', 'Gitea', 'GitLab']);
    });
  });

  describe('WHEN something the repository said is labelled', () => {
    it('THEN every kind has a label, so none of them shows as a database word', () => {
      for (const kind of SCM_LINK_KINDS) {
        expect(describeScmLinkKind(kind)).not.toBe(kind);
        expect(describeScmLinkKind(kind)).not.toBe('');
      }
    });
  });

  describe('WHEN a repository is named', () => {
    it('THEN it is owner and name, as it appears in its own address', () => {
      expect(repoFullNameSchema.safeParse('northwind/saltmarsh').success).toBe(true);
      expect(repoFullNameSchema.safeParse('northwind/salt.marsh-2').success).toBe(true);
    });

    it('THEN anything that is not two parts is refused', () => {
      for (const wrong of ['saltmarsh', 'north/wind/saltmarsh', '/saltmarsh', 'north wind/x']) {
        expect(repoFullNameSchema.safeParse(wrong).success).toBe(false);
      }
    });
  });

  describe('WHEN a connection is asked for', () => {
    it('THEN a secret short enough to guess is refused', () => {
      const input = {
        projectId: '018f0000-0000-7000-8000-000000000000',
        provider: 'github',
        repoFullName: 'northwind/saltmarsh',
      };

      expect(
        connectScmCommand.inputSchema.safeParse({ ...input, webhookSecret: 'hunter2' }).success,
      ).toBe(false);
      expect(
        connectScmCommand.inputSchema.safeParse({ ...input, webhookSecret: 'w'.repeat(32) })
          .success,
      ).toBe(true);
    });
  });
});
