//! 原生剪贴板读写（Linux/WebKitGTK 贴图回退 + Wayland 安全文本写入）。
//!
//! ## 读取（图片）
//! WebKitGTK 不通过 Web API（`ClipboardEvent.clipboardData.items/files`）暴露
//! `image/*` 剪贴板条目，导致桌面端内嵌的 dsh iframe 中输入框「贴图」无效
//! （浏览器里却正常）。本命令在 Rust 侧用 `arboard` 读取系统剪贴板图片、编码为
//! PNG data URL 返回；注入到 iframe 的桥脚本（`desktop::paste::PASTE_SHIM_JS`）
//! 拿到该 data URL 后重新派发 `paste` 事件，让 dsh 聊天框按正常贴图路径处理。
//!
//! ## 写入（文本）
//! 前端的「复制日志 / 复制服务地址」等操作统一走本模块的写入命令，而不是
//! `tauri-plugin-clipboard-manager`：后者在**应用启动时**就在主线程上创建并持有
//! 一个长生命周期 `arboard::Clipboard`（`init()` 内 `Clipboard::new()`），在
//! Linux Wayland 会话里一旦合成器不支持 `ext-data-control`/`wlr-data-control`
//! （`arboard` 只会打印「Falling back to the X11 clipboard protocol」警告并回退），
//! 该持有实例要么进入脆弱状态、要么在交互式 `set_text` 时阻塞/崩溃（用户反馈
//! 「复制运行日志软件崩溃」）。这里的实现改为**每次操作**在 `spawn_blocking`
//! 中**惰性新建**一个短期 `arboard::Clipboard`，用完即弃：
//! - 不阻塞异步运行时与 UI（Linux 上创建 / 写入需连显示服务器）；
//! - 不复用跨操作的长生命周期句柄，规避 Wayland 回退后的挂死 / 崩溃；
//! - Wayland 不支持时 `arboard` 自动回退 X11，仍是尽力而为，不抛出。

use base64::{engine::general_purpose::STANDARD, Engine};

/// 剪贴板图片读取结果：自包含的 PNG data URL（可直接作为 Blob/File 来源）。
#[derive(serde::Serialize)]
pub struct ClipboardImageResponse {
    /// 形如 `data:image/png;base64,...`
    pub data_url: String,
    pub mime: String,
    pub filename: String,
}

/// 从系统剪贴板读取图片并编码为 PNG data URL。
///
/// 剪贴板无图片时返回 `Ok(None)`；读取/编码失败返回 `Err`（前缀 `CLIPBOARD_IMAGE_`）。
#[tauri::command]
pub async fn read_clipboard_image(
    _app: tauri::AppHandle,
) -> Result<Option<ClipboardImageResponse>, String> {
    // arboard 的 Clipboard::new()/get_image() 是阻塞调用（Linux 上需连接显示服务器），
    // 放到 blocking 线程避免阻塞异步运行时与 UI。
    let result =
        tokio::task::spawn_blocking(move || -> Result<Option<ClipboardImageResponse>, String> {
            // 超过约 50MP 的剪贴板图片（≈200MB RGBA）直接拒绝，避免撑爆内存
            const MAX_PIXELS: u64 = 50_000_000;

            let mut clipboard =
                arboard::Clipboard::new().map_err(|e| format!("CLIPBOARD_IMAGE_ACCESS: {e}"))?;

            let image_data = match clipboard.get_image() {
                Ok(data) => data,
                // 剪贴板里没有图片（普通文本/文件等），不是错误
                Err(arboard::Error::ContentNotAvailable) => return Ok(None),
                Err(e) => return Err(format!("CLIPBOARD_IMAGE_READ: {e}")),
            };

            if image_data.width == 0 || image_data.height == 0 {
                return Ok(None);
            }
            let pixel_count = image_data.width as u64 * image_data.height as u64;
            if pixel_count > MAX_PIXELS {
                return Err(format!(
                    "CLIPBOARD_IMAGE_TOO_LARGE: {}x{} ({} px)",
                    image_data.width, image_data.height, pixel_count
                ));
            }

            // arboard 返回 RGBA8 像素，直接包装为 RgbaImage 后用 image 编码成 PNG
            let rgba = image::RgbaImage::from_raw(
                image_data.width as u32,
                image_data.height as u32,
                image_data.bytes.into_owned(),
            )
            .ok_or_else(|| "CLIPBOARD_IMAGE_DECODE: invalid rgba buffer".to_string())?;

            let mut cursor = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(rgba)
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| format!("CLIPBOARD_IMAGE_ENCODE: {e}"))?;

            let b64 = STANDARD.encode(cursor.into_inner());
            Ok(Some(ClipboardImageResponse {
                data_url: format!("data:image/png;base64,{b64}"),
                mime: "image/png".to_string(),
                filename: "clipboard-image.png".to_string(),
            }))
        })
        .await
        .map_err(|e| format!("CLIPBOARD_IMAGE_TASK: {e}"))??;

    Ok(result)
}

/// 从系统剪贴板读取纯文本。
///
/// WKWebView 里的 `navigator.clipboard.readText()` 拿不到授权（macOS 桌面端右键菜单
/// 「粘贴」因此失败），本命令给 iframe 侧一条原生读取路径：与写入一致，在
/// `spawn_blocking` 里惰性新建短期 `arboard::Clipboard` 读取，用完即弃。
/// 剪贴板无文本返回 `Ok(None)`；读取失败返回 `Err`（前缀 `CLIPBOARD_TEXT_`）。
#[tauri::command]
pub async fn read_clipboard_text() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("CLIPBOARD_TEXT_ACCESS: {e}"))?;
        match clipboard.get_text() {
            Ok(text) => Ok(Some(text)),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(format!("CLIPBOARD_TEXT_READ: {e}")),
        }
    })
    .await
    .map_err(|e| format!("CLIPBOARD_TEXT_TASK: {e}"))?
}

/// 把纯文本写入系统剪贴板。
///
/// 实现与 [`read_clipboard_image`] 一致：在 `spawn_blocking` 里**惰性新建**短期
/// `arboard::Clipboard` 完成 `set_text`，用完即弃。避免重复 `tauri-plugin-clipboard-manager`
/// 在启动时持有单例 `arboard::Clipboard` 所造成的 Linux Wayland 崩溃/挂死
/// （详见本模块头注释）。Wayland 合成器不支持 data-control 时 `arboard` 自行回退
/// X11；仅当两者都不可用才返回 `Err`（前缀 `CLIPBOARD_TEXT_`），由前端提示复制失败。
#[tauri::command]
pub async fn write_clipboard_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("CLIPBOARD_TEXT_ACCESS: {e}"))?;
        clipboard
            .set_text(text)
            .map_err(|e| format!("CLIPBOARD_TEXT_WRITE: {e}"))
    })
    .await
    .map_err(|e| format!("CLIPBOARD_TEXT_TASK: {e}"))?
}
