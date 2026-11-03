<p align="center">
  <img src="apps/desktop/app-icon.png" width="96" alt="" />
</p>

<h1 align="center">Zola Cleaner</h1>

<p align="center">
  Clean up the photos, videos and documents that <b>Zalo PC</b> downloads to your computer: pick by conversation and age, preview every file, restore anytime.
  <br />
  <a href="https://holedev.github.io/zola-cleaner/en/"><b>Website</b></a> · <a href="../../releases/latest"><b>Download</b></a>
  <br />
  <b>English</b> · <a href="README.vi.md">Tiếng Việt</a>
</p>

---

Zalo PC saves every photo, video and document you receive in chats to drive C, often tens of gigabytes. Zalo has no way to clean up by conversation or by age, so the drive keeps filling up.

Zola Cleaner shows how much space Zalo is using and which conversations use it. Then it cleans only the part you choose.

Curious where Zalo keeps your files and why they take so much space? See [**Where does Zalo PC keep your files?**](ZALO-STORAGE.md)

> The app's interface is in Vietnamese, since Zalo is used mostly in Vietnam.

<p align="center">
  <img src="docs/screenshots/quick-clean.png" alt="Quick clean: how much Zalo takes on drive C and how much each suggestion reclaims" width="800" />
</p>

## Features

- **Quick clean**: one sentence tells you how much Zalo takes and how much you can get back, e.g. "Photos & videos older than 1 year → reclaim 4.4 GB".
- **By conversation**: pick individual chats or groups. Filter by kind (photos, videos, documents, archives…), age, size or file format (ZIP, RAR, PDF…), or use "this month and earlier".
- **Preview every file**: photos show as a grid and documents show their real names. Untick a file to keep it.
- **Its own trash**: cleaned files stay for 7 days and can be restored to their original places. You can also pack them into a ZIP for Drive or USB and import it back later.
- **Safe with how Zalo stores files**: one file can appear in several conversations as hardlinks. The app does not count it twice. It also does not remove a file that a conversation you didn't select still uses.
- Detects Zalo data moved to another drive, and supports several Zalo accounts on the same computer.

## Screenshots

The screenshots use made-up demo data: no real accounts, conversations or photos.

| By conversation | Trash |
|---|---|
| ![Conversations with photo thumbnails, documents and cleanable size per chat](docs/screenshots/conversations.png) | ![The app's trash, with restore, ZIP backup and permanent delete](docs/screenshots/trash.png) |
| **Overview** | |
| ![Drive type and health, and Zalo data by kind, age and folder](docs/screenshots/overview.png) | |

## Install

1. Download `Zola.Cleaner_x.y.z_x64-setup.exe` from the [**Releases**](../../releases/latest) page.
2. Run the installer. It installs for the current user and doesn't need admin rights.
3. The app is **not code-signed yet**, so Windows may show "Windows protected your PC". Click **More info → Run anyway**.

The app tells you when a new version is out. Click **Cập nhật** (Update) to download and install it.

> Requirements: Windows 10/11 64-bit and Zalo PC 26 (data storage format 5.x) that has moved media to its new storage layout.
> If the Zalo folder layout on your computer differs from the one the app has verified, the app only lets you **view**, not clean.

## Using it safely

- **Quit Zalo completely before cleaning**: right-click the Zalo icon in the system tray → Quit (Thoát). The app reminds you if Zalo is still running.
- Cleaned photos and videos: Zalo can usually download them again when you open the chat, as long as the file is still on Zalo's servers.
- **Documents are never pre-selected.** Without zCloud, files stay on Zalo's servers for only a limited number of days. A cleaned document may be impossible to download again.
- Not using zCloud? In Zalo PC, turn on **Settings → Messages → Other settings → Auto-download photos/files/videos/voice messages under 30MB** so files reach your computer before they expire.
- Disk space is only actually freed when you **empty the trash** (Dọn sạch thùng rác), or after 7 days.

## Privacy

- The app only reads Zalo's media folder (`ZaloDownloads`). It **does not read your messages** or Zalo's database, and it does not control Zalo.
- No telemetry. The only network connection is asking GitHub whether a new version exists.
- Logs and structure reports are saved only to a file you choose, with account and conversation IDs removed.

## Development

Built with Rust (core) and Tauri v2 + React (app). Setup, commands, project layout, commit rules and how releases work are in [**CONTRIBUTING.md**](CONTRIBUTING.md).

## Contact

- Bugs, unsupported Zalo versions and feature ideas: pick a form on the [new issue](../../issues/new/choose) page. If the app says your Zalo isn't supported, the form asks for the structure report the app exports. The report doesn't contain file names or IDs.
- Security problems: report them privately, see [SECURITY.md](SECURITY.md).
- Author: [@holedev](https://github.com/holedev)

## License

[MIT](LICENSE).
