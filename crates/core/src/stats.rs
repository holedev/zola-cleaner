//! Thống kê, danh sách Conversation và Suggestion. Luôn đếm theo Media Item → hardlink không bị đếm trùng.

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::Value};
use serde::Serialize;

use crate::db::{Db, now_ms};
use crate::error::Result;
use crate::filter::{CleanupFilter, DAY_MS, DISPLAY_PATH, ITEM_TS, cleanable_areas_sql};
use crate::layout::is_group_conversation;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Bucket {
    pub key: String,
    pub count: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFile {
    pub id: i64,
    pub rel_path: Option<String>,
    pub size: i64,
    pub ts: i64,
    pub category: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: Bucket,
    pub by_category: Vec<Bucket>,
    pub by_area: Vec<Bucket>,
    pub by_month: Vec<Bucket>,
    pub by_age: Vec<Bucket>,
    pub largest: Vec<LargeFile>,
}

const AGE_BUCKETS: [(&str, i64); 5] = [
    ("< 30 ngày", 30),
    ("1–3 tháng", 90),
    ("3–6 tháng", 180),
    ("6–12 tháng", 365),
    ("1–2 năm", 730),
];
const AGE_OLDEST: &str = "> 2 năm";

fn bucket(r: &rusqlite::Row) -> rusqlite::Result<Bucket> {
    Ok(Bucket {
        key: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
        count: r.get(1)?,
        bytes: r.get(2)?,
    })
}

/// Thống kê các Media Item còn hiện diện của một Media Store.
pub fn get_stats(db: &Db, root_id: i64, largest_limit: i64) -> Result<Stats> {
    let where_ = "i.status = 'present' AND i.root_id = ?1";
    let total = db.query_row(
        &format!("SELECT 'total', COUNT(*), COALESCE(SUM(size), 0) FROM items i WHERE {where_}"),
        [root_id],
        bucket,
    )?;
    let group = |key_expr: &str, order: &str| -> Result<Vec<Bucket>> {
        let mut q = db.prepare(&format!(
            "SELECT {key_expr} AS key, COUNT(*), SUM(size) AS bytes FROM items i WHERE {where_} GROUP BY key {order}"
        ))?;
        Ok(q.query_map([root_id], bucket)?
            .collect::<rusqlite::Result<_>>()?)
    };

    let now = now_ms();
    let age_case = format!(
        "CASE {} ELSE '{AGE_OLDEST}' END",
        AGE_BUCKETS
            .iter()
            .map(|(label, days)| format!(
                "WHEN {ITEM_TS} >= {} THEN '{label}'",
                now - days * DAY_MS
            ))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mut by_age = group(&age_case, "")?;
    let order = |k: &str| {
        AGE_BUCKETS
            .iter()
            .position(|(l, _)| *l == k)
            .unwrap_or(AGE_BUCKETS.len())
    };
    by_age.sort_by_key(|b| order(&b.key));

    let mut q = db.prepare(&format!(
        "SELECT i.id, {DISPLAY_PATH}, i.size, {ITEM_TS}, i.category, i.kind
         FROM items i WHERE {where_} ORDER BY i.size DESC LIMIT ?2"
    ))?;
    let largest = q
        .query_map(params![root_id, largest_limit], |r| {
            Ok(LargeFile {
                id: r.get(0)?,
                rel_path: r.get(1)?,
                size: r.get(2)?,
                ts: r.get(3)?,
                category: r.get(4)?,
                kind: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(Stats {
        total,
        by_category: group("category", "ORDER BY bytes DESC")?,
        by_area: group("area", "ORDER BY bytes DESC")?,
        by_month: group(
            &format!("strftime('%Y-%m', {ITEM_TS} / 1000, 'unixepoch')"),
            "ORDER BY key",
        )?,
        by_age,
        largest,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub conv_id: String,
    pub is_group: bool,
    pub alias: Option<String>,
    pub items: i64,
    /// Tổng dung lượng media dọn được của hội thoại.
    pub bytes: i64,
    /// Phần chỉ thuộc riêng hội thoại này (không phải Shared Media Item).
    pub own_bytes: i64,
    pub image_bytes: i64,
    pub video_bytes: i64,
    pub document_bytes: i64,
    pub other_bytes: i64,
    /// Phần riêng khớp bộ lọc hiện tại (Media Kind, tuổi, kích thước) — đổi ngay khi người dùng đổi bộ lọc.
    pub cleanable_count: i64,
    pub cleanable_bytes: i64,
    pub last_ts: Option<i64>,
    /// Vài ảnh mới nhất trong số sẽ bị dọn theo bộ lọc (riêng của hội thoại, khớp bộ lọc).
    pub thumb_ids: Vec<i64>,
    /// Vài tài liệu / file nén mới nhất trong số sẽ bị dọn theo bộ lọc
    /// (Zalo không giữ tên gốc trên máy → chỉ có loại, dung lượng, thời điểm).
    pub recent_docs: Vec<DocRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocRef {
    pub id: i64,
    pub kind: String,
    pub size: i64,
    pub ts: i64,
    /// Tên tìm được (bản đã lưu về máy / tiêu đề trong file), xem docnames.rs.
    pub name: Option<String>,
}

/// item_id → tên tài liệu đã tìm được.
pub(crate) fn doc_names(db: &Db) -> Result<HashMap<i64, String>> {
    let mut q = db.prepare("SELECT item_id, name FROM doc_names WHERE name IS NOT NULL")?;
    Ok(q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Số tài liệu gần đây trả về cho mỗi Conversation.
const RECENT_DOCS: usize = 3;

/// Danh sách Conversation, xếp theo dung lượng media dọn được. `filter` (bỏ qua `conv_ids`) quyết định cột "Dọn được".
///
/// Lấy mọi cặp (Conversation, Media Item) bằng một truy vấn rồi cộng dồn trong Rust: phép join với bảng
/// "số Conversation của mỗi Media Item" (một CTE gộp nhóm) trong SQLite không có index và mất hàng chục giây.
pub fn list_conversations(
    db: &Db,
    filter: &CleanupFilter,
    thumbs: usize,
) -> Result<Vec<ConversationSummary>> {
    let root = filter.root_id;
    let w = CleanupFilter {
        conv_ids: None,
        ..filter.clone()
    }
    .candidate_where();
    let sql = format!(
        "SELECT DISTINCT l.conv_id, i.id, i.size, i.category, i.kind, i.area, {ITEM_TS}, ({}) AS matches
         FROM links l JOIN items i ON i.id = l.item_id
         WHERE l.root_id = ?1 AND l.conv_id IS NOT NULL AND i.status = 'present' AND i.area IN ({})",
        renumber(&w.sql, 2),
        cleanable_areas_sql()
    );
    let mut params: Vec<Value> = vec![Value::Integer(root)];
    params.extend(w.params);

    struct Pair {
        conv: String,
        item: i64,
        size: i64,
        category: String,
        kind: String,
        area: String,
        ts: i64,
        matches: bool,
    }
    let mut q = db.prepare(&sql)?;
    let pairs: Vec<Pair> = q
        .query_map(params_from_iter(params), |r| {
            Ok(Pair {
                conv: r.get(0)?,
                item: r.get(1)?,
                size: r.get(2)?,
                category: r.get(3)?,
                kind: r.get(4)?,
                area: r.get(5)?,
                ts: r.get(6)?,
                matches: r.get::<_, i64>(7)? != 0,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut convs_of_item: HashMap<i64, u32> = HashMap::new();
    for p in &pairs {
        *convs_of_item.entry(p.item).or_default() += 1;
    }

    let aliases: HashMap<String, String> = {
        let mut q = db.prepare(
            "SELECT conv_id, alias FROM conversations WHERE root_id = ? AND alias IS NOT NULL",
        )?;
        q.query_map([root], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };

    let mut by_conv: HashMap<&str, ConversationSummary> = HashMap::new();
    // Ảnh / tài liệu mẫu chỉ lấy từ chính những file sẽ bị dọn (riêng + khớp bộ lọc), để người dùng thấy đúng thứ sắp mất.
    // Ảnh: ưu tiên định dạng WebView hiển thị được (JPEG XL thì không), rồi mới nhất.
    let mut thumb_pool: HashMap<&str, Vec<(bool, i64, i64)>> = HashMap::new();
    let mut doc_pool: HashMap<&str, Vec<DocRef>> = HashMap::new();
    for p in &pairs {
        let c = by_conv
            .entry(&p.conv)
            .or_insert_with(|| ConversationSummary {
                conv_id: p.conv.clone(),
                is_group: is_group_conversation(&p.conv),
                alias: aliases.get(&p.conv).cloned(),
                items: 0,
                bytes: 0,
                own_bytes: 0,
                image_bytes: 0,
                video_bytes: 0,
                document_bytes: 0,
                other_bytes: 0,
                cleanable_count: 0,
                cleanable_bytes: 0,
                last_ts: None,
                thumb_ids: Vec::new(),
                recent_docs: Vec::new(),
            });
        let own = convs_of_item[&p.item] == 1;
        c.items += 1;
        c.bytes += p.size;
        match p.category.as_str() {
            "image" => c.image_bytes += p.size,
            "video" => c.video_bytes += p.size,
            "document" | "archive" => c.document_bytes += p.size,
            _ => c.other_bytes += p.size,
        }
        if own {
            c.own_bytes += p.size;
            if p.matches {
                c.cleanable_count += 1;
                c.cleanable_bytes += p.size;
            }
        }
        c.last_ts = Some(c.last_ts.map_or(p.ts, |t| t.max(p.ts)));
        let will_clean = own && p.matches;
        if will_clean && matches!(p.category.as_str(), "document" | "archive") {
            doc_pool.entry(&p.conv).or_default().push(DocRef {
                id: p.item,
                kind: p.kind.clone(),
                size: p.size,
                ts: p.ts,
                name: None,
            });
        }
        if will_clean && p.area == "picture" && p.category == "image" {
            let viewable = matches!(p.kind.as_str(), "jpg" | "png" | "gif" | "webp");
            thumb_pool
                .entry(&p.conv)
                .or_default()
                .push((viewable, p.ts, p.item));
        }
    }

    for (conv, mut pool) in thumb_pool {
        pool.sort_unstable_by(|a, b| b.cmp(a));
        if let Some(c) = by_conv.get_mut(conv) {
            c.thumb_ids = pool.into_iter().take(thumbs).map(|(_, _, id)| id).collect();
        }
    }

    let names = if doc_pool.is_empty() {
        HashMap::new()
    } else {
        doc_names(db)?
    };
    for (conv, mut docs) in doc_pool {
        for d in &mut docs {
            d.name = names.get(&d.id).cloned();
        }
        docs.sort_unstable_by_key(|d| std::cmp::Reverse(d.ts));
        docs.truncate(RECENT_DOCS);
        if let Some(c) = by_conv.get_mut(conv) {
            c.recent_docs = docs;
        }
    }

    let mut rows: Vec<ConversationSummary> = by_conv.into_values().collect();
    rows.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.conv_id.cmp(&b.conv_id))
    });
    Ok(rows)
}

/// Đổi các `?` vô danh thành `?N, ?N+1…` để ghép vào câu SQL đã dùng tham số đánh số.
pub(crate) fn renumber(sql: &str, start: usize) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let mut n = start;
    for ch in sql.chars() {
        if ch == '?' {
            out.push_str(&format!("?{n}"));
            n += 1;
        } else {
            out.push(ch);
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthBucket {
    /// "YYYY-MM" theo giờ máy.
    pub month: String,
    /// Đầu tháng (00:00 ngày 1, giờ máy), epoch ms — dùng làm `before_ts` khi dọn "tháng này trở về trước".
    pub start_ms: i64,
    pub count: i64,
    pub bytes: i64,
    pub thumb_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMonths {
    /// Mới nhất trước. Chỉ gồm Media Item dọn được (không tính Shared Media Item).
    pub months: Vec<MonthBucket>,
    /// Shared Media Item của hội thoại — luôn được giữ khi chỉ dọn hội thoại này.
    pub shared: Bucket,
}

/// Media Item dọn được của MỘT Conversation, theo tháng (Message Time). `filter.conv_ids` phải có đúng hội thoại đó;
/// `older_than_days` / `before_ts` bị bỏ qua — người dùng chọn mốc từ chính danh sách tháng.
pub fn conversation_months(
    db: &Db,
    filter: &CleanupFilter,
    thumbs: usize,
) -> Result<ConversationMonths> {
    let f = CleanupFilter {
        older_than_days: None,
        before_ts: None,
        ..filter.clone()
    };
    let w = f.candidate_where();
    let s = f.shared_cond();
    let sql = format!(
        "SELECT i.id, i.size, i.kind, i.category, {ITEM_TS} AS ts,
           strftime('%Y-%m', {ITEM_TS} / 1000, 'unixepoch', 'localtime'),
           CAST(strftime('%s', date({ITEM_TS} / 1000, 'unixepoch', 'localtime', 'start of month'), 'utc') AS INTEGER) * 1000,
           ({}) AS shared
         FROM items i WHERE {}",
        s.sql, w.sql
    );
    let params: Vec<Value> = s.params.into_iter().chain(w.params).collect();
    let mut q = db.prepare(&sql)?;
    let mut rows = q.query(params_from_iter(params))?;

    // tháng → (số liệu, ứng viên ảnh mẫu: (xem được, thời điểm, id))
    type ThumbPool = Vec<(bool, i64, i64)>;
    let mut months: std::collections::BTreeMap<String, (MonthBucket, ThumbPool)> =
        Default::default();
    let mut shared = Bucket {
        key: "shared".into(),
        count: 0,
        bytes: 0,
    };
    while let Some(r) = rows.next()? {
        let (id, size): (i64, i64) = (r.get(0)?, r.get(1)?);
        if r.get::<_, i64>(7)? != 0 {
            shared.count += 1;
            shared.bytes += size;
            continue;
        }
        let (kind, category, ts): (String, String, i64) = (r.get(2)?, r.get(3)?, r.get(4)?);
        let month: String = r.get(5)?;
        let start_ms: i64 = r.get(6)?;
        let (b, pool) = months.entry(month.clone()).or_insert_with(|| {
            (
                MonthBucket {
                    month,
                    start_ms,
                    count: 0,
                    bytes: 0,
                    thumb_ids: Vec::new(),
                },
                Vec::new(),
            )
        });
        b.count += 1;
        b.bytes += size;
        if category == "image" {
            pool.push((
                matches!(kind.as_str(), "jpg" | "png" | "gif" | "webp"),
                ts,
                id,
            ));
        }
    }

    let months = months
        .into_values()
        .rev()
        .map(|(mut b, mut pool)| {
            pool.sort_unstable_by(|a, b| b.cmp(a));
            b.thumb_ids = pool.into_iter().take(thumbs).map(|(_, _, id)| id).collect();
            b
        })
        .collect();
    Ok(ConversationMonths { months, shared })
}

/// Đặt (hoặc xoá, nếu rỗng) Alias của một Conversation.
pub fn set_alias(db: &Db, root_id: i64, conv_id: &str, alias: Option<&str>) -> Result<()> {
    let value = alias.map(str::trim).filter(|a| !a.is_empty());
    db.execute(
        "INSERT INTO conversations (root_id, conv_id, alias) VALUES (?, ?, ?)
         ON CONFLICT (root_id, conv_id) DO UPDATE SET alias = excluded.alias",
        params![root_id, conv_id, value],
    )?;
    Ok(())
}
