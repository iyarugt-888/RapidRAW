use std::io::Cursor;
use std::path::Path;

use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GenericImageView, imageops};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;

use crate::app_settings::load_settings;
use crate::app_state::AppState;
use crate::file_management::read_file_mapped;

const MAX_DIMENSION: u32 = 1024;
const GEMINI_API_BASE: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const ANALYSIS_PROMPT: &str = concat!(
    "Rate this image on a scale of 0 to 10 for: Quality, Aesthetic Appeal, Subject Clarity, and Technical Sharpness. ",
    "Be critical but fair. Always suggest a better crop (or the most important centered region) using the cropSuggestion ",
    "object (values 0.0 to 1.0). Also return 1 to 5 visual focus points representing areas of the image (focus, exposure, subject). ",
    "For each point, provide a comment and type ('good', 'bad', or 'neutral')."
);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropSuggestion {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FocusPoint {
    pub x: f32,
    pub y: f32,
    pub intensity: f32,
    pub comment: String,
    #[serde(rename = "type")]
    pub point_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiAnalysisResult {
    pub quality: u8,
    pub aesthetic_appeal: u8,
    pub subject_clarity: u8,
    pub technical_sharpness: u8,
    pub album_name: String,
    pub summary: String,
    pub crop_suggestion: CropSuggestion,
    pub focus_points: Vec<FocusPoint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisItem {
    pub path: String,
    pub result: Option<GeminiAnalysisResult>,
    pub error: Option<String>,
}

fn load_image_for_analysis(path: &str, settings: &crate::app_settings::AppSettings) -> Result<DynamicImage, String> {
    // Try memory-mapped read first; fall back to a standard read when the file
    // is temporarily locked by another part of the pipeline (e.g. thumbnail
    // generation or concurrent image processing).
    let bytes: Vec<u8> = match read_file_mapped(Path::new(path)) {
        Ok(mapped) => mapped.to_vec(),
        Err(_) => std::fs::read(path).map_err(|e| e.to_string())?,
    };

    // Use the shared image-loading pipeline so that unsupported RAW formats
    // (e.g. CR3) automatically fall back to the embedded JPEG preview.
    crate::image_loader::load_base_image_from_bytes(&bytes, path, true, settings, None)
        .map_err(|e| e.to_string())
}

fn resize_image_for_api(img: &DynamicImage) -> DynamicImage {
    let (w, h) = img.dimensions();
    if w <= MAX_DIMENSION && h <= MAX_DIMENSION {
        return img.clone();
    }
    let scale = MAX_DIMENSION as f32 / w.max(h) as f32;
    let new_w = ((w as f32 * scale) as u32).max(1);
    let new_h = ((h as f32 * scale) as u32).max(1);
    img.resize(new_w, new_h, imageops::FilterType::Lanczos3)
}

fn image_to_jpeg_base64(img: &DynamicImage) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 85);
    encoder
        .encode_image(&img.to_rgb8())
        .map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(buf.get_ref()))
}

fn build_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "quality": { "type": "integer", "minimum": 0, "maximum": 10 },
            "aestheticAppeal": { "type": "integer", "minimum": 0, "maximum": 10 },
            "subjectClarity": { "type": "integer", "minimum": 0, "maximum": 10 },
            "technicalSharpness": { "type": "integer", "minimum": 0, "maximum": 10 },
            "albumName": { "type": "string" },
            "summary": { "type": "string" },
            "cropSuggestion": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "width": { "type": "number" },
                    "height": { "type": "number" }
                },
                "required": ["x", "y", "width", "height"]
            },
            "focusPoints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "number" },
                        "y": { "type": "number" },
                        "intensity": { "type": "number" },
                        "comment": { "type": "string" },
                        "type": { "type": "string", "enum": ["good", "bad", "neutral"] }
                    },
                    "required": ["x", "y", "intensity", "comment", "type"]
                },
                "minItems": 1,
                "maxItems": 5
            }
        },
        "required": [
            "quality", "aestheticAppeal", "subjectClarity", "technicalSharpness",
            "albumName", "summary", "cropSuggestion", "focusPoints"
        ]
    })
}

async fn call_gemini_api(
    api_key: &str,
    image_base64: &str,
) -> Result<GeminiAnalysisResult, String> {
    let client = Client::new();
    let url = format!("{}?key={}", GEMINI_API_BASE, api_key);

    let payload = json!({
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": image_base64
                    }
                },
                {
                    "text": ANALYSIS_PROMPT
                }
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": build_schema()
        }
    });

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(format!("Gemini API error {}: {}", status, body));
    }

    let response_json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let text = response_json
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Unexpected API response structure".to_string())?;

    serde_json::from_str::<GeminiAnalysisResult>(text)
        .map_err(|e| format!("Failed to parse analysis JSON: {}", e))
}

#[tauri::command]
pub async fn analyze_image_with_gemini(
    path: String,
    _state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<GeminiAnalysisResult, String> {
    let settings = load_settings(app_handle.clone())?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            "Gemini API key is not configured. Please add it in Settings > AI.".to_string()
        })?;

    let dynamic_image =
        tokio::task::spawn_blocking(move || load_image_for_analysis(&path, &settings))
            .await
            .map_err(|e| e.to_string())??;

    let resized = resize_image_for_api(&dynamic_image);
    let base64_data = image_to_jpeg_base64(&resized)?;

    call_gemini_api(&api_key, &base64_data).await
}

#[tauri::command]
pub async fn analyze_images_batch_with_gemini(
    paths: Vec<String>,
    _state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<Vec<BatchAnalysisItem>, String> {
    let settings = load_settings(app_handle.clone())?;
    let api_key = settings
        .gemini_api_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            "Gemini API key is not configured. Please add it in Settings > AI.".to_string()
        })?;

    let mut results = Vec::new();
    for path in &paths {
        let path_clone = path.clone();
        let settings_clone = settings.clone();
        let img_result =
            tokio::task::spawn_blocking(move || load_image_for_analysis(&path_clone, &settings_clone))
                .await
                .map_err(|e| e.to_string());

        let dynamic_image = match img_result {
            Ok(Ok(img)) => img,
            Ok(Err(e)) | Err(e) => {
                results.push(BatchAnalysisItem {
                    path: path.clone(),
                    result: None,
                    error: Some(format!("Failed to load: {}", e)),
                });
                continue;
            }
        };

        let resized = resize_image_for_api(&dynamic_image);
        let base64_data = match image_to_jpeg_base64(&resized) {
            Ok(data) => data,
            Err(e) => {
                results.push(BatchAnalysisItem {
                    path: path.clone(),
                    result: None,
                    error: Some(format!("Failed to encode: {}", e)),
                });
                continue;
            }
        };

        match call_gemini_api(&api_key, &base64_data).await {
            Ok(analysis) => {
                results.push(BatchAnalysisItem {
                    path: path.clone(),
                    result: Some(analysis),
                    error: None,
                });
            }
            Err(e) => {
                results.push(BatchAnalysisItem {
                    path: path.clone(),
                    result: None,
                    error: Some(e),
                });
            }
        }
    }

    Ok(results)
}
