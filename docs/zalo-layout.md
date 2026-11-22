# How Zalo PC stores data

**English** · [Tiếng Việt](zalo-layout.vi.md)

This is what Zola Cleaner relies on: where Zalo PC keeps the photos, videos and documents you receive, how it names them, and how it links each file to a conversation. Nothing here comes from Zalo's documentation. It was worked out by looking at the folders on disk and at the interface strings in Zalo PC's own app files, without changing them.

> Surveyed on 2026-11-01 with Zalo PC 26.10.20, after Zalo moved media to its new layout, on one Windows machine with one account.
> Checked again on 2026-11-22 with Zalo PC 26.11.12 (storage format 6) on the same machine. The folder layout hadn't changed, but this check found that new photos and videos have been stored differently since July 2026 (see [One file, many paths](#one-file-many-paths-hardlinks)).
> Other versions or machines may differ. That's why the app checks the layout before it cleans anything (see [What Zola Cleaner touches](#what-zola-cleaner-touches)).

All IDs below (`<uid>`, `1234567890`, `g9876543210`…) are placeholders.

## Where the data lives

```
%APPDATA%\ZaloData\                        C:\Users\<you>\AppData\Roaming\ZaloData, ~17 GB on the surveyed machine
├─ config.json                             Zalo version, migration state
├─ media\<uid>\
│  ├─ ZaloDownloads\                       ← downloaded media (~15 GB): the only place Zola Cleaner cleans
│  └─ sticker\                             stickers, not touched
├─ Database\_production\<uid>\             messages and metadata (SQLite, encrypted)
├─ ftsm_<uid>.db                           full-text search index
└─ Partitions\, Cache\, Code Cache\, GPUCache\ …   Electron / Chromium cache
```

- Version: **Zalo PC 26**. `config.json` records a storage format number as `major_version`: 5 on 26.10.20, then 6 from 26.11.x. Going from 5 to 6 didn't change anything in the media folder. In Zalo's app code the number sits next to `db_version`, so it most likely describes the data and database format, not the media layout. Zola Cleaner shows it and uses it only to decide whether to warn (see [What Zola Cleaner touches](#what-zola-cleaner-touches)).
- `<uid>` is the numeric ID of a Zalo account. Each account signed in on the machine has its own `media\<uid>\ZaloDownloads` folder.
- `AppData\Local\ZaloPC` didn't exist on the surveyed machine, and `Documents\Zalo Received Files` was empty.
- Files you save on purpose with "Save to computer" (for example into `D:\Zalo`) are your own copies, not Zalo's cache. Zola Cleaner never touches them.

| `ZaloData\` entry | Size | What it is |
|---|---|---|
| `media\` | ~15 GB | Downloaded media |
| `Database\_production\<uid>\` | ~690 MB | SQLite databases (Core, Media, MsgInfo, Res…), encrypted |
| `Partitions\`, `Cache\`, `Code Cache\`, `GPUCache\`… | ~1 GB | Electron / Chromium |
| `ftsm_<uid>.db` | ~55 MB | Full-text search |

### When the storage location is moved to another drive

Zalo PC lets you move its data under **Settings → Data management → Storage location → Change**. This section comes from reading Zalo PC's app code (`resources\app.asar`). A real move hasn't been tested yet.

- Zalo only allows a **different drive** from the default one. Media then goes to `<drive>:\Zalo Data\media\<uid>\ZaloDownloads` (note the space in `Zalo Data`). The message database can move along to `<drive>:\Zalo Data\message`.
- The chosen drive is kept in Zalo's settings (`resource.location.path` / `.label`) and in the registry under `HKCU\Software\vng.zalo.pc`.
- `config.json` stays in `%APPDATA%\ZaloData`.

Zola Cleaner looks in `%APPDATA%\ZaloData\media` and in `<every fixed or removable drive>\Zalo Data\media` each time it opens. If a folder it knew about is gone, it marks that account as no longer there.

## The media folder: `ZaloDownloads`

| Folder | Size | Files | Contents |
|---|---|---|---|
| `picture\<convId>\` | 3.7 GB | 18k | Photos, named like `z<msgId>_…_<hash>.jxl` or `.jpg`, already split by conversation. No new files since July 2026 |
| `fileNoise\` | 6.5 GB | 2.8k | Documents and other files received in chats, obfuscated (see [File formats](#file-formats)) |
| `video\` | 2.0 GB | 406 | Videos (MP4), numeric names, no extension. No new files since July 2026 |
| `file\` | 323 MB | 123 | Received files |
| `Cache\` | 663 MB | 5.8k | Thumbnails Zalo generates for photos |
| `richThumb\`, `fileThumb\` | small | | Link previews and document thumbnails |
| `voice\`, `zinstant\` | small | | Voice messages, Zalo Instant content |
| `resource\<convId>\{picture,video,fileNoise,file,Cache,richThumb,voice}\` | 2.1 GB of its own | 37k | Files grouped by conversation: **hardlinks** to files in the folders above, plus photos and videos that exist only here (since July 2026) |

In `video\`, `fileNoise\` and `file\`, files from group chats sit in a `group\` subfolder. Sizes and counts are from 2026-11-22.

## One file, many paths (hardlinks)

This is the key to cleaning by conversation without reading Zalo's database.

A file you receive is stored **once** on disk, but can appear under two or more paths. This is how photos were stored until July 2026:

```
ZaloDownloads\
├─ picture\9876543210_group\z<msgId>_…_<hash>.jxl                          "storage" path, by kind
└─ resource\g9876543210\picture\1730419200000_<senderUid>_g9876543210_….jxl  "conversation" path
```

Both paths are NTFS hardlinks to the same physical file. Deleting just one of them frees no space. In Zola Cleaner's terms ([CONTEXT.md](../CONTEXT.md)), the physical file is a **Media Item** and each path is a **Link**.

- Documents (`fileNoise\`, `file\`), and photos and videos downloaded before July 2026, have 2 Links: one storage path and one conversation path.
- **Since early July 2026, photos and videos only get a conversation path** (`resource\<convId>\picture\…` or `…\video\…`, 1 Link). Zalo no longer writes anything to `picture\` or `video\`. On the surveyed machine that's about 3,000 files, 1.5 GB, by 2026-11-22. This was already true at the 2026-11-01 survey but was missed then.
- A file forwarded to several chats has 3–5 Links, one per conversation. That's a **Shared Media Item**: the app only cleans it when every one of its conversations is selected. A photo or video forwarded since July 2026 is instead stored as a separate file in each conversation (same size, same hash in the name), so each copy is its own Media Item and is cleaned with its own conversation.
- A few older files have only 1 Link, either with no conversation or with only the `resource\` path (see [After cleaning](#what-zalo-does-after-cleaning)).
- Because the app counts physical files, not paths, sizes are never counted twice. Hardlinks in `resource\` add 0 bytes. The photos and videos that exist only in `resource\` do take space (2.1 GB on the surveyed machine).

### Names and conversation IDs

- A Link in `resource\` is named `<msgTs>_<senderUid>_<convId>_…`:
  - `msgTs` is the time the message was sent, as 13-digit epoch milliseconds. Zola Cleaner uses it as the file's **age**, not the file's modified date.
  - The second field is the **sender's** uid, not the account owner's.
- A one-to-one conversation is identified by a number (`1234567890`). A group is written two ways: `g<id>` in `resource\` and in file names, and `<id>_group` in `picture\`. The app treats both as `g<id>` so one group isn't split into two.
- Zalo never stores the conversation's real name on disk in a readable form. The app shows the ID and lets you set your own **Alias**.

## File formats

File names are hashes and often have **no extension**, so the app identifies each file from its first bytes ("magic bytes").

- **Photos**: about 65% are **JPEG XL** (`.jxl`), the rest JPEG or PNG. Browsers can't show JPEG XL yet, so the app decodes it to make thumbnails.
- **`fileNoise\`**: Zalo obfuscates received files here. The **first 100 bytes** are XOR-ed with `0x93`, the rest is unchanged, and Zalo appends a 6-byte trailer `\x07zAlO\x07` to the end. After undoing the XOR, these turn out to be not only documents (PDF, Word, Excel…) but also videos, MP3s and ZIP/RAR files sent as files.
- **Document names**: the original file name isn't kept on disk. Zola Cleaner recovers it by matching against copies you saved (Downloads, `Zalo Received Files`, `<drive>:\Zalo`), or by reading the title stored inside PDF and Office files.

## `.rescache`

Every folder has a `.rescache` file. It's Zalo's own bookkeeping for that cache:

```json
{"__version__":1,"totalSize":12345,"count":3,"data":{"<name>":[flag,size], …}}
```

Zalo rewrites it on its own when files go missing (see below). The app **never reads or edits `.rescache`**.

## What Zalo does after cleaning

Test from 2026-11-01: 10 JPEG XL photos (1.4 MB, not shared) from one group were moved out of the media folder, on an account **with Zalo Cloud**.

- **Zalo downloads the photos again when you open the chat.** They display normally with no error. About 1 minute after opening the group, 9 of 10 were back. The one not yet scrolled to wasn't. The re-downloaded files are **byte-for-byte identical** to the originals.
- The re-downloaded photo only gets a conversation path (`resource\<convId>\picture\…`, 1 Link). Zalo does **not** recreate the storage path in `picture\`.
- Thumbnails in `resource\<convId>\Cache\` aren't touched.
- On opening the chat, Zalo reset `.rescache` in the affected folders to empty, so the app doesn't need to fix it.

What this means:

- With Zalo Cloud, cleaning photos costs almost nothing. Only the photos you open again come back and take space.
- **Without Cloud**, older files may already have expired on Zalo's servers (see below) and can't come back. That's why the app keeps cleaned files in its trash for 7 days and never pre-selects documents.
- Restoring after Zalo has re-downloaded a file: if the file at the original path has the same content, the app replaces it with a Link to the restored copy. If the content differs, the app keeps Zalo's file.

Test repeated on 2026-11-22 with Zalo PC 26.11.12, same account: about 10 recent photos and 1 video from one conversation, all with only a `resource\` path, were cleaned with Zola Cleaner. When the chat was opened, Zalo downloaded them again and showed them normally. After restoring the job with Zalo closed, Zalo showed the chat normally.

## Auto-download and file expiry

From the interface strings in Zalo PC 26.10.20:

- Zalo PC has **Settings → Messages → Other settings → "Auto-download photos/files/videos/voice messages under 30MB"**. It only applies to files up to 30 MB, and only while Zalo PC is running.
- **Without zCloud**, files only stay on Zalo's servers for a limited number of days after they're sent ("Files are kept for at most N days from the time they are sent…"). A file not downloaded to the computer before then is gone for good ("File no longer exists").
- `config.json` doesn't contain the auto-download setting, so the app can't tell whether it's on. It can only show you how to turn it on.

## Databases

- Shared files in `Database\_production\` (`Qos.db`, `Storage.db`, `SecureLocalstorage.db`…) are plain SQLite.
- Per-account databases (`<uid>\Core\Message\*.db`, `Media.db`, `MsgInfo.db`, `Res.db`…) are **encrypted**.

Zola Cleaner doesn't read these databases and doesn't control Zalo's interface ([ADR 0003](adr/0003-khong-dieu-khien-zalo.md)). Everything it knows comes from the folder layout above.

## What Zola Cleaner touches

**Can be cleaned**: files in `picture\`, `video\`, `fileNoise\` or `file\`, whether through their storage path or through `resource\<convId>\{picture,video,fileNoise,file}\`, together with all their Links.

**Never touched**: `Cache\`, `richThumb\`, `fileThumb\` (thumbnails), `voice\`, `zinstant\`, `.rescache`, `sticker\`, the databases, the Chromium cache, and anything outside `ZaloDownloads`.

**Supported layout check**: before allowing any cleaning, the app checks that the media folder looks like the one surveyed here:

1. The path has the form `…\media\<uid>\ZaloDownloads`.
2. `config.json` can be read and has `migrate_full_done: true`, meaning Zalo finished moving media to the new layout.
3. `resource\` exists and, among up to 40 sample files in `resource\<convId>\{picture,video,fileNoise,file}\`, at least 90% are named `<msgTs>_<senderUid>_<convId>…`. That name is what gives each file its conversation and age.
4. If the storage folders (`picture\`, `video\`, `fileNoise\`, `file\`) hold any files, at least one of up to 40 samples has a hardlink (2 or more Links). A new install where these folders are still empty passes.

If any check fails, the folder can only be viewed. You can export a **structure report** (folder shape, file counts and sizes, with no file names, IDs or contents) and send it in an [issue](https://github.com/holedev/zola-cleaner/issues) so support can be added.

**Zalo version and storage format check**: the app also reads which Zalo PC version is installed, from the newest `Zalo-<version>` folder in `%LOCALAPPDATA%\Programs\Zalo` (Zalo keeps old version folders around, and the outer `Zalo.exe` is only a launcher), and the storage format (`major_version`) from `config.json`. Neither blocks cleaning on its own. They only decide whether to warn:

| Level | When | What the app does |
|---|---|---|
| Verified | Layout check passes, the storage format is one already surveyed (5 or 6), and Zalo is 26.x and not newer than the last surveyed version (26.11.12) | Cleans normally |
| Untested | Layout check passes, but the storage format is new or missing, or Zalo is newer than 26.11.12, has a different first number, or its version can't be read | Cleans, with a warning to clean a little first and check Zalo before emptying the trash |
| Unsupported | Layout check fails | View only. If Zalo is older, it suggests updating Zalo. If Zalo is newer, it suggests updating Zola Cleaner or sending a structure report |

The database versions in `config.json` (`db_version`) are shown in Settings and included in the structure report, but don't affect the level: Zola Cleaner never reads those databases.

## Survey numbers

From the 2026-11-01 survey:

- 63,175 Links → 34,625 Media Items, 13.4 GiB. The first scan takes about 3.5 seconds.
- 161 conversations with cleanable media, after merging the two group ID forms.
- By kind: photos 5.9 GB, documents 4.2 GB, videos 3.1 GB, archives 0.8 GB (decimal GB).
