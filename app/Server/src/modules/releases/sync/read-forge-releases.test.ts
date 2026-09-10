import { describe, expect, it } from 'vitest';

import { readForgeReleases } from './read-forge-releases.js';

/** One release as GitHub actually answers, trimmed to the fields read here. */
const RELEASE = {
  id: 218_884_321,
  tag_name: 'v0.9.4',
  name: 'Vertical slice — Drowned Reach',
  body: '## Added\n- Tier-3 weapon set',
  published_at: '2026-08-14T09:12:44Z',
  created_at: '2026-08-13T22:00:00Z',
  target_commitish: '4f2ac91',
  prerelease: true,
  draft: false,
  html_url: 'https://github.com/northwind/drowned-reach/releases/tag/v0.9.4',
  author: { login: 'build-bot' },
  assets: [
    {
      name: 'win64.zip',
      size: 4_509_715_661,
      download_count: 38,
      browser_download_url: 'https://github.com/northwind/drowned-reach/releases/win64.zip',
    },
    { name: 'ps5.pkg', size: 5_476_083_302, download_count: 12 },
  ],
};

describe('GIVEN what a forge answers when asked for its releases', () => {
  describe('WHEN a release is read', () => {
    it('THEN every field arrives in the shape this product stores', () => {
      const [release] = readForgeReleases([RELEASE]);

      expect(release).toMatchObject({
        externalId: '218884321',
        tag: 'v0.9.4',
        name: 'Vertical slice — Drowned Reach',
        author: 'build-bot',
        commitSha: '4f2ac91',
        isPrerelease: true,
        isDraft: false,
        notes: '## Added\n- Tier-3 weapon set',
      });
    });

    it('THEN the id is text, whatever the forge sent it as', () => {
      // GitHub sends a number and other forges send a string; the column is one
      // thing, and a number matched against a string finds nothing.
      expect(readForgeReleases([{ ...RELEASE, id: 'rel_881' }])[0]?.externalId).toBe('rel_881');
    });

    it('THEN it is dated by the day it was published, in UTC', () => {
      // The day it belongs to is the forge's, not the one it happens to be
      // wherever this runs.
      expect(readForgeReleases([RELEASE])[0]?.publishedOn).toBe('2026-08-14');
    });

    it('THEN one never published falls back to the day it was made', () => {
      const draft = { ...RELEASE, published_at: null, draft: true };

      expect(readForgeReleases([draft])[0]?.publishedOn).toBe('2026-08-13');
    });

    it('THEN one with no date at all is not quietly dated today', () => {
      // Today would put an old release at the top of the page and move it
      // again on every sync.
      const undated = { ...RELEASE, published_at: null, created_at: null };

      expect(readForgeReleases([undated])[0]?.publishedOn).toBe('1970-01-01');
    });

    it('THEN a release with no name of its own is called by its tag', () => {
      expect(readForgeReleases([{ ...RELEASE, name: '' }])[0]?.name).toBe('v0.9.4');
    });

    it('THEN a release nobody is named against still reads', () => {
      expect(readForgeReleases([{ ...RELEASE, author: null }])[0]?.author).toBe('unknown');
    });
  });

  describe('WHEN the downloads are read', () => {
    it('THEN each keeps its size, its count and where it is', () => {
      const assets = readForgeReleases([RELEASE])[0]?.assets ?? [];

      expect(assets).toEqual([
        {
          name: 'win64.zip',
          sizeBytes: 4_509_715_661,
          downloadCount: 38,
          downloadUrl: 'https://github.com/northwind/drowned-reach/releases/win64.zip',
        },
        // The forge did not say where this one is, which is null rather than a
        // guess — the row then offers nothing to press.
        { name: 'ps5.pkg', sizeBytes: 5_476_083_302, downloadCount: 12, downloadUrl: null },
      ]);
    });

    it('THEN a release with none has an empty list rather than a missing one', () => {
      expect(readForgeReleases([{ ...RELEASE, assets: null }])[0]?.assets).toEqual([]);
    });

    it('THEN a file with no name is dropped and the rest survive', () => {
      const odd = { ...RELEASE, assets: [{ size: 12 }, { name: 'good.zip', size: 12 }] };

      expect(readForgeReleases([odd])[0]?.assets).toHaveLength(1);
    });
  });

  describe('WHEN something in the answer cannot be read', () => {
    it('THEN that release is skipped and the others still arrive', () => {
      // A forge that changes a field, or one release in fifty with something
      // odd in it, must not stop the other forty-nine arriving.
      const mixed = [RELEASE, { id: 5 }, null, 'nonsense', { ...RELEASE, id: 9, tag_name: 'v1' }];

      expect(readForgeReleases(mixed).map((release) => release.tag)).toEqual(['v0.9.4', 'v1']);
    });

    it('THEN an answer that is not a list at all is nothing rather than a throw', () => {
      expect(readForgeReleases({ message: 'Not Found' })).toEqual([]);
      expect(readForgeReleases(null)).toEqual([]);
    });
  });
});
