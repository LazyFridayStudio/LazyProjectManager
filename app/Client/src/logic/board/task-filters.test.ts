import { describe, expect, it } from 'vitest';
import type { CardChip, TaskRow } from '@lpm/shared';

import {
  cardChipMatches,
  countFilters,
  countMatchingUnder,
  isFiltering,
  isOverBudget,
  NO_FILTERS,
  taskRowMatches,
  toggle,
  UNASSIGNED,
  type TaskFilters,
} from './task-filters.js';

const MY_ID = '00000000-0000-4000-8000-000000000001';
const THEIR_ID = '00000000-0000-4000-8000-000000000002';

function filters(over: Partial<TaskFilters> = {}): TaskFilters {
  return { ...NO_FILTERS, ...over };
}

function chip(over: Partial<CardChip> = {}): CardChip {
  return {
    id: '00000000-0000-4000-8000-00000000000a',
    cardKey: 'BLOK-TASK-1',
    type: 'task',
    title: 'Chunk streaming',
    priority: null,
    points: null,
    estimateMinutes: null,
    loggedMinutes: 0,
    dueOn: null,
    blocked: false,
    closed: false,
    assignee: null,
    isLegend: false,
    gathers: [],
    ...over,
  };
}

function gathered(over: Partial<CardChip['gathers'][number]> = {}): CardChip['gathers'][number] {
  return {
    id: '00000000-0000-4000-8000-00000000000b',
    cardKey: 'BLOK-TASK-2',
    type: 'task',
    title: 'Greedy meshing',
    closed: false,
    assigneeId: null,
    ...over,
  };
}

const person = { userId: MY_ID, displayName: 'Jake', initials: 'JW', avatarUrl: null };

describe('GIVEN a board being narrowed', () => {
  describe('WHEN nothing has been chosen', () => {
    it('THEN it is not filtering, and everything survives', () => {
      expect(isFiltering(NO_FILTERS)).toBe(false);
      expect(countFilters(NO_FILTERS)).toBe(0);
      expect(cardChipMatches(chip(), NO_FILTERS)).toBe(true);
    });
  });

  describe('WHEN several people are chosen at once', () => {
    it('THEN a card on any of them survives', () => {
      const chosen = filters({ assignees: [MY_ID, THEIR_ID] });

      expect(cardChipMatches(chip({ assignee: person }), chosen)).toBe(true);
      expect(cardChipMatches(chip({ assignee: { ...person, userId: THEIR_ID } }), chosen)).toBe(
        true,
      );
    });

    it('THEN a card on nobody does not, unless nobody was asked for', () => {
      expect(cardChipMatches(chip(), filters({ assignees: [MY_ID] }))).toBe(false);
      // "Nobody's" is how work gets picked up, so it is a choice like any other.
      expect(cardChipMatches(chip(), filters({ assignees: [UNASSIGNED] }))).toBe(true);
    });
  });

  describe('WHEN finished work is asked about', () => {
    it('THEN it can be hidden, kept alone, or left as it is', () => {
      const closed = chip({ closed: true });

      expect(cardChipMatches(closed, filters({ completed: 'hide' }))).toBe(false);
      expect(cardChipMatches(closed, filters({ completed: 'only' }))).toBe(true);
      expect(cardChipMatches(closed, filters({ completed: 'any' }))).toBe(true);
      expect(cardChipMatches(chip(), filters({ completed: 'only' }))).toBe(false);
    });
  });

  describe('WHEN the hours are asked about', () => {
    it('THEN work past its estimate is over budget', () => {
      expect(isOverBudget({ estimateMinutes: 60, loggedMinutes: 90 })).toBe(true);
    });

    it('THEN work inside it, or exactly on it, is not', () => {
      expect(isOverBudget({ estimateMinutes: 60, loggedMinutes: 60 })).toBe(false);
      expect(isOverBudget({ estimateMinutes: 60, loggedMinutes: 10 })).toBe(false);
    });

    it('THEN a card nobody estimated is never over a budget it has not got', () => {
      // Not the same as an estimate of nought, which would make every logged
      // minute an overrun.
      expect(isOverBudget({ estimateMinutes: null, loggedMinutes: 600 })).toBe(false);
      expect(cardChipMatches(chip({ loggedMinutes: 600 }), filters({ overBudget: true }))).toBe(
        false,
      );
    });
  });

  describe('WHEN a legend is judged', () => {
    it('THEN it stays if anything under it survives', () => {
      const legend = chip({
        isLegend: true,
        gathers: [gathered({ assigneeId: THEIR_ID }), gathered({ assigneeId: MY_ID })],
      });

      expect(cardChipMatches(legend, filters({ assignees: [MY_ID] }))).toBe(true);
      expect(countMatchingUnder(legend, filters({ assignees: [MY_ID] }))).toBe(1);
    });

    it('THEN it goes when none of them do', () => {
      const legend = chip({ isLegend: true, gathers: [gathered({ assigneeId: THEIR_ID })] });

      expect(cardChipMatches(legend, filters({ assignees: [MY_ID] }))).toBe(false);
    });

    it('THEN an empty legend cannot survive a filter it has nothing to answer with', () => {
      expect(cardChipMatches(chip({ isLegend: true }), filters({ assignees: [MY_ID] }))).toBe(
        false,
      );
    });
  });

  describe('WHEN a row of the task list is judged', () => {
    const row = {
      type: 'bug',
      priority: 'high',
      blocked: true,
      closed: false,
      estimateMinutes: 60,
      loggedMinutes: 120,
      assignee: person,
    } as TaskRow;

    it('THEN it follows the same rules the board does', () => {
      expect(taskRowMatches(row, filters({ types: ['bug'] }))).toBe(true);
      expect(taskRowMatches(row, filters({ types: ['art'] }))).toBe(false);
      expect(taskRowMatches(row, filters({ priorities: ['high'] }))).toBe(true);
      expect(taskRowMatches(row, filters({ blocked: true }))).toBe(true);
      expect(taskRowMatches(row, filters({ overBudget: true }))).toBe(true);
      expect(taskRowMatches(row, filters({ assignees: [THEIR_ID] }))).toBe(false);
    });

    it('THEN every chosen thing has to hold, not just one of them', () => {
      expect(taskRowMatches(row, filters({ types: ['bug'], assignees: [THEIR_ID] }))).toBe(false);
    });
  });

  describe('WHEN chips are pressed', () => {
    it('THEN pressing one that is on takes it off', () => {
      expect(toggle(['art'], 'art')).toEqual([]);
      expect(toggle([], 'art')).toEqual(['art']);
    });

    it('THEN the summary counts every separate thing asked for', () => {
      expect(countFilters(filters({ assignees: [MY_ID], types: ['bug'], completed: 'hide' }))).toBe(
        3,
      );
    });
  });
});
