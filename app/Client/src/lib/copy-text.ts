/**
 * Puts a value on the clipboard, from a page that may not be allowed the modern
 * way of doing it.
 *
 * `navigator.clipboard` is available only in a *secure context*. Localhost
 * counts as one; a plain-HTTP address on a studio's own network does not — so
 * on `http://192.168.1.10:24571` the whole object is `undefined` and pressing
 * Copy threw. That is the screen where a webhook secret is shown exactly once,
 * which is the worst possible place for a Copy button that does nothing.
 *
 * The fallback is the old way: a textarea nobody sees, selected, copied, and
 * taken away again. `document.execCommand` is deprecated and still the only
 * thing that works without HTTPS, which is the situation this is for.
 */
export async function copyText(value: string): Promise<boolean> {
  // Typed as always present, so it has to be asked about as an unknown: the
  // point is the browsers where the type is wrong.
  const clipboard: unknown = (navigator as { clipboard?: unknown }).clipboard;

  if (clipboard !== undefined && clipboard !== null) {
    try {
      await navigator.clipboard.writeText(value);

      return true;
    } catch {
      // Permission refused, or a browser that has the object and will not use
      // it. Either way there is still the old way to try.
    }
  }

  return copyTheOldWay(value);
}

function copyTheOldWay(value: string): boolean {
  const holder = document.createElement('textarea');

  holder.value = value;
  // Off-screen rather than hidden: a `display: none` textarea cannot be
  // selected, and an unselected one cannot be copied.
  holder.setAttribute('readonly', '');
  holder.style.position = 'fixed';
  holder.style.top = '-1000px';
  holder.style.opacity = '0';

  document.body.append(holder);

  try {
    holder.select();

    // Deprecated, and deliberate. It is the only clipboard write that works
    // without HTTPS, which is the entire situation this function exists for —
    // the modern one is not merely refused there, it is absent.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    holder.remove();
  }
}
