# Cursorless Tree sitter wasms

Repository building wasms for use by Cursorless.

Instructions for adding new parser wasms (WIP):

1. Add the tree-sitter package for the specific language to `devDependencies` in `package.json` directly, or use `npm install --save-dev --ignore-scripts <package>`.

1. Bump minor version in `package.json`

1. Run `npm install --ignore-scripts` to update `package-lock.json`.

- If a build failure of some sort occurs, you will need to utilize the special build options in `build.ts`, specifically in the `processParser` function. If you can't figure it out, leave the PR as a draft and ask for help.
