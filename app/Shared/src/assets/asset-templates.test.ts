import { describe, expect, it } from 'vitest';

import { describeTemplateTabs, templateFromTabs } from './asset-templates.js';
import { assetTemplateDefinitionSchema } from './asset-vocabulary.js';
import type { AssetTab } from './queries/asset-detail.js';

const RIG: AssetTab = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Rig',
  done: true,
  assignee: {
    userId: '00000000-0000-4000-8000-0000000000aa',
    displayName: 'Mira',
    initials: 'MK',
    avatarUrl: null,
  },
  dueOn: '2026-11-01',
  blocks: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'notes',
      body: 'Humanoid, with a tail.',
      items: [],
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      kind: 'checklist',
      body: null,
      items: [
        { id: '00000000-0000-4000-8000-000000000004', title: 'Skeleton', done: true },
        { id: '00000000-0000-4000-8000-000000000005', title: 'Weights', done: false },
      ],
    },
    { id: '00000000-0000-4000-8000-000000000006', kind: 'files', body: null, items: [] },
    { id: '00000000-0000-4000-8000-000000000007', kind: 'work', body: null, items: [] },
  ],
};

describe('GIVEN the tabs of an asset somebody has been working on', () => {
  describe('WHEN they are saved as a template', () => {
    const definition = templateFromTabs([RIG]);

    it('THEN what the tabs say is kept: titles, notes and checklist lines', () => {
      expect(definition).toEqual({
        tabs: [
          {
            title: 'Rig',
            blocks: [
              { kind: 'notes', body: 'Humanoid, with a tail.' },
              { kind: 'checklist', items: ['Skeleton', 'Weights'] },
              { kind: 'files' },
              { kind: 'work' },
            ],
          },
        ],
      });
    });

    it('THEN nothing about who did it comes along: no ticks, no person, no date', () => {
      expect(JSON.stringify(definition)).not.toContain('Mira');
      expect(JSON.stringify(definition)).not.toContain('2026-11-01');
      expect(JSON.stringify(definition)).not.toContain('done');
    });

    it('THEN it is a definition the server will take', () => {
      expect(assetTemplateDefinitionSchema.safeParse(definition).success).toBe(true);
    });
  });

  describe('WHEN a notes block was never written in', () => {
    it('THEN it is kept as an empty note rather than dropped', () => {
      const empty = templateFromTabs([
        { ...RIG, blocks: [{ id: RIG.id, kind: 'notes', body: null, items: [] }] },
      ]);

      expect(empty.tabs[0]?.blocks).toEqual([{ kind: 'notes', body: '' }]);
    });
  });
});

describe('GIVEN a template', () => {
  describe('WHEN a picker says what it would make', () => {
    it('THEN it reads as the tab titles, in order', () => {
      expect(
        describeTemplateTabs({
          tabs: [
            { title: 'Mesh', blocks: [] },
            { title: 'Rig', blocks: [] },
          ],
        }),
      ).toBe('Mesh, Rig');
    });

    it('THEN one with no tabs says so rather than saying nothing', () => {
      expect(describeTemplateTabs({ tabs: [] })).toBe('No tabs');
    });
  });
});
