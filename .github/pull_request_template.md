## What & why

<!-- What does this change, and why? Link the issue if there is one: "Closes #123". -->

## How I tested

<!-- Commands you ran, what you clicked through in `pnpm dev`, which Zalo layout you tried it on. -->

## Checklist

CI already runs commitlint, both builds, clippy and the tests. This list is what CI can't check.

- [ ] No real Zalo uids or conversation IDs anywhere: code, tests, fixtures, screenshots, logs. Use fake numbers.
- [ ] UI change: screenshots attached, taken with demo data. If the README screenshots are now out of date, I re-ran `pnpm --filter @zola-cleaner/desktop screenshots`.
- [ ] Touches how Media Items are selected, moved to the trash, restored or purged: tests cover Shared Media Items and every Link.
- [ ] New domain term: added to [`CONTEXT.md`](https://github.com/holedev/zola-cleaner/blob/main/CONTEXT.md). Hard-to-reverse decision: added an ADR in [`docs/adr/`](https://github.com/holedev/zola-cleaner/tree/main/docs/adr).
