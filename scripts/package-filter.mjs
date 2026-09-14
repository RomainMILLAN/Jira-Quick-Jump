/**
 * WHAT MAY LEAVE src/ FOR A PUBLISHED PACKAGE.
 *
 * Both builds used to run `cpSync(SRC, OUT, { recursive: true })` -- a whole-tree
 * copy with no list. Anything that ever landed in src/ shipped to both stores: an
 * editor's `.bak`, a `notes.md`, a `.env` dropped there for five minutes, a
 * screenshot with a real Jira host in it. Nothing had to go wrong for that to
 * happen; it only had to be forgotten.
 *
 * An ALLOW-LIST, never a deny-list: a deny-list is a guess about what people will
 * create next, and it is wrong the first time someone invents a new extension.
 * These six are what the extension actually consists of, and the copy REFUSES
 * anything else rather than skipping it quietly -- a file meant to ship that is
 * silently dropped is a broken package that builds green.
 */
export const SHIPPABLE = new Set([".js", ".json", ".html", ".css", ".png", ".woff2"]);

export const shippableFilter = (src) => {
  const name = src.split("/").pop();
  if (name.startsWith(".")) {
    throw new Error(`build refuses ${src}: dotfiles never ship, remove it from src/`);
  }
  // Directories carry no extension and are always traversed; the files inside
  // are each asked in turn.
  if (!name.includes(".")) return true;
  const ext = name.slice(name.lastIndexOf("."));
  if (!SHIPPABLE.has(ext)) {
    throw new Error(
      `build refuses ${src}: ${ext} is not a shippable type. ` +
      `Move it out of src/, or add the type to scripts/package-filter.mjs on purpose.`
    );
  }
  return true;
};
