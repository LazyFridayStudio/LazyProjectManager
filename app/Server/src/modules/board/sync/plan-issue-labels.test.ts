import { describe, expect, it } from 'vitest';

import { planIssueLabels } from './plan-issue-labels.js';

const LISTS = ['Backlog', 'In progress', 'Ready for review', 'Done'];

describe('GIVEN issues whose cards sit on a board', () => {
  describe('WHEN one is on a list and wearing nothing', () => {
    it('THEN it is given the list it is on', () => {
      const changes = planIssueLabels([{ ref: '41', labels: [], listName: 'Backlog' }], LISTS);

      expect(changes).toEqual([{ ref: '41', add: 'Backlog', remove: [] }]);
    });
  });

  describe('WHEN one has moved along the board', () => {
    it('THEN the list it was on comes off and the list it is on goes on', () => {
      const changes = planIssueLabels(
        [{ ref: '41', labels: ['Backlog'], listName: 'In progress' }],
        LISTS,
      );

      expect(changes).toEqual([{ ref: '41', add: 'In progress', remove: ['Backlog'] }]);
    });

    it('THEN a label the studio put there is left exactly where it is', () => {
      // `needs art` is not a list, so it is not this product's to take off.
      const changes = planIssueLabels(
        [{ ref: '41', labels: ['needs art', 'Backlog'], listName: 'Done' }],
        LISTS,
      );

      expect(changes).toEqual([{ ref: '41', add: 'Done', remove: ['Backlog'] }]);
    });

    it('THEN more than one list label left behind is all taken off', () => {
      // Two syncs racing, or somebody labelling by hand. Either way the board is
      // the answer, and it only has one.
      const changes = planIssueLabels(
        [{ ref: '41', labels: ['Backlog', 'In progress'], listName: 'Done' }],
        LISTS,
      );

      expect(changes[0]?.remove).toEqual(['Backlog', 'In progress']);
    });
  });

  describe('WHEN one is already wearing the right label', () => {
    it('THEN it is left alone, so a sync that changes nothing asks for nothing', () => {
      const changes = planIssueLabels([{ ref: '41', labels: ['Done'], listName: 'Done' }], LISTS);

      expect(changes).toEqual([]);
    });

    it('THEN a difference of case is the same label rather than a second one', () => {
      const changes = planIssueLabels([{ ref: '41', labels: ['done'], listName: 'Done' }], LISTS);

      expect(changes).toEqual([]);
    });
  });

  describe('WHEN an issue has no card here', () => {
    it('THEN nothing is done to it', () => {
      // Read from the repository, never put on the board — this product has no
      // opinion about where it is up to.
      const changes = planIssueLabels([{ ref: '41', labels: ['Backlog'], listName: null }], LISTS);

      expect(changes).toEqual([]);
    });
  });

  describe('WHEN the board has lists nobody else would guess', () => {
    it('THEN those are the labels, because the board is the vocabulary', () => {
      const changes = planIssueLabels(
        [{ ref: '41', labels: ['Concept'], listName: 'Out for approval' }],
        ['Concept', 'Out for approval', 'Shipped'],
      );

      expect(changes).toEqual([{ ref: '41', add: 'Out for approval', remove: ['Concept'] }]);
    });
  });
});
