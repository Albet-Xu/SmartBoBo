//! Codex「思考即文字」补丁：把 `<thinking>` 围栏从正文改道到思考通道。
//!
//! Codex 系模型经 OpenAI 兼容端点返回时，思维链不以 `reasoning_content` 之类的
//! 结构化字段下发，而是直接写在 `choices[].delta.content` 文本里，用
//! `<thinking>…</thinking>` 围栏包住。pi-ai 的 `openai-completions` 适配器只认识
//! 结构化推理字段，因此这段文本按普通正文进入会话：用户看到满屏思考，harness 也
//! 拿不到 reasoning 内容（不参与思考渲染、折叠与统计）。
//!
//! 本补丁在流式正文累积处加一个极小的标签扫描器：**只在一条助手消息的最开头**
//! （允许前导空白）识别开启标签，命中后到闭合标签为止的文本走 `thinking_delta`，
//! 其后的文本恢复 `text_delta`。两端各自复用一个 content block，`finishBlock`
//! 与 `done` 事件里的 block 列表因此天然一致，harness 侧按 reasoning 块落库。
//!
//! 只在消息最开头识别开启标签是有意的收窄：正文里出现 `<thinking>` 字样（模型解释
//! 标签、引用代码、回答里贴 XML）时标签退化为普通文本，不会被吞掉；需要被改道的
//! 思考块本来就固定出现在回答之前。闭合标签允许跨 chunk（流式增量会把标签切开），
//! 因此扫描器保留最多 `</thinking>` 长度减一的尾缓冲，流结束时统一冲刷。
//!
//! 幂等与容错：目标已含补丁标记、或三处锚点任一缺失（上游改了实现）时
//! `patch_dsh` 安全跳过、不回写文件，不阻断启动。补丁只改写 pi-ai 的
//! `dist/api/openai-completions.js` 一个文件；内核升级重新解压后会在干净文件上重新
//! 应用。

use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

/// 补丁标记：写入注入内容首行的注释，用于幂等判定。
const PATCH_MARKER: &str = "dsh-tauri-desktop: Codex thinking-as-text";

/// 相对活动核心安装目录的 pi-ai OpenAI 兼容适配器包内路径。
const PI_AI_COMPLETIONS_JS: &str =
    "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";

/// 注入锚点：流式循环起始行（此前 content block 的辅助函数均已定义）。
const LOOP_ANCHOR: &str = "            for await (const chunk of openaiStream) {";
/// 注入内容：标签扫描器三个闭包 + 终止原锚点，挂在流式循环正前方。
const LOOP_PATCHED: &str = r#"            /* dsh-tauri-desktop: Codex thinking-as-text */
            const thinkingTagOpen = "<thinking>";
            const thinkingTagClose = "</thinking>";
            let thinkingTagBuffer = "";
            let thinkingTagInside = false;
            let thinkingTagHead = true;
            const emitThinkingAwareContent = (text, thinking) => {
                if (text.length === 0)
                    return;
                const block = thinking ? ensureThinkingBlock() : ensureTextBlock();
                if (thinking)
                    block.thinking += text;
                else
                    block.text += text;
                stream.push({
                    type: thinking ? "thinking_delta" : "text_delta",
                    contentIndex: getContentIndex(block),
                    delta: text,
                    partial: output,
                });
            };
            const flushThinkingAwareContent = () => {
                emitThinkingAwareContent(thinkingTagBuffer, thinkingTagInside);
                thinkingTagBuffer = "";
                thinkingTagHead = false;
            };
            const feedThinkingAwareContent = (chunk) => {
                thinkingTagBuffer += chunk;
                for (;;) {
                    if (thinkingTagInside) {
                        const closeAt = thinkingTagBuffer.indexOf(thinkingTagClose);
                        if (closeAt === -1) {
                            const hold = Math.min(thinkingTagBuffer.length, thinkingTagClose.length - 1);
                            emitThinkingAwareContent(thinkingTagBuffer.slice(0, thinkingTagBuffer.length - hold), true);
                            thinkingTagBuffer = thinkingTagBuffer.slice(thinkingTagBuffer.length - hold);
                            return;
                        }
                        emitThinkingAwareContent(thinkingTagBuffer.slice(0, closeAt), true);
                        thinkingTagBuffer = thinkingTagBuffer.slice(closeAt + thinkingTagClose.length);
                        thinkingTagInside = false;
                        continue;
                    }
                    if (!thinkingTagHead) {
                        emitThinkingAwareContent(thinkingTagBuffer, false);
                        thinkingTagBuffer = "";
                        return;
                    }
                    const head = thinkingTagBuffer.replace(/^\s+/, "");
                    if (head.startsWith(thinkingTagOpen)) {
                        thinkingTagBuffer = head.slice(thinkingTagOpen.length);
                        thinkingTagInside = true;
                        thinkingTagHead = false;
                        continue;
                    }
                    if (head.length < thinkingTagOpen.length && thinkingTagOpen.startsWith(head)) {
                        thinkingTagBuffer = head;
                        return;
                    }
                    thinkingTagHead = false;
                }
            };
            for await (const chunk of openaiStream) {"#;

/// 正文累积原语句：普通 `text_delta`。
const CONTENT_ANCHOR: &str = r#"                        const block = ensureTextBlock();
                        block.text += choice.delta.content;
                        stream.push({
                            type: "text_delta",
                            contentIndex: getContentIndex(block),
                            delta: choice.delta.content,
                            partial: output,
                        });"#;
/// 正文累积补丁后：交给标签扫描器决定进思考还是正文。
const CONTENT_PATCHED: &str =
    "                        feedThinkingAwareContent(choice.delta.content);";

/// 收尾锚点：循环后逐个 finalize content block 的循环头。
const FLUSH_ANCHOR: &str =
    "            for (const block of blocks) {\n                finishBlock(block);";
/// 收尾补丁后：先冲刷标签扫描器的尾缓冲，再 finalize。
const FLUSH_PATCHED: &str = "            flushThinkingAwareContent();\n            for (const block of blocks) {\n                finishBlock(block);";

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(PATCH_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(LOOP_ANCHOR)
        || !source.contains(CONTENT_ANCHOR)
        || !source.contains(FLUSH_ANCHOR)
    {
        return PatchOutcome::AnchorMissing;
    }
    let patched = source
        .replacen(LOOP_ANCHOR, LOOP_PATCHED, 1)
        .replacen(CONTENT_ANCHOR, CONTENT_PATCHED, 1)
        .replacen(FLUSH_ANCHOR, FLUSH_PATCHED, 1);
    PatchOutcome::Patched(patched)
}

/// 对活动核心的 pi-ai `openai-completions.js` 应用补丁（幂等）。
/// 返回 Err 表示读/写失败；文件缺失、已打过、锚点变更均静默跳过（Ok）。
/// 对显式给定的核心安装目录施加本补丁（E2E 编排复用，无需运行中的桌面端）。
pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, PI_AI_COMPLETIONS_JS, patch_source)
}
pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, PI_AI_COMPLETIONS_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 最小可打补丁样本：三处锚点按产物里的精确形式与缩进拼装。
    fn fixture() -> String {
        format!("{CONTENT_ANCHOR}\n{LOOP_ANCHOR}\n{FLUSH_ANCHOR}\n            }}\n")
    }

    #[test]
    fn patches_pristine_source_with_tag_scanner() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected patch")
        };
        assert!(patched.contains(PATCH_MARKER));
        assert!(patched.contains(r#"const thinkingTagClose = "</thinking>";"#));
        assert!(
            patched.contains("const block = thinking ? ensureThinkingBlock() : ensureTextBlock();")
        );
        assert!(patched.contains("feedThinkingAwareContent(choice.delta.content);"));
        assert!(patched.contains("            flushThinkingAwareContent();"));
        assert!(!patched.contains(CONTENT_ANCHOR));
        assert_eq!(patched.matches(LOOP_ANCHOR).count(), 1);
    }

    #[test]
    fn patch_is_idempotent() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected patch")
        };
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn missing_loop_anchor_is_skipped() {
        assert_eq!(
            patch_source(&format!("{CONTENT_ANCHOR}\n{FLUSH_ANCHOR}")),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn missing_content_anchor_is_skipped() {
        assert_eq!(
            patch_source(&format!("{LOOP_ANCHOR}\n{FLUSH_ANCHOR}")),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn missing_flush_anchor_is_skipped() {
        assert_eq!(
            patch_source(&format!("{LOOP_ANCHOR}\n{CONTENT_ANCHOR}")),
            PatchOutcome::AnchorMissing
        );
    }
}
