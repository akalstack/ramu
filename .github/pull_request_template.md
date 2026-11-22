<!--
Thanks for helping. Fixes for bugs, crashes, slowness, tests, docs and translations get reviewed first.
Talk feature ideas through in Ideas before writing code: https://github.com/akalstack/ramu/discussions/categories/ideas
-->

## Change

What was wrong and what happens now. Link the issue if there is one.

## Checklist

- [ ] Tests added or updated for the behavior change
- [ ] Typecheck and tests pass for the packages I touched (`pnpm check` runs everything)
- [ ] Desktop-facing change: `pnpm build`, then `pnpm test:desktop-smoke`
- [ ] New visible strings go through `t()` with an Indonesian translation
- [ ] Docs describe the new behavior
- [ ] Screenshots attached for visible UI changes

## Validation

Checks run, and anything you could not check (a physical device, a paid account, a second host).
