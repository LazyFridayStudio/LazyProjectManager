/**
 * CSS Modules produce a class-name map at build time. Typing the values as
 * `string` (rather than letting `noUncheckedIndexedAccess` widen them to
 * `string | undefined`) keeps component code free of null checks for class names
 * that Vite guarantees exist.
 */
declare module '*.module.css' {
  const classNames: Readonly<Record<string, string>>;
  export default classNames;
}

declare module '*.css';
