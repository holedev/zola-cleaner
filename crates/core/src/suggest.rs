//! Suggestion: lựa chọn dọn soạn sẵn trên mọi Conversation, kèm số byte dọn được.

use serde::Serialize;

use crate::db::Db;
use crate::error::Result;
use crate::filter::CleanupFilter;
use crate::quarantine::preview_cleanup;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// Tài liệu có thể không tải lại được → giao diện cảnh báo rõ hơn.
    pub caution: bool,
    pub filter: CleanupFilter,
    pub count: i64,
    pub bytes: i64,
}

const MB: i64 = 1024 * 1024;

struct Def {
    id: &'static str,
    title: &'static str,
    description: &'static str,
    caution: bool,
    categories: &'static [&'static str],
    older_than_days: Option<i64>,
    min_size: Option<i64>,
}

const DEFS: [Def; 4] = [
    Def {
        id: "media-1y",
        title: "Ảnh & video cũ hơn 1 năm",
        description: "Tin nhắn từ hơn một năm trước, ở mọi hội thoại.",
        caution: false,
        categories: &["image", "video"],
        older_than_days: Some(365),
        min_size: None,
    },
    Def {
        id: "media-6m",
        title: "Ảnh & video cũ hơn 6 tháng",
        description: "Tin nhắn từ hơn sáu tháng trước, ở mọi hội thoại.",
        caution: false,
        categories: &["image", "video"],
        older_than_days: Some(180),
        min_size: None,
    },
    Def {
        id: "video-50mb",
        title: "Video lớn hơn 50 MB",
        description: "Mọi video nặng, không kể thời gian.",
        caution: false,
        categories: &["video"],
        older_than_days: None,
        min_size: Some(50 * MB),
    },
    Def {
        id: "docs-1y",
        title: "Tài liệu & file nén cũ hơn 1 năm",
        description: "PDF, Word, Excel, ZIP… nhận qua chat. Có thể không tải lại được từ Zalo — hãy xem kỹ trước.",
        caution: true,
        categories: &["document", "archive"],
        older_than_days: Some(365),
        min_size: None,
    },
];

/// Các Suggestion cho một Media Store, kèm số liệu hiện tại.
pub fn suggestions(db: &Db, root_id: i64) -> Result<Vec<Suggestion>> {
    DEFS.iter()
        .map(|d| {
            let filter = CleanupFilter {
                root_id,
                conv_ids: None,
                categories: Some(d.categories.iter().map(|c| (*c).to_owned()).collect()),
                older_than_days: d.older_than_days,
                min_size: d.min_size,
                before_ts: None,
                exclude_ids: None,
                doc_kinds: None,
            };
            let p = preview_cleanup(db, &filter, 0)?;
            Ok(Suggestion {
                id: d.id,
                title: d.title,
                description: d.description,
                caution: d.caution,
                filter,
                count: p.count,
                bytes: p.bytes,
            })
        })
        .collect()
}
