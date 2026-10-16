# Validation performed in the build workspace

- Project structure check: passed.
- TypeScript/TSX transpile syntax check: passed for all source files.
- `git diff --check`: passed.
- Dependency installation: not completed in the build workspace because DNS/network access to `registry.npmjs.org` is unavailable here. The repository therefore does not contain `node_modules` or a generated lockfile.

On a normal internet-connected VS Code machine, run `npm install`, then `npm run db:migrate`, `npm run db:seed`, `npm test`, `npm run typecheck`, and `npm run build` as documented in the README.
