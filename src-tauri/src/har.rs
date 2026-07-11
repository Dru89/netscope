use std::path::Path;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HarFileData {
    pub file_path: String,
    pub content: String,
    pub file_name: String,
}

pub fn load_har_file(path: impl AsRef<Path>) -> Option<HarFileData> {
    let resolved = std::fs::canonicalize(path.as_ref()).ok()?;
    let content = std::fs::read_to_string(&resolved).ok()?;
    let file_name = resolved
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&resolved.to_string_lossy())
        .to_string();
    Some(HarFileData {
        file_path: resolved.to_string_lossy().to_string(),
        content,
        file_name,
    })
}
