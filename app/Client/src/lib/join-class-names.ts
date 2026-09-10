/**
 * Joins CSS Module class names, dropping anything absent.
 *
 * Composing class names with a template literal puts the string `undefined` into
 * the DOM whenever a conditional class is not applied, which is invisible until
 * someone tries to style it.
 */
export function joinClassNames(...classNames: readonly (string | false | undefined)[]): string {
  return classNames.filter((className): className is string => Boolean(className)).join(' ');
}
