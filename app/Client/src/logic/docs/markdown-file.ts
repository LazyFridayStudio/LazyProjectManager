/**
 * Hands the browser a file to save.
 *
 * A link that was never on the page, clicked once. It is the only way a page
 * can offer a file it made itself, and this one it did make: the document is
 * already in the browser, so asking the server to send back what is being read
 * on screen would be a round trip that could only return the same bytes.
 *
 * `text/markdown` rather than `text/plain` so the file arrives as what it is,
 * and `charset=utf-8` because a design document is full of em dashes and the
 * apostrophes a word processor put in.
 */
export function downloadMarkdown(fileName: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = window.document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();

  // Released on the next turn rather than this one. Revoking a URL the browser
  // has been handed but has not yet read produces a download of nothing, and
  // the failure is silent in every browser it happens in.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
