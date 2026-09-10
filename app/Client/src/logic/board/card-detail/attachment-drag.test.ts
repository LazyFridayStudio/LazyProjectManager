import { describe, expect, it } from 'vitest';

import { readDraggedAttachment, writeDraggedAttachment } from './attachment-drag.js';

describe('GIVEN a file being dragged out of the Files list', () => {
  describe('WHEN it is dropped on a description', () => {
    it('THEN what was dragged is what arrives', () => {
      const attachment = { fileId: '018f0000-0000-7000-8000-0000000000f1', filename: 'crane.png' };

      expect(readDraggedAttachment(writeDraggedAttachment(attachment))).toEqual(attachment);
    });
  });

  describe('WHEN something else was dragged', () => {
    it('THEN it is not mistaken for one of ours', () => {
      // A link from another tab, a word of text, an empty payload. Each has to
      // fall through to the browser's own behaviour rather than half-parse.
      for (const payload of ['', 'https://example.test/image.png', 'null', '{}', '{"fileId":1}']) {
        expect(readDraggedAttachment(payload)).toBeNull();
      }
    });
  });
});
