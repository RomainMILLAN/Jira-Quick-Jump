# Assets

Nothing in this directory is hand-made, and nothing here is shipped inside the
extension — `scripts/package-filter.mjs` only ever copies out of `src/`.

Every file is rendered from a source next to it, in [`../design/`](../design/),
so any of them can be rebuilt and compared rather than trusted:

| File | Rendered by | From |
|---|---|---|
| `banner-light.png`, `banner-dark.png` | `../design/render.sh` | `../design/banner-*.html` |
| `social-preview.png` | `../design/render.sh` | `../design/social-preview.html` |
| `logo-512.png` | `../design/render.sh` | `../design/logo.html` |
| `promo-440x280.png` | `../design/render.sh` | `../design/promo-tile.html` |
| `screenshot-options.png` | `node ../design/screenshot.mjs` | `src/options.html` itself |
| `badges/*.svg` | `node ../design/badges.mjs` | that script |
| `logo.svg` | written by hand | the 24-unit grid, see below |

`logo.svg` is the one reusable source for the mark. Its geometry is the same as
`CHEVRONS` in `scripts/make-icons.mjs`, which paints the toolbar icons, and as
the inline SVG in `src/options.html` and `src/popup.html`. `test/mark.test.js`
compares all four and fails if one of them moves; it also checks that the tile
colour here is still `--brand` in `src/ui/tokens.css`.

The screenshot is taken from the **shipped markup**: `screenshot.mjs` reads
`src/options.html`, poses a stand-in browser in front of `src/platform.js`, and
seeds it with a policy built by the real domain code
(`../design/state.mjs`). It never touches a profile, and the hosts in it are
example hosts — a screenshot with a real Jira host in it is one of the leaks
`scripts/package-filter.mjs` was written to prevent.

Rendering makes no network request: the only webfont is the JetBrains Mono the
extension already ships under `src/ui/fonts/`.
