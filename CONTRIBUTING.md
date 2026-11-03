# Contributing to Zola Cleaner

Thanks for helping. Bug reports, Zalo layouts the app doesn't support yet, and pull requests are all welcome.

- **Bugs, unsupported Zalo, feature ideas**: pick a form on the [new issue](https://github.com/holedev/zola-cleaner/issues/new/choose) page. Issues can be written in Vietnamese or English.
- **Security problems**: don't open an issue. See [SECURITY.md](SECURITY.md).

## Read first

- [`CONTEXT.md`](CONTEXT.md): the glossary used in code and UI (Media Store, Media Item, Link, Quarantine Job, Purge…). Use these words in code, commits and PRs.
- [`docs/zalo-layout.md`](docs/zalo-layout.md): how Zalo PC stores files.
- [`docs/adr/`](docs/adr): major decisions and why they were made. For example, the app only works with the Media Store and never reads Zalo's database or controls Zalo ([ADR 0003](docs/adr/0003-khong-dieu-khien-zalo.md)).

## Setup

Requirements: Windows, [Rust](https://rustup.rs) ≥ 1.95 (MSVC, with Visual Studio Build Tools), Node.js ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev                     # run the app in dev mode (Tauri + Vite)
cargo test --workspace       # core tests on a fake Media Store with real hardlinks
cargo clippy --workspace --all-targets
pnpm typecheck
pnpm build                   # NSIS installer in target/release/bundle/nsis
pnpm --filter @zola-cleaner/desktop screenshots   # retake docs/screenshots with demo data (needs Chrome or Edge)
```

```
crates/core      Rust core: Zalo layout detection, scanning, classification, stats, trash, ZIP, document names
apps/desktop     Tauri v2 app: src-tauri (IPC commands) + src (React, Tailwind, shadcn/ui)
apps/site        Landing page (Astro + Tailwind), deployed to GitHub Pages (pnpm --filter @zola-cleaner/site dev)
docs/            Plan, Zalo data layout, ADRs (in Vietnamese)
CONTEXT.md       Glossary used in code and UI (in Vietnamese)
```

Agent skills live in `.agents/skills` (pinned in `skills-lock.json`). `.claude/skills` holds relative symlinks to them so Claude Code loads them. On Windows, enable Developer Mode and run `git config --global core.symlinks true` before cloning. Otherwise Git checks the links out as plain text files.

## Rules

- **Never use real Zalo uids or conversation IDs** in tests, fixtures, docs, screenshots or logs. Use fake numbers.
- **Cleaning must stay safe.** One Media Item can have several Links across conversations. A change to how Media Items are selected, moved to the trash, restored or purged needs tests for Shared Media Items and for every Link.
- **New domain term?** Add it to `CONTEXT.md` in the same PR.
- **Hard-to-reverse decision with real trade-offs?** Add an ADR in `docs/adr/`.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org). A husky `commit-msg` hook checks them locally and commitlint checks them again in CI. Use a scope when it helps, like `fix(scan): …` or `feat(site): …`.

Pull requests are merged with **rebase merge**, so every commit lands on `main` as you wrote it. Keep each commit focused, with a message that stands on its own. Squash fixups into the commit they fix before asking for review.

The PR template has a short checklist of things CI can't check. Please fill it in.

## Releases

Releasing is automatic. After CI passes on `main`, [semantic-release](https://semantic-release.gitbook.io) picks the next version from the commits since the last tag: `feat` bumps the minor version, `fix`/`perf` bump the patch version, and `BREAKING CHANGE` bumps the major version. `docs`, `ci`, `chore` and `refactor` don't release anything, and neither do commits scoped to `site`. GitHub Actions then tags the commit, builds and signs the installer, and publishes the release with generated notes. The version comes from the git tag, so don't edit `version` in the config files by hand.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
