//! 插件 spec 兼容性只读检查：解析包名与声明的版本 → 读 npm registry 对应清单 →
//! 提取 `@deepseek-ai/dsh` 家族依赖 → 用 [`crate::service::plugin::compat`] 判定
//! 是否匹配运行时核心版本。全程不落盘、不起子进程，供插件市场在安装前提示。
//!
//! 本地目录 spec 走完全离线的另一条路：直接读目标目录的 `package.json`，联网
//! 检查对它既无意义（包不在 registry 上）也无从进行（没有可查询的包名）。

use std::path::Path;
use std::time::Duration;

use semver::Version;
use tauri::AppHandle;

use crate::service::plugin::compat::{self, PluginInspect};
use crate::service::plugin::update::encode_registry_name;

use super::spec;

/// registry 请求超时：与更新探测一致，只读检查不该拖住安装前交互。
const INSPECT_TIMEOUT: Duration = Duration::from_secs(10);

/// 逐条检查 spec；单条检查的任何异常都收敛为该条的 `problem`，不影响其余条目
/// （Fail-Open：判定失败不等于不兼容）。
pub async fn inspect_specs(
    app_handle: &AppHandle,
    specs: &[String],
    dsh: Option<String>,
) -> Result<Vec<PluginInspect>, String> {
    let runtime = dsh
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| crate::service::core::active_version(app_handle));
    let client = crate::config::proxy::http_client_builder(app_handle)?
        .timeout(INSPECT_TIMEOUT)
        .build()
        .map_err(|e| format!("INSPECT_CLIENT: {e}"))?;

    // 与安装同源：本地 spec 的相对路径按 `dsh plugin add` 子进程的 cwd 解析。
    let base = crate::config::get_dsh_install_path(app_handle);
    let mut results = Vec::with_capacity(specs.len());
    for raw in specs {
        results.push(inspect_one(&client, raw, &base, runtime.as_deref()).await);
    }
    Ok(results)
}

/// 拉取包的完整版本清单（缩写 packument：`versions` 映射里带每个版本的依赖声明）。
///
/// 与 [`inspect_one`] 读的单版本清单不同：判定「哪个历史版本与该核心兼容」必须
/// 遍历全部版本，只有不带版本号的 packument 才有。任何失败返回 `None`（Fail-Open）。
pub(crate) async fn packument(app_handle: &AppHandle, name: &str) -> Option<serde_json::Value> {
    let client = crate::config::proxy::http_client_builder(app_handle)
        .ok()?
        .timeout(INSPECT_TIMEOUT)
        .build()
        .ok()?;
    let url = format!("https://registry.npmjs.org/{}", encode_registry_name(name));
    let response = client
        .get(&url)
        .header("accept", "application/vnd.npm.install-v1+json")
        .header("user-agent", "deepseek-harness-desktop")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<serde_json::Value>().await.ok()
}

/// 单条 spec：本地目录离线读清单；静态解析不出 registry 包名的来源（`github:`
/// 简写、git / tarball URL）不做网络请求。
async fn inspect_one(
    client: &reqwest::Client,
    spec: &str,
    base: &Path,
    runtime: Option<&str>,
) -> PluginInspect {
    let raw = spec.trim();
    if spec::local_path_spec(raw).is_some() {
        return inspect_local(raw, base, runtime);
    }
    // 解析不出包名不等于 spec 写错了：`github:owner/repo` 与 git / tarball URL 都是
    // pnpm 与 dsh 接受的合法来源，只是只读检查无从查询其版本与依赖。留空交给安装
    // 链路自己解析（Fail-Open）——报 invalid-spec 会把合法来源说成写法错误。
    let Some(name) = spec::package_name_of_spec(raw, base) else {
        return uninspected(raw, None);
    };

    let requested = requested_version(raw, &name);
    let exact = requested
        .as_deref()
        .filter(|value| Version::parse(value).is_ok());
    let target = exact.unwrap_or("latest");
    let url = format!(
        "https://registry.npmjs.org/{}/{}",
        encode_registry_name(&name),
        target
    );
    let response = match client
        .get(&url)
        .header("accept", "application/json")
        .header("user-agent", "deepseek-harness-desktop")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return problem_result(raw, Some(name), "network"),
    };
    // 404 是确定性的「包不存在」，其余非 2xx 都按网络问题处理。
    if !response.status().is_success() {
        let problem = if response.status() == reqwest::StatusCode::NOT_FOUND {
            "not-found"
        } else {
            "network"
        };
        return problem_result(raw, Some(name), problem);
    }
    let Ok(manifest) = response.json::<serde_json::Value>().await else {
        return problem_result(raw, Some(name), "network");
    };

    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let peers = compat::peers_from_manifest(&manifest);
    // 区间（`^1.2.0` / `>=1 <2`）暂不做版本解析：此时读的是 latest 清单，
    // 拿它的依赖去判定会误伤「用旧版本规避新版不兼容」的标准做法，故放行。
    let compatible = if requested.is_some() && exact.is_none() {
        None
    } else {
        runtime.and_then(|runtime| compat::evaluate(&peers, runtime))
    };
    PluginInspect {
        spec: raw.to_string(),
        name: Some(name),
        version,
        compatible,
        peers: (!peers.is_empty()).then_some(peers),
        problem: None,
    }
}

/// 本地目录 spec 的离线检查：目录与 `package.json` 缺一都算 `local-missing`
/// （安装前就能报出确定的原因，而不是等 pnpm 装出一个没有清单的联接）。
///
/// 兼容性判定与 registry 路径同源：清单里的 DSH 家族依赖 × 运行时核心版本，
/// 本地源码没有「已发布版本」的概念，因此不做区间退回、直接判定。
fn inspect_local(raw: &str, base: &Path, runtime: Option<&str>) -> PluginInspect {
    let Some(dir) = spec::local_dir_of(raw, base) else {
        return problem_result(raw, None, "local-missing");
    };
    let Ok(content) = std::fs::read_to_string(dir.join("package.json")) else {
        return problem_result(raw, None, "local-missing");
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) else {
        return problem_result(raw, None, "local-missing");
    };
    let name = manifest
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .or_else(|| spec::local_package_name(&dir));
    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let peers = compat::peers_from_manifest(&manifest);
    let compatible = runtime.and_then(|runtime| compat::evaluate(&peers, runtime));
    PluginInspect {
        spec: raw.to_string(),
        name,
        version,
        compatible,
        peers: (!peers.is_empty()).then_some(peers),
        problem: None,
    }
}

/// spec 里在包名之后显式声明的版本片段（`aaa@1.0.0` / `@scope/aaa@^1.0.0`）。
fn requested_version(raw: &str, name: &str) -> Option<String> {
    raw.strip_prefix(name)
        .and_then(|rest| rest.strip_prefix('@'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

/// 出错条目：保留已解析到的包名便于前端展示，兼容性留空（Fail-Open）。
fn problem_result(spec: &str, name: Option<String>, problem: &str) -> PluginInspect {
    PluginInspect {
        problem: Some(problem.to_string()),
        ..uninspected(spec, name)
    }
}

/// 无从静态检查的条目：来源本身合法，但没有 registry 清单可读，因此既不给版本、
/// 也不给任何判定——安装链路会自己解析它。
fn uninspected(spec: &str, name: Option<String>) -> PluginInspect {
    PluginInspect {
        spec: spec.to_string(),
        name,
        version: None,
        compatible: None,
        peers: None,
        problem: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(tag: &str, manifest: Option<&str>) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("dsh-inspect-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir = base.join("plugin");
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(manifest) = manifest {
            std::fs::write(dir.join("package.json"), manifest).unwrap();
        }
        // `temp_dir()` 在 Windows 上是 8.3 短名（`IUUUUU~1`），本地 spec 解析按
        // 设计展开成真实长名——夹具必须站在同一口径上比较。
        let base = dunce::simplified(&std::fs::canonicalize(&base).unwrap()).to_path_buf();
        let dir = base.join("plugin");
        (base, dir)
    }

    #[test]
    fn local_spec_is_inspected_offline_from_its_manifest() {
        // 本地插件不在 registry 上：检查必须完全离线，并给出清单里声明的名字、
        // 版本与 DSH 家族依赖，供安装前的兼容性提示使用。
        let (base, dir) = fixture(
            "ok",
            Some(
                r#"{"name":"dsh-reverse-skill","version":"1.0.2","peerDependencies":{"@deepseek-ai/cordis":"^4.0.4"}}"#,
            ),
        );

        let result = inspect_local("./plugin", &base, Some("0.2.0-rc.2"));

        assert_eq!(result.spec, "./plugin");
        assert_eq!(result.name.as_deref(), Some("dsh-reverse-skill"));
        assert_eq!(result.version.as_deref(), Some("1.0.2"));
        assert_eq!(result.problem, None);
        assert_eq!(result.compatible, None, "非 DSH 家族 peer：无从判定");
        assert!(result.peers.is_none());
        assert_eq!(
            spec::local_dir_of("./plugin", &base).as_deref(),
            Some(dir.as_path())
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn local_spec_reports_dsh_peer_compatibility_without_network() {
        let (base, _) = fixture(
            "peer",
            Some(r#"{"name":"dsh-probe","peerDependencies":{"@deepseek-ai/dsh":"^0.2.0"}}"#),
        );

        let compatible = inspect_local("./plugin", &base, Some("0.2.1"));
        assert_eq!(compatible.compatible, Some(true));
        assert_eq!(
            compatible
                .peers
                .as_ref()
                .and_then(|p| p.get("@deepseek-ai/dsh"))
                .map(String::as_str),
            Some("^0.2.0")
        );

        let incompatible = inspect_local("./plugin", &base, Some("0.1.7"));
        assert_eq!(incompatible.compatible, Some(false));

        // 运行时版本未知（核心未装）：保留 peers 但不判定，前端按 Fail-Open 放行
        let unknown = inspect_local("./plugin", &base, None);
        assert_eq!(unknown.compatible, None);
        assert!(unknown.peers.is_some());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn local_spec_reports_local_missing_for_absent_dir_or_manifest() {
        // 三种「本地路径但拿不到清单」的形态都必须落到 local-missing，而不是
        // not-found / 干脆不判定 —— 前者会让用户以为要去 registry 找包。
        let (base, dir) = fixture("absent", None);

        let missing_dir = inspect_local("./never-existed", &base, Some("0.2.0"));
        assert_eq!(missing_dir.problem.as_deref(), Some("local-missing"));
        assert_eq!(missing_dir.name, None);
        assert_eq!(missing_dir.compatible, None);

        let missing_manifest = inspect_local("./plugin", &base, Some("0.2.0"));
        assert_eq!(missing_manifest.problem.as_deref(), Some("local-missing"));

        std::fs::write(dir.join("package.json"), "{ not json").unwrap();
        let broken = inspect_local("./plugin", &base, Some("0.2.0"));
        assert_eq!(broken.problem.as_deref(), Some("local-missing"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn local_spec_name_falls_back_to_the_directory_name() {
        // 清单没有 name：目录名是唯一可用标识（也是 pnpm 落盘 / 产物核验用的键）。
        let (base, _) = fixture("noname", Some(r#"{"version":"1.0.0"}"#));

        let result = inspect_local("./plugin", &base, Some("0.2.0"));

        assert_eq!(result.problem, None);
        assert_eq!(result.name.as_deref(), Some("plugin"));
        assert_eq!(result.version.as_deref(), Some("1.0.0"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn non_registry_specs_are_left_uninspected() {
        // 回归：`github:owner/repo` 与 git / tarball URL 是 pnpm 与 dsh 都接受的合法
        // 来源，只是查不到 registry 清单——报 invalid-spec 会让用户以为 spec 写错了。
        let client = reqwest::Client::new();
        let base = std::path::Path::new(".");
        for spec in [
            "github:MengYuil/dsh-ponytail",
            "https://github.com/MengYuil/dsh-ponytail",
            "git+https://github.com/MengYuil/dsh-ponytail.git#main",
            "https://example.com/plugin.tgz",
        ] {
            let result = inspect_one(&client, spec, base, Some("0.2.0")).await;
            assert_eq!(result.spec, spec);
            assert_eq!(result.problem, None, "{spec}");
            assert_eq!(result.compatible, None, "{spec}");
            assert_eq!(result.name, None, "{spec}");
        }
    }
}
