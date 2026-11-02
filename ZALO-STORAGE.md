# Where does Zalo PC keep your files?

**English** · [Tiếng Việt](ZALO-STORAGE.vi.md)

This page explains where Zalo PC saves the photos, videos and documents you receive in chats, why drive C keeps filling up, and which parts can be cleaned.

> Applies to **Zalo PC 26 (data storage format 5.x)** on Windows. Zalo's version info box shows it as "Phiên bản 26.x.x".

## Open Zalo's data folder

1. Press **Windows + R**.
2. Type `%APPDATA%\ZaloData` and press **Enter**.

This folder is usually `C:\Users\<your name>\AppData\Roaming\ZaloData`. On a computer that has used Zalo for a while, it can reach **tens of gigabytes**.

## What's inside

```
ZaloData
├─ media
│  └─ <account number>
│     ├─ ZaloDownloads     ← photos, videos, documents you received (the biggest part)
│     └─ sticker           ← stickers
├─ Database                ← your messages (encrypted)
└─ Cache, GPUCache …       ← Zalo's interface cache
```

- **`<account number>`**: each Zalo account signed in on the computer has its own folder, named with a number.
- **`ZaloDownloads`** is what grows the most, and it's **the only place Zola Cleaner cleans**.
- **`Database`** holds your messages. Never delete or edit it, or Zalo may lose your chat history.

## The `ZaloDownloads` folder

| Folder | What's in it | Cleanable? |
|---|---|---|
| `picture` | Photos, split into subfolders by conversation | ✅ |
| `video` | Videos | ✅ |
| `fileNoise` | Documents and files received in chats (PDF, Word, Excel, ZIP…) | ✅ (never pre-selected) |
| `file` | Received files | ✅ |
| `resource` | Shortcuts to the same files above, grouped by conversation | Cleaned together with the original |
| `Cache`, `richThumb`, `fileThumb` | Small previews so Zalo shows chats quickly | ❌ Kept |
| `voice` | Voice messages | ❌ Kept |
| `zinstant` | Zalo Instant content | ❌ Kept |

## Things that may surprise you

**File names are unreadable and often have no extension.** Zalo renames every file to a random-looking string, like `1730419200000_…_a3f9c1`. You can't tell what a photo or document is from its name. Documents in `fileNoise` are also lightly scrambled by Zalo, so opening them directly gives an error.

**One file can sit in several places but only use space once.** A photo appears in `picture` and in `resource\<conversation>`. If it was forwarded to another group, it appears there too. These are the **same** file on disk (Windows calls this a *hardlink*), not copies. This means:
- Deleting it by hand in one place **frees no space**, because the file is still in the other place.
- Windows Explorer may count it twice and show more space used than there really is.

**Deleting a conversation in Zalo doesn't delete its files.** Photos and videos from deleted chats stay in `ZaloDownloads`.

**Your data may be on another drive.** If you ever changed **Settings → Data management → Storage location**, media lives in `<drive>:\Zalo Data\media\<account number>\ZaloDownloads` (note the space in `Zalo Data`). Zola Cleaner finds it automatically.

## Can I get files back after cleaning?

- **Photos and videos**: when you open the chat again, Zalo usually downloads them again, as long as they're still on Zalo's servers.
- **Documents**: without zCloud, files only stay on Zalo's servers for **a limited number of days** after they're sent. Once cleaned, they **may not download again**. That's why Zola Cleaner never pre-selects documents.
- To get files onto your computer before they expire, turn on in Zalo PC: **Settings → Messages → Other settings → Auto-download photos/files/videos/voice messages under 30MB**. It only works while Zalo PC is open.

## Why clean with Zola Cleaner instead of deleting by hand

| Deleting in Explorer | Zola Cleaner |
|---|---|
| You can't tell which file belongs to which chat | Pick by conversation, by when it was sent, by kind |
| Deleting one copy frees no space | Removes the file from every place at once, sizes are counted correctly |
| Easy to delete previews or messages by mistake | Only touches photos, videos, documents and files |
| No way back | Keeps files in its trash for 7 days and restores them to their original places |
| A photo still used in another chat gets deleted too | Keeps photos still used in chats you didn't select |

Before cleaning, **quit Zalo completely**: right-click the Zalo icon in the system tray → **Quit** (Thoát).

---

Want the details? See the [technical notes](docs/zalo-layout.md). Does your computer look different from this page? Please open an [issue](https://github.com/holedev/zola-cleaner/issues).
