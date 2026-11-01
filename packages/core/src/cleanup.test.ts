import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addRoot, type Db, openDb } from "./db.ts";
import { NOISE_KEY } from "./detect.ts";
import { previewCleanup, purgeExpired, purgeJob, quarantine, restoreJob } from "./quarantine.ts";
import { startScan } from "./scan.ts";
import { getStats, listConversations, setAlias } from "./stats.ts";
import { findThumbnail } from "./thumbs.ts";

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const MP4 = [0, 0, 0, 0x20, ..."ftypisom"].map((x) => (typeof x === "string" ? x.charCodeAt(0) : x));
const PDF_NOISE = [..."%PDF-1.7"].map((c) => c.charCodeAt(0) ^ NOISE_KEY);

/**
 * Media Store giả, theo đúng cấu trúc Zalo 5.x:
 *   a  — ảnh chỉ thuộc hội thoại 111                         (100 B)
 *   b  — ảnh thuộc 111 và nhóm g222 (Shared Media Item)      (200 B)
 *   g  — ảnh của nhóm, thư mục kho dùng dạng `222_group`     (50 B)
 *   v  — video chỉ thuộc nhóm g222                           (400 B)
 *   d  — tài liệu (fileNoise) thuộc 111                      (800 B)
 *   t  — Thumbnail của a trong Cache/                        (10 B)
 * Tên ảnh trong resource/ mang uid người gửi ("sender"), Thumbnail mang uid tài khoản ("me").
 */
function makeStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zc-test-"));
  const store = path.join(dir, "ZaloDownloads");
  const file = (rel: string, header: number[], size: number) => {
    const abs = path.join(store, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    const buf = Buffer.alloc(size);
    Buffer.from(header).copy(buf);
    writeFileSync(abs, buf);
    return abs;
  };
  const link = (target: string, rel: string) => {
    const abs = path.join(store, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    linkSync(target, abs);
    return abs;
  };
  const old = "16000000000"; // + 2 chữ số → Message Time khác nhau, khoảng 2020-09
  const a = file("picture/111/za_a.jpg", JPEG, 100);
  const aRes = link(a, `resource/111/picture/${old}01_sender_111_a.jpg`);
  const b = file("picture/111/zb_b.jpg", JPEG, 200);
  link(b, `resource/111/picture/${old}02_sender_111_b.jpg`);
  link(b, `resource/g222/picture/${old}02_sender_g222_b.jpg`);
  const g = file("picture/222_group/zg_g.jpg", JPEG, 50);
  link(g, `resource/g222/picture/${old}05_sender_g222_g.jpg`);
  const v = file("video/group/123", MP4, 400);
  link(v, `resource/g222/video/${old}03_sender_g222`);
  const d = file("fileNoise/abcdef", PDF_NOISE, 800);
  link(d, `resource/111/fileNoise/${old}04_sender_111`);
  const t = file(`Cache/${old}01_me_111_t`, JPEG, 10);
  link(t, `resource/111/Cache/${old}01_me_111_t`);
  writeFileSync(path.join(store, "picture", ".rescache"), '{"__version__":1}');
  return { dir, store, a, aRes, b, v, d, t, quarantineBase: path.join(dir, "quarantine") };
}

async function setup() {
  const s = makeStore();
  const db = openDb(path.join(s.dir, "test.db"));
  const root = addRoot(db, s.store);
  await startScan(db, root.id).done;
  return { ...s, db, rootId: root.id, cleanup: () => (db.close(), rmSync(s.dir, { recursive: true, force: true })) };
}

const itemIdOf = (db: Db, rel: string) =>
  (db.prepare("SELECT item_id FROM links WHERE rel_path = ?").get(rel) as { item_id: number }).item_id;

test("quét: hardlink không bị đếm trùng, gắn đúng hội thoại, giải XOR fileNoise", async () => {
  const s = await setup();
  try {
    const stats = getStats(s.db, { rootId: s.rootId });
    assert.equal(stats.total.count, 6);
    assert.equal(stats.total.bytes, 100 + 200 + 50 + 400 + 800 + 10);
    const doc = s.db.prepare("SELECT category, kind FROM items WHERE area = 'fileNoise'").get();
    assert.deepEqual({ ...doc }, { category: "document", kind: "pdf" });
    const msgTs = s.db.prepare("SELECT msg_ts FROM items WHERE area = 'video'").get() as { msg_ts: number };
    assert.equal(msgTs.msg_ts, 1600000000003);

    setAlias(s.db, s.rootId, "111", "  Gia đình ");
    const convs = listConversations(s.db, s.rootId);
    const c1 = convs.find((c) => c.convId === "111")!;
    const c2 = convs.find((c) => c.convId === "g222")!;
    assert.equal(c1.alias, "Gia đình");
    assert.equal(c1.bytes, 100 + 200 + 800); // Thumbnail trong Cache/ không tính
    assert.equal(c1.ownBytes, 100 + 800); // b dùng chung với g222
    assert.equal(c1.documentBytes, 800);
    assert.equal(c2.isGroup, true);
    assert.equal(c2.bytes, 200 + 50 + 400); // gộp picture/222_group và resource/g222
    assert.equal(c2.ownBytes, 50 + 400);
    assert.equal(convs.length, 2);
    assert.equal(c1.thumbIds.length, 2);

    // Quét lại: không đổi gì
    const again = await startScan(s.db, s.rootId).done;
    assert.equal(again.newFiles + again.changed, 0);
    assert.equal(again.bytes, 1560);
  } finally {
    s.cleanup();
  }
});

test("preview: bỏ qua Shared Media Item, không bao giờ chọn Thumbnail, tài liệu phải tự chọn", async () => {
  const s = await setup();
  try {
    const p1 = previewCleanup(s.db, { rootId: s.rootId, convIds: ["111"] });
    assert.equal(p1.count, 1); // chỉ a (b dùng chung, d là tài liệu)
    assert.equal(p1.bytes, 100);
    assert.deepEqual(p1.skippedShared, { count: 1, bytes: 200 });

    const p2 = previewCleanup(s.db, { rootId: s.rootId, convIds: ["111", "g222"] });
    assert.equal(p2.bytes, 100 + 200 + 50 + 400);
    assert.equal(p2.skippedShared.count, 0);

    const p3 = previewCleanup(s.db, { rootId: s.rootId, categories: ["image", "video", "document", "database"] });
    assert.equal(p3.bytes, 100 + 200 + 50 + 400 + 800); // Cache/ bị loại dù là ảnh

    const p4 = previewCleanup(s.db, { rootId: s.rootId, olderThanDays: 365 * 100 });
    assert.equal(p4.count, 0);
    const p5 = previewCleanup(s.db, { rootId: s.rootId, minSize: 300 });
    assert.equal(p5.bytes, 400);
  } finally {
    s.cleanup();
  }
});

test("cách ly gỡ mọi Link; khôi phục tạo lại hardlink; purge xoá hẳn", async () => {
  const s = await setup();
  try {
    const aId = itemIdOf(s.db, "picture/111/za_a.jpg");
    const ino = statSync(s.a).ino;

    const q = await quarantine(s.db, { rootId: s.rootId, convIds: ["111"] }, {
      quarantineBase: s.quarantineBase,
      checkZalo: false,
    });
    assert.deepEqual({ moved: q.moved, failed: q.failed, bytes: q.bytes }, { moved: 1, failed: 0, bytes: 100 });
    assert.equal(existsSync(s.a), false);
    assert.equal(existsSync(s.aRes), false);
    assert.equal(existsSync(s.b), true); // dùng chung → giữ
    assert.equal(existsSync(s.t), true); // Thumbnail → giữ
    assert.equal(getStats(s.db, { rootId: s.rootId }).total.bytes, 1560 - 100);

    // Quét trong lúc đang cách ly không làm hỏng trạng thái
    await startScan(s.db, s.rootId).done;
    const st = s.db.prepare("SELECT status FROM items WHERE id = ?").get(aId) as { status: string };
    assert.equal(st.status, "quarantined");

    const r = await restoreJob(s.db, q.jobId, { checkZalo: false });
    assert.equal(r.moved, 1);
    assert.equal(statSync(s.a).ino, ino);
    assert.equal(statSync(s.aRes).ino, ino);
    assert.equal(statSync(s.a).nlink, 2);
    assert.equal(listConversations(s.db, s.rootId).find((c) => c.convId === "111")!.ownBytes, 900);

    const q2 = await quarantine(s.db, { rootId: s.rootId, convIds: ["111"] }, {
      quarantineBase: s.quarantineBase,
      checkZalo: false,
    });
    assert.equal(purgeExpired(s.db, Date.now()).length, 0); // chưa hết Retention
    const p = purgeJob(s.db, q2.jobId);
    assert.equal(p.bytes, 100);
    assert.equal(existsSync(path.join(s.quarantineBase, String(q2.jobId))), false);
    const st2 = s.db.prepare("SELECT status FROM items WHERE id = ?").get(aId) as { status: string };
    assert.equal(st2.status, "deleted");
    await assert.rejects(restoreJob(s.db, q2.jobId, { checkZalo: false }));
  } finally {
    s.cleanup();
  }
});

test("hết Retention → tự purge", async () => {
  const s = await setup();
  try {
    const q = await quarantine(s.db, { rootId: s.rootId, convIds: ["g222"], categories: ["video"] }, {
      quarantineBase: s.quarantineBase,
      checkZalo: false,
      retentionDays: 7,
    });
    assert.equal(q.bytes, 400);
    const purged = purgeExpired(s.db, Date.now() + 8 * 86_400_000);
    assert.equal(purged.length, 1);
    assert.equal(existsSync(s.v), false);
  } finally {
    s.cleanup();
  }
});

test("thumbnail: ưu tiên ảnh trong Cache/ cùng Message Time", async () => {
  const s = await setup();
  try {
    const thumb = findThumbnail(s.db, itemIdOf(s.db, "picture/111/za_a.jpg"));
    assert.ok(thumb);
    assert.match(thumb.file.replaceAll("\\", "/"), /\/(resource\/111\/)?Cache\/1600000000001_me_111_t$/);
    assert.equal(thumb.contentType, "image/jpeg");
    assert.equal(findThumbnail(s.db, itemIdOf(s.db, "video/group/123")), null);
  } finally {
    s.cleanup();
  }
});
