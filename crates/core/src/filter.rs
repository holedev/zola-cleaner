//! Bộ lọc dọn dẹp: chọn Media Item theo Conversation, Media Kind, Message Time, kích thước.

use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

use crate::db::now_ms;
use crate::detect::Category;
use crate::layout::CLEANABLE_AREAS;
use crate::safety::{DEFAULT_DELETABLE, PROTECTED};

pub const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupFilter {
    pub root_id: i64,
    /// Conversation được chọn. Rỗng / không có → không lọc theo hội thoại.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conv_ids: Option<Vec<String>>,
    /// Media Kind được chọn. Mặc định ảnh + video. Loại được bảo vệ (CSDL) luôn bị bỏ.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    /// Chỉ Media Item có Message Time cũ hơn N ngày.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub older_than_days: Option<i64>,
    /// Chỉ Media Item lớn hơn hoặc bằng N byte.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_size: Option<i64>,
    /// Chỉ Media Item có Message Time trước thời điểm này (epoch ms) — "từ mốc này trở về trước".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_ts: Option<i64>,
}

/// Tuổi của Media Item: Message Time nếu biết, nếu không thì mtime.
pub const ITEM_TS: &str = "COALESCE(i.msg_ts, i.mtime_ms)";

/// Một Link đại diện để hiển thị: ưu tiên Link kho (không nằm trong resource/).
pub const DISPLAY_PATH: &str = "(SELECT l.rel_path FROM links l WHERE l.item_id = i.id \
     ORDER BY l.rel_path LIKE 'resource/%', l.rel_path LIMIT 1)";

pub fn cleanable_areas_sql() -> String {
    CLEANABLE_AREAS
        .iter()
        .map(|a| format!("'{a}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Mệnh đề SQL kèm tham số.
pub struct Clause {
    pub sql: String,
    pub params: Vec<Value>,
}

impl CleanupFilter {
    /// Media Kind sẽ được chọn (đã bỏ loại được bảo vệ).
    pub fn effective_categories(&self) -> Vec<String> {
        let chosen: Vec<String> = match &self.categories {
            Some(c) => c.clone(),
            None => DEFAULT_DELETABLE
                .iter()
                .map(|c| c.as_str().to_owned())
                .collect(),
        };
        chosen
            .into_iter()
            .filter(|c| !Category::parse(c).is_some_and(|c| PROTECTED.contains(&c)))
            .collect()
    }

    fn conv_ids(&self) -> Option<&[String]> {
        self.conv_ids.as_deref().filter(|c| !c.is_empty())
    }

    /// WHERE chọn Media Item khớp bộ lọc (chưa loại Shared Media Item). Bảng `items` phải có bí danh `i`.
    pub fn candidate_where(&self) -> Clause {
        let mut parts = vec![
            "i.root_id = ?".to_owned(),
            "i.status = 'present'".to_owned(),
            format!("i.area IN ({})", cleanable_areas_sql()),
            "i.category IN (SELECT value FROM json_each(?))".to_owned(),
        ];
        let mut params = vec![
            Value::Integer(self.root_id),
            Value::Text(serde_json::to_string(&self.effective_categories()).unwrap_or_default()),
        ];
        if let Some(days) = self.older_than_days.filter(|d| *d > 0) {
            parts.push(format!("{ITEM_TS} < ?"));
            params.push(Value::Integer(now_ms() - days * DAY_MS));
        }
        if let Some(before) = self.before_ts {
            parts.push(format!("{ITEM_TS} < ?"));
            params.push(Value::Integer(before));
        }
        if let Some(min) = self.min_size.filter(|m| *m > 0) {
            parts.push("i.size >= ?".to_owned());
            params.push(Value::Integer(min));
        }
        if let Some(convs) = self.conv_ids() {
            // Đi từ index links(root_id, conv_id, item_id) thay vì kiểm tra từng Media Item
            parts.push(
                "i.id IN (SELECT l.item_id FROM links l WHERE l.root_id = ? AND l.conv_id IN (SELECT value FROM json_each(?)))"
                    .to_owned(),
            );
            params.push(Value::Integer(self.root_id));
            params.push(Value::Text(
                serde_json::to_string(convs).unwrap_or_default(),
            ));
        }
        Clause {
            sql: parts.join(" AND "),
            params,
        }
    }

    /// Điều kiện "còn thuộc hội thoại không được chọn" → Shared Media Item phải giữ lại.
    pub fn shared_cond(&self) -> Clause {
        match self.conv_ids() {
            None => Clause { sql: "0".into(), params: vec![] },
            Some(convs) => Clause {
                sql: "EXISTS (SELECT 1 FROM links l WHERE l.item_id = i.id AND l.conv_id IS NOT NULL \
                      AND l.conv_id NOT IN (SELECT value FROM json_each(?)))"
                    .into(),
                params: vec![Value::Text(serde_json::to_string(convs).unwrap_or_default())],
            },
        }
    }
}
