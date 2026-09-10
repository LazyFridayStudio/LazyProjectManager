import { describe, expect, it } from 'vitest';

import { hasAtLeastRole, isOutsourcer, membershipRoles } from './membership-roles.js';

describe('GIVEN the membership roles', () => {
  describe('WHEN ranks are compared', () => {
    it('THEN a higher role satisfies a lower requirement', () => {
      expect(hasAtLeastRole('owner', 'member')).toBe(true);
      expect(hasAtLeastRole('member', 'viewer')).toBe(true);
    });

    it('THEN a lower role does not satisfy a higher requirement', () => {
      expect(hasAtLeastRole('viewer', 'member')).toBe(false);
    });

    it('THEN a role satisfies itself', () => {
      expect(membershipRoles.every((role) => hasAtLeastRole(role, role))).toBe(true);
    });
  });

  describe('WHEN an outsourcer is compared by rank', () => {
    it('THEN it satisfies only itself, never a ranked role', () => {
      // An outsourcer is not "less than a member" — it is a different shape of
      // access, decided by the share list rather than by rank.
      expect(hasAtLeastRole('outsourcer', 'viewer')).toBe(false);
      expect(hasAtLeastRole('owner', 'outsourcer')).toBe(false);
      expect(hasAtLeastRole('outsourcer', 'outsourcer')).toBe(true);
    });

    it('THEN it is identified as an outsourcer', () => {
      expect(isOutsourcer('outsourcer')).toBe(true);
      expect(isOutsourcer('member')).toBe(false);
    });
  });
});
