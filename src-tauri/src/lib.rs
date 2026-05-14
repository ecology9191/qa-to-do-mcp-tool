#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_shell_state,
            save_failure_evidence
        ])
        .run(tauri::generate_context!())
        .expect("error while running QA To Do");
}

use std::hash::{Hash, Hasher};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppShellState {
    sessions: Vec<QaSessionSummary>,
    config_health: Vec<ConfigHealthItem>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigHealthItem {
    id: &'static str,
    label: &'static str,
    state: &'static str,
    summary: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QaSessionSummary {
    id: String,
    title: String,
    repo_name: String,
    parent_issue_id: String,
    parent_issue_title: String,
    tracker: String,
    warnings: Vec<String>,
    item_count: usize,
    items: Vec<QaChecklistItem>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QaChecklistItem {
    id: String,
    title: String,
    original_title: String,
    steps: Vec<String>,
    original_steps: Vec<String>,
    expected_result: String,
    original_expected_result: String,
    source_issue_id: String,
    source_type: String,
    confidence: String,
    warnings: Vec<String>,
    source_evidence: Vec<SourceEvidence>,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    skip_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure_evidence: Option<FailureEvidence>,
    history: Vec<QaChecklistHistoryEvent>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FailureEvidence {
    actual_behavior: String,
    screenshots: Vec<FailureScreenshot>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FailureScreenshot {
    name: String,
    mime_type: String,
    size_bytes: usize,
    local_reference: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailureScreenshotInput {
    name: String,
    mime_type: String,
    size_bytes: usize,
    bytes: Vec<u8>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFailureEvidenceResult {
    screenshots: Vec<FailureScreenshot>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SourceEvidence {
    label: String,
    value: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct QaChecklistHistoryEvent {
    action: String,
    created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug)]
struct SessionRow {
    id: String,
    title: String,
    tracker: String,
    repo_name: String,
    parent_issue_id: String,
    parent_issue_title: String,
    warnings_json: String,
}

#[derive(Debug)]
struct ItemRow {
    id: String,
    title: String,
    original_title: String,
    steps_json: String,
    original_steps_json: String,
    expected_result: String,
    original_expected_result: String,
    source_issue_id: String,
    source_type: String,
    confidence: String,
    warnings_json: String,
    source_evidence_json: String,
    status: String,
    skip_reason: Option<String>,
    note: Option<String>,
}

#[derive(Debug)]
struct ScreenshotRow {
    original_name: String,
    mime_type: String,
    size_bytes: usize,
    local_reference: String,
}

#[tauri::command]
fn load_shell_state() -> Result<AppShellState, String> {
    let database_path = qa_to_do_database_path()?;
    if !database_path.exists() {
        return Ok(empty_shell_state());
    }

    let connection = rusqlite::Connection::open(&database_path)
        .map_err(|error| format!("Failed to open QA To Do database: {error}"))?;
    let session = most_recent_active_session(&connection)?;

    match session {
        Some(session) => Ok(shell_state_from_session(session, &connection)?),
        None => Ok(empty_shell_state()),
    }
}

#[tauri::command]
fn save_failure_evidence(
    session_id: String,
    item_id: String,
    actual_behavior: String,
    screenshots: Vec<FailureScreenshotInput>,
) -> Result<SaveFailureEvidenceResult, String> {
    let actual_behavior = actual_behavior.trim().to_string();
    if actual_behavior.is_empty() {
        return Err("Actual behavior is required before saving failure evidence.".to_string());
    }

    let database_path = qa_to_do_database_path()?;
    let connection = rusqlite::Connection::open(&database_path)
        .map_err(|error| format!("Failed to open QA To Do database: {error}"))?;
    ensure_item_exists(&connection, &session_id, &item_id)?;

    let now = current_timestamp();
    connection
        .execute(
            "UPDATE qa_items SET status = 'failed', skip_reason = NULL, note = ?1 WHERE session_id = ?2 AND id = ?3",
            (&actual_behavior, &session_id, &item_id),
        )
        .map_err(to_database_error)?;
    connection
        .execute(
            "INSERT INTO qa_item_history (item_id, session_id, action, detail, created_at) VALUES (?1, ?2, 'failed', ?3, ?4)",
            (&item_id, &session_id, &actual_behavior, &now),
        )
        .map_err(to_database_error)?;

    for screenshot in screenshots {
        save_screenshot(&connection, &session_id, &item_id, screenshot, &now)?;
    }

    Ok(SaveFailureEvidenceResult {
        screenshots: item_screenshots(&connection, &session_id, &item_id)?
            .into_iter()
            .map(to_failure_screenshot)
            .collect(),
    })
}

fn qa_to_do_database_path() -> Result<std::path::PathBuf, String> {
    Ok(qa_to_do_data_root()?.join("qa-to-do.sqlite"))
}

fn qa_to_do_storage_root() -> Result<std::path::PathBuf, String> {
    Ok(qa_to_do_data_root()?.join("evidence"))
}

fn qa_to_do_data_root() -> Result<std::path::PathBuf, String> {
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".local/share"))
        })
        .ok_or_else(|| "Neither XDG_DATA_HOME nor HOME is set.".to_string())?;

    Ok(data_home.join("qa-to-do"))
}

fn most_recent_active_session(
    connection: &rusqlite::Connection,
) -> Result<Option<SessionRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, tracker, repo_name, parent_issue_id, parent_issue_title, warnings_json \
             FROM qa_sessions \
             WHERE archived_at IS NULL AND deleted_at IS NULL \
             ORDER BY imported_at DESC, generated_at DESC LIMIT 1",
        )
        .map_err(|error| format!("Failed to read QA sessions: {error}"))?;

    let mut rows = statement
        .query([])
        .map_err(|error| format!("Failed to query QA sessions: {error}"))?;
    let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to query QA sessions: {error}"))?
    else {
        return Ok(None);
    };

    Ok(Some(SessionRow {
        id: row.get(0).map_err(to_database_error)?,
        title: row.get(1).map_err(to_database_error)?,
        tracker: row.get(2).map_err(to_database_error)?,
        repo_name: row.get(3).map_err(to_database_error)?,
        parent_issue_id: row.get(4).map_err(to_database_error)?,
        parent_issue_title: row.get(5).map_err(to_database_error)?,
        warnings_json: row.get(6).map_err(to_database_error)?,
    }))
}

fn shell_state_from_session(
    session: SessionRow,
    connection: &rusqlite::Connection,
) -> Result<AppShellState, String> {
    let items = active_session_items(connection, &session.id)?;
    Ok(AppShellState {
        sessions: vec![QaSessionSummary {
            id: session.id,
            title: session.title,
            repo_name: session.repo_name,
            parent_issue_id: session.parent_issue_id,
            parent_issue_title: session.parent_issue_title,
            tracker: session.tracker,
            warnings: parse_json(&session.warnings_json, "session warnings")?,
            item_count: items.len(),
            items,
        }],
        config_health: vec![
            ConfigHealthItem {
                id: "mcp",
                label: "MCP registration",
                state: "ready",
                summary: "A validated MCP inbox message has been received for this local app.".to_string(),
            },
            ConfigHealthItem {
                id: "inbox",
                label: "Inbox writability",
                state: "ready",
                summary: "The latest QA session was imported from the write-only MCP inbox.".to_string(),
            },
            ConfigHealthItem {
                id: "tracker",
                label: "Tracker readiness",
                state: "ready",
                summary: "This active session came from tracker child work under the selected parent issue.".to_string(),
            },
        ],
    })
}

fn active_session_items(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<QaChecklistItem>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, original_title, steps_json, original_steps_json, expected_result, \
             original_expected_result, source_issue_id, source_type, confidence, warnings_json, \
             source_evidence_json, status, skip_reason, note \
             FROM qa_items WHERE session_id = ?1 AND deleted_at IS NULL ORDER BY rowid ASC",
        )
        .map_err(|error| format!("Failed to read QA items: {error}"))?;

    let rows = statement
        .query_map([session_id], |row| {
            Ok(ItemRow {
                id: row.get(0)?,
                title: row.get(1)?,
                original_title: row.get(2)?,
                steps_json: row.get(3)?,
                original_steps_json: row.get(4)?,
                expected_result: row.get(5)?,
                original_expected_result: row.get(6)?,
                source_issue_id: row.get(7)?,
                source_type: row.get(8)?,
                confidence: row.get(9)?,
                warnings_json: row.get(10)?,
                source_evidence_json: row.get(11)?,
                status: row.get(12)?,
                skip_reason: row.get(13)?,
                note: row.get(14)?,
            })
        })
        .map_err(|error| format!("Failed to query QA items: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        let item = row.map_err(to_database_error)?;
        let history = item_history(connection, session_id, &item.id)?;
        let screenshots = item_screenshots(connection, session_id, &item.id)?;
        let status = normalize_status(&item.status).to_string();
        let failure_evidence = if status.starts_with("failed") {
            Some(FailureEvidence {
                actual_behavior: item.note.clone().unwrap_or_default(),
                screenshots: screenshots.into_iter().map(to_failure_screenshot).collect(),
            })
        } else {
            None
        };
        items.push(QaChecklistItem {
            id: item.id,
            title: item.title,
            original_title: item.original_title,
            steps: parse_json(&item.steps_json, "item steps")?,
            original_steps: parse_json(&item.original_steps_json, "original item steps")?,
            expected_result: item.expected_result,
            original_expected_result: item.original_expected_result,
            source_issue_id: item.source_issue_id,
            source_type: item.source_type,
            confidence: if item.confidence == "low" {
                "low"
            } else {
                "normal"
            }
            .to_string(),
            warnings: parse_json(&item.warnings_json, "item warnings")?,
            source_evidence: parse_json(&item.source_evidence_json, "item source evidence")?,
            status,
            skip_reason: item.skip_reason,
            note: item.note,
            failure_evidence,
            history,
        });
    }

    Ok(items)
}

fn item_screenshots(
    connection: &rusqlite::Connection,
    session_id: &str,
    item_id: &str,
) -> Result<Vec<ScreenshotRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT original_name, mime_type, size_bytes, local_reference FROM qa_item_screenshots \
             WHERE session_id = ?1 AND item_id = ?2 ORDER BY captured_at ASC",
        )
        .map_err(|error| format!("Failed to read QA item screenshots: {error}"))?;

    let rows = statement
        .query_map([session_id, item_id], |row| {
            Ok(ScreenshotRow {
                original_name: row.get(0)?,
                mime_type: row.get(1)?,
                size_bytes: row.get(2)?,
                local_reference: row.get(3)?,
            })
        })
        .map_err(|error| format!("Failed to query QA item screenshots: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(to_database_error)
}

fn save_screenshot(
    connection: &rusqlite::Connection,
    session_id: &str,
    item_id: &str,
    screenshot: FailureScreenshotInput,
    captured_at: &str,
) -> Result<(), String> {
    if !screenshot.mime_type.starts_with("image/") {
        return Err("Failure screenshots must be image files.".to_string());
    }
    if screenshot.size_bytes != screenshot.bytes.len() {
        return Err("Failure screenshot metadata did not match uploaded bytes.".to_string());
    }

    let original_name = normalized_screenshot_name(&screenshot.name);
    let screenshot_id = create_screenshot_id(
        session_id,
        item_id,
        captured_at,
        &original_name,
        &screenshot.bytes,
    );
    let relative_directory = std::path::PathBuf::from("screenshots")
        .join(sanitize_path_segment(session_id))
        .join(sanitize_path_segment(item_id));
    let storage_root = qa_to_do_storage_root()?;
    let target_directory = storage_root.join(&relative_directory);
    std::fs::create_dir_all(&target_directory)
        .map_err(|error| format!("Failed to create screenshot storage directory: {error}"))?;
    let file_name = format!(
        "{}-{}",
        screenshot_id,
        sanitize_path_segment(&original_name)
    );
    let local_path = target_directory.join(file_name);
    std::fs::write(&local_path, &screenshot.bytes)
        .map_err(|error| format!("Failed to copy failure screenshot into app storage: {error}"))?;
    let local_reference = relative_directory
        .join(local_path.file_name().unwrap_or_default())
        .to_string_lossy()
        .to_string();

    connection
        .execute(
            "INSERT INTO qa_item_screenshots (id, item_id, session_id, original_name, mime_type, size_bytes, local_path, local_reference, captured_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                screenshot_id,
                item_id,
                session_id,
                original_name,
                screenshot.mime_type,
                screenshot.size_bytes,
                local_path.to_string_lossy().to_string(),
                local_reference,
                captured_at,
            ),
        )
        .map_err(to_database_error)?;

    Ok(())
}

fn ensure_item_exists(
    connection: &rusqlite::Connection,
    session_id: &str,
    item_id: &str,
) -> Result<(), String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM qa_items WHERE session_id = ?1 AND id = ?2",
            [session_id, item_id],
            |row| row.get(0),
        )
        .map_err(to_database_error)?;
    if count == 0 {
        return Err(format!(
            "QA item {item_id} was not found in session {session_id}."
        ));
    }
    Ok(())
}

fn to_failure_screenshot(row: ScreenshotRow) -> FailureScreenshot {
    FailureScreenshot {
        name: row.original_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        local_reference: row.local_reference,
    }
}

fn normalized_screenshot_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "failure.png".to_string()
    } else {
        trimmed.to_string()
    }
}

fn create_screenshot_id(
    session_id: &str,
    item_id: &str,
    captured_at: &str,
    original_name: &str,
    bytes: &[u8],
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    item_id.hash(&mut hasher);
    captured_at.hash(&mut hasher);
    original_name.hash(&mut hasher);
    bytes.hash(&mut hasher);
    format!("screenshot-{:016x}", hasher.finish())
}

fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if sanitized.is_empty() {
        "item".to_string()
    } else {
        sanitized
    }
}

fn current_timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    seconds.to_string()
}

fn item_history(
    connection: &rusqlite::Connection,
    session_id: &str,
    item_id: &str,
) -> Result<Vec<QaChecklistHistoryEvent>, String> {
    let mut statement = connection
        .prepare(
            "SELECT action, detail, created_at FROM qa_item_history \
             WHERE session_id = ?1 AND item_id = ?2 ORDER BY id ASC",
        )
        .map_err(|error| format!("Failed to read QA item history: {error}"))?;

    let rows = statement
        .query_map([session_id, item_id], |row| {
            Ok(QaChecklistHistoryEvent {
                action: row.get(0)?,
                detail: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|error| format!("Failed to query QA item history: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(to_database_error)
}

fn empty_shell_state() -> AppShellState {
    AppShellState {
        sessions: Vec::new(),
        config_health: vec![
            ConfigHealthItem {
                id: "mcp",
                label: "MCP registration",
                state: "unknown",
                summary:
                    "No app-managed secrets. Provider MCP setup will be checked by the installer."
                        .to_string(),
            },
            ConfigHealthItem {
                id: "inbox",
                label: "Inbox writability",
                state: "unknown",
                summary:
                    "Validated MCP messages will land in the local inbox when setup is applied."
                        .to_string(),
            },
            ConfigHealthItem {
                id: "tracker",
                label: "Tracker readiness",
                state: "unknown",
                summary: "Beads or structured .scratch detection happens from the invoking repo."
                    .to_string(),
            },
        ],
    }
}

fn normalize_status(status: &str) -> &'static str {
    match status {
        "passed" => "passed",
        "failed" => "failed",
        "failed-filed" => "failed-filed",
        "skipped" => "skipped",
        _ => "pending",
    }
}

fn parse_json<T: serde::de::DeserializeOwned>(value: &str, label: &str) -> Result<T, String> {
    serde_json::from_str(value).map_err(|error| format!("Failed to parse {label}: {error}"))
}

fn to_database_error(error: rusqlite::Error) -> String {
    format!("Failed to read QA To Do database: {error}")
}
