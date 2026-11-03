# Security policy

> **Tiếng Việt:** Nếu bạn tìm thấy lỗ hổng bảo mật, đừng mở issue công khai. Hãy báo riêng tư qua [đây](https://github.com/holedev/zola-cleaner/security/advisories/new). Bạn có thể viết bằng tiếng Việt.

## Supported versions

Only the latest release gets security fixes. The app checks for updates on start, so please update before reporting.

## Reporting a vulnerability

Report it privately through [GitHub private vulnerability reporting](https://github.com/holedev/zola-cleaner/security/advisories/new). Don't open a public issue.

Please include:

- The Zola Cleaner version, and your Windows and Zalo PC versions.
- What an attacker can do, and the steps to reproduce it.
- A proof of concept if you have one. Use fake uids and conversation IDs, never real ones.

This is a one-person project, so responses are best effort and there is no guaranteed timeline. You'll get credit in the advisory unless you ask not to.

## What counts

Zola Cleaner moves and deletes files on the user's computer, so these are in scope:

- The app writes, moves or deletes anything **outside a Media Store** (`ZaloDownloads`) or the app's own trash.
- Importing a backup ZIP writes files outside the places listed in its manifest (path traversal, symlinks, and so on).
- A way to make the app install an update that isn't signed with the project's key.
- Logs or structure reports that leak uids, conversation IDs, file names or file contents.
- The app sending data anywhere other than the GitHub update check.

## What doesn't count

- Cleaning the wrong files **inside** a Media Store, for example a Shared Media Item that a conversation you didn't select still uses. That's a serious bug, but not a vulnerability: open a [bug report](https://github.com/holedev/zola-cleaner/issues/new/choose).
- Windows SmartScreen warnings. The installer isn't code-signed yet, as the README explains.
- Attacks that need an attacker who already has admin rights or full control of your user account.
