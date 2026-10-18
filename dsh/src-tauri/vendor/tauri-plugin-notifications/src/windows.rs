//! Windows implementation for notifications plugin using native Windows Toast API.

// The `windows_core::implement` macro (used for `ToastActivator` /
// `ToastActivatorFactory`) expands to `#[inline(always)]` accessors and
// `&T as *const T` casts, emitted as sibling items whose spans land in this
// file. There's no source-level expression to rewrite, and an `#[allow]` on the
// annotated struct doesn't reach the generated impls, so both lints are scoped
// out here. Neither is written by hand anywhere in this module.
#![allow(clippy::inline_always, clippy::ref_as_ptr)]

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Arc, Mutex, OnceLock, RwLock, Weak};
use std::time::{Duration, Instant};

use nt_time::FileTime;
use serde::de::DeserializeOwned;
use tauri::{
    AppHandle, Manager, Runtime,
    path::BaseDirectory,
    plugin::{PermissionState, PluginApi},
};
use windows::ApplicationModel::Package;
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::Collections::ValueSet;
use windows::Foundation::{DateTime, IStringable, TypedEventHandler};
#[cfg(feature = "push-notifications")]
use windows::Networking::PushNotifications::{
    PushNotificationChannel, PushNotificationChannelManager,
};
use windows::UI::Notifications::{
    NotificationSetting, ScheduledToastNotification, ToastActivatedEventArgs, ToastNotification,
    ToastNotificationManager, ToastNotifier,
};
use windows::Win32::Foundation::{
    CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, ERROR_NOT_FOUND, S_FALSE, S_OK,
};
use windows::Win32::System::Com::{
    CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, CoInitializeEx, CoRegisterClassObject,
    CoUninitialize, IClassFactory, IClassFactory_Impl, REGCLS_MULTIPLEUSE,
};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
    RegCreateKeyExW, RegSetValueExW,
};
use windows::Win32::UI::Notifications::{
    INotificationActivationCallback, INotificationActivationCallback_Impl,
    NOTIFICATION_USER_INPUT_DATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, MSG, TranslateMessage,
};
use windows::core::{BOOL, GUID, HSTRING, Interface, PCWSTR, Ref, implement};

use crate::WindowsConfig;
use crate::error::{ErrorResponse, PluginInvokeError};
use crate::models::{ActionType, ActiveNotification, PendingNotification, Schedule, ScheduleEvery};

/// True when the current process has MSIX package identity.
///
/// `WinRT` notification APIs split into two flavors: no-arg variants that use
/// the package's default AUMID (only valid for packaged apps), and `*WithId`
/// variants that take an explicit AUMID (only valid for unpackaged apps whose
/// AUMID is registered via a Start Menu shortcut). Passing an arbitrary string
/// to the `WithId` variants from inside an MSIX returns `ERROR_NOT_FOUND`
/// because the real AUMID is `<PackageFamilyName>!<Application Id>` and the
/// family-name hash is install-time only.
fn is_packaged() -> bool {
    Package::Current().is_ok()
}

fn notification_permission(
    setting: windows::core::Result<NotificationSetting>,
    packaged: bool,
) -> crate::Result<PermissionState> {
    let setting = match setting {
        // Issue #812: an unpackaged AUMID may have no settings until its first toast.
        Err(error) if !packaged && error.code() == ERROR_NOT_FOUND.to_hresult() => {
            return Ok(PermissionState::Granted);
        }
        result => result?,
    };
    match setting {
        NotificationSetting::Enabled => Ok(PermissionState::Granted),
        NotificationSetting::DisabledForApplication
        | NotificationSetting::DisabledForUser
        | NotificationSetting::DisabledByGroupPolicy
        | NotificationSetting::DisabledByManifest => Ok(PermissionState::Denied),
        _ => Ok(PermissionState::Prompt),
    }
}

/// Resolve a user-supplied image string into a URI scheme Windows toast
/// notifications can actually load.
///
/// Microsoft's toast schema only accepts `http(s)://`, `ms-appx:///`,
/// `ms-appdata:///local/`, and `file:///` for `<image src>`. Anything else
/// (Android resource names like `ic_notify`, bare relative paths,
/// `data:` URIs) makes Windows reject the toast XML and surface the
/// "New notification" placeholder instead of the real title/body.
///
/// Mapping:
/// - already-valid URI scheme → pass through
/// - absolute filesystem path → promote to `file:///`
/// - bare name + packaged → `ms-appx:///resources/<name>` (Tauri's
///   `bundle.resources` convention)
/// - bare name + unpackaged → resolve via Tauri's `PathResolver`, promote
///   to `file:///`
/// - anything else → `None` (caller drops the image, toast keeps rendering)
fn resolve_toast_image_src<R: Runtime>(
    app: &AppHandle<R>,
    input: &str,
    packaged: bool,
) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("ms-appx://")
        || lower.starts_with("ms-appdata://")
        || lower.starts_with("file://")
    {
        return Some(input.to_string());
    }
    if lower.starts_with("data:") {
        log::warn!(
            "Ignoring notification image data: URI: Windows toast schema doesn't \
             accept inline base64; write the bytes to a file and pass a file:/// URI"
        );
        return None;
    }
    let path = std::path::Path::new(input);
    if path.is_absolute() {
        return Some(path_to_file_uri(path));
    }
    if packaged {
        let trimmed = input.trim_start_matches('/');
        return Some(format!("ms-appx:///resources/{trimmed}"));
    }
    if let Ok(resolved) = app.path().resolve(input, BaseDirectory::Resource)
        && resolved.exists()
    {
        return Some(path_to_file_uri(&resolved));
    }
    log::warn!(
        "Ignoring notification image {input:?}: not a supported URI scheme, not an \
         absolute path, and not resolvable as a Tauri resource"
    );
    None
}

/// Convert a filesystem path to a `file:///` URI Windows accepts (forward
/// slashes, no backslashes — required even on Windows).
fn path_to_file_uri(path: &std::path::Path) -> String {
    let normalized = path.display().to_string().replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

/// Accept any well-formed UUID string and reinterpret its bytes as a `GUID`.
///
/// Delegating to `uuid::Uuid::parse_str` lets the manifest CLSID and the
/// `tauri.conf.json` CLSID use either braced (`{xxxxxxxx-…}`), unbraced
/// (`xxxxxxxx-…`), or simple (32 hex chars, no hyphens) conventions without
/// drift causing parse failures.
fn parse_clsid(raw: &str) -> windows::core::Result<GUID> {
    let parsed = uuid::Uuid::parse_str(raw.trim())
        .map_err(|e| windows::core::Error::new(E_INVALIDARG, format!("{e}")))?;
    Ok(GUID::from_u128(parsed.as_u128()))
}

// Enable `?` operator for windows::core::Error
impl From<windows::core::Error> for crate::Error {
    fn from(err: windows::core::Error) -> Self {
        Self::from(PluginInvokeError::InvokeRejected(ErrorResponse {
            code: Some(format!("0x{:08X}", err.code().0)),
            message: Some(err.message()),
            data: (),
        }))
    }
}

/// Shared plugin state wrapped in Arc for thread-safe access.
pub struct WindowsPlugin {
    app_id: String,
    packaged: bool,
    notifier: ToastNotifier,
    action_types: RwLock<HashMap<String, ActionType>>,
    click_listener_active: RwLock<bool>,
    /// Cold-start activation payloads queued before any JS listener has
    /// subscribed. Drained synchronously the first time a `notificationClicked`
    /// listener registers (see `crate::listeners::register_listener`).
    pending_clicks: RwLock<Vec<serde_json::Value>>,
    /// `CoRegisterClassObject` cookie. Kept for the process lifetime — no
    /// explicit `CoRevokeClassObject` on shutdown; the OS reclaims it on exit.
    /// `None` when COM activator wasn't registered (unpackaged or no CLSID in
    /// config).
    com_cookie: RwLock<Option<u32>>,
    #[cfg(feature = "push-notifications")]
    push_channel: RwLock<Option<PushNotificationChannel>>,
}

/// COM activator that receives toast activations from Action Center, including
/// the cold-start case where Windows launches the exe via the manifest's
/// `windows.toastNotificationActivation` extension.
///
/// Wired up by `init()` only when the process has MSIX package identity AND
/// the plugin config carries a valid `toast_activator_clsid`. The callback
/// fires on a COM RPC worker thread (not the Tauri main thread), so all
/// downstream emissions must be thread-safe — `crate::listeners::trigger`
/// already is.
#[implement(INotificationActivationCallback)]
struct ToastActivator {
    plugin: Weak<WindowsPlugin>,
}

/// Out-of-proc COM activator pattern requires a class factory; `CoRegisterClassObject`
/// takes an `IUnknown` that must implement `IClassFactory`, not the activator
/// instance directly. There is no shortcut for the toast activator path.
#[implement(IClassFactory)]
struct ToastActivatorFactory {
    plugin: Weak<WindowsPlugin>,
}

impl std::fmt::Debug for WindowsPlugin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WindowsPlugin")
            .field("app_id", &self.app_id)
            .field("packaged", &self.packaged)
            .finish_non_exhaustive()
    }
}

/// Result of decoding a toast activation's `Arguments` string.
///
/// `build_toast_xml` encodes notification id + extras as JSON into the toast's
/// `launch=` attribute; foreground taps deliver that JSON in `Arguments`,
/// button activations deliver the action's `arguments=` (a plain string). This
/// struct lets the warm (in-process) and cold (COM) paths share decoding so
/// the event shapes the JS layer sees are byte-identical.
struct DecodedActivation {
    /// `notificationClicked` payload — `Some` for foreground taps, `None` for
    /// button activations.
    click: Option<serde_json::Value>,
    /// `actionPerformed` payload — always populated.
    action: serde_json::Value,
}

/// Vendored patch: id of the `<input>` box that submits through `action_id`.
fn input_element_id(action_id: &str) -> String {
    format!("input-{action_id}")
}

/// Vendored patch: the `arguments=` an `<action>` carries.
///
/// JSON rather than the bare action id so `extra` (session id, title, tag)
/// survives a cold COM activation, which only ever sees this string.
fn action_arguments(action_id: &str, extra: &HashMap<String, serde_json::Value>) -> String {
    serde_json::json!({
        "actionId": action_id,
        "data": extra,
    })
    .to_string()
}

fn decode_activation(invoked_args: &str, inputs: &HashMap<String, String>) -> DecodedActivation {
    let input_value = inputs
        .values()
        .next()
        .cloned()
        .map_or(serde_json::Value::Null, serde_json::Value::String);

    let parsed: Option<serde_json::Value> = serde_json::from_str::<serde_json::Value>(invoked_args)
        .ok()
        .filter(serde_json::Value::is_object);

    // Vendored patch: button activations encode `{"actionId": …, "data": …}` in
    // the action's `arguments=` so the session identity survives a cold
    // activation — the COM callback never receives the toast's `launch=`
    // string. Checked before the tuple match below because such a payload is
    // also a JSON object and would otherwise be misread as a tap.
    if let Some(action_id) = parsed
        .as_ref()
        .and_then(|payload| payload.get("actionId"))
        .and_then(serde_json::Value::as_str)
    {
        let extra = parsed
            .as_ref()
            .and_then(|payload| payload.get("data"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let action = serde_json::json!({
            "actionId": action_id,
            "inputValue": input_value,
            "notification": serde_json::Value::Null,
            "extra": extra,
        });
        return DecodedActivation {
            click: None,
            action,
        };
    }

    // Two independent axes: whether `invoked_args` decoded as the `launch=`
    // JSON object we wrote, and whether it's empty at all. Matched as a tuple
    // so the three outcomes stay side by side.
    match (parsed, invoked_args.is_empty()) {
        (Some(launch), _) => {
            let extra = launch
                .get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            // `json!` borrows its value expression (`to_value(&expr)`), so
            // `launch` is still ours to move into `click` afterwards.
            let action = serde_json::json!({
                "actionId": "tap",
                "inputValue": input_value,
                "notification": launch,
                "extra": extra,
            });
            DecodedActivation {
                click: Some(launch),
                action,
            }
        }
        // Legacy path: toasts produced before `launch=` was set, or a tap with
        // no extras. Emit a click with no payload so subscribers still fire.
        (None, true) => {
            let action = serde_json::json!({
                "actionId": "tap",
                "inputValue": input_value,
                "notification": serde_json::Value::Null,
                "extra": {},
            });
            DecodedActivation {
                click: Some(serde_json::json!({ "id": serde_json::Value::Null, "data": {} })),
                action,
            }
        }
        // Button activation carrying legacy plain-string `arguments=`.
        (None, false) => {
            let action = serde_json::json!({
                "actionId": invoked_args,
                "inputValue": input_value,
                "notification": serde_json::Value::Null,
                "extra": serde_json::Value::Null,
            });
            DecodedActivation {
                click: None,
                action,
            }
        }
    }
}

/// Vendored patch: identity of one activation — the arguments plus every
/// user-input pair, sorted so map iteration order cannot produce two different
/// signatures for the same activation.
fn activation_signature(invoked_args: &str, inputs: &HashMap<String, String>) -> String {
    let mut entries: Vec<(&str, &str)> = inputs
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    entries.sort_unstable();

    let mut signature = String::from(invoked_args);
    for (key, value) in entries {
        signature.push('\u{1}');
        signature.push_str(key);
        signature.push('=');
        signature.push_str(value);
    }
    signature
}

/// Vendored patch: activations already delivered, for
/// [`claim_activation`].
static DELIVERED: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();

/// Window inside which a repeated signature counts as the same activation.
const DEDUP_WINDOW: Duration = Duration::from_millis(1500);

/// Vendored patch: `true` when this activation has not already been delivered.
///
/// One toast click reaches Windows through two independent routes — the
/// in-process `Activated` handler and the out-of-proc COM activator — and
/// either can run first. Collapsing identical signatures within
/// [`DEDUP_WINDOW`] makes the JS layer see exactly one event per click.
///
/// A poisoned lock or clock anomaly fails open (report as new): a duplicate
/// event is preferable to a silently swallowed click.
fn claim_activation(signature: &str) -> bool {
    let Ok(mut guard) = DELIVERED.get_or_init(|| Mutex::new(None)).lock() else {
        return true;
    };
    let now = Instant::now();
    if let Some((previous, at)) = guard.as_ref()
        && previous == signature
        && now.duration_since(*at) < DEDUP_WINDOW
    {
        return false;
    }
    *guard = Some((signature.to_string(), now));
    true
}

/// Vendored patch: collect the toast text-box contents.
///
/// Windows hands them over as a `ValueSet` keyed by the `<input id=…>` the
/// toast XML declared. Every failure degrades to "no text" rather than losing
/// the activation — an empty reply still reaches the JS layer as an event.
fn read_user_input(user_input: Option<&ValueSet>) -> HashMap<String, String> {
    let mut inputs = HashMap::new();
    let Some(set) = user_input else {
        return inputs;
    };
    let Ok(iterator) = set.First() else {
        return inputs;
    };

    while iterator.HasCurrent().unwrap_or(false) {
        if let Ok(pair) = iterator.Current() {
            let key = pair.Key().map(|key| key.to_string()).unwrap_or_default();
            if !key.is_empty() {
                let value = pair
                    .Value()
                    .ok()
                    .and_then(|value| value.cast::<IStringable>().ok())
                    .and_then(|value| value.ToString().ok())
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                inputs.insert(key, value);
            }
        }
        if !iterator.MoveNext().unwrap_or(false) {
            break;
        }
    }

    inputs
}

impl INotificationActivationCallback_Impl for ToastActivator_Impl {
    fn Activate(
        &self,
        _appusermodelid: &PCWSTR,
        invokedargs: &PCWSTR,
        data: *const NOTIFICATION_USER_INPUT_DATA,
        count: u32,
    ) -> windows::core::Result<()> {
        let invoked = unsafe { invokedargs.to_string() }.unwrap_or_default();
        let mut inputs: HashMap<String, String> = HashMap::new();
        if count > 0 && !data.is_null() {
            let slice = unsafe { std::slice::from_raw_parts(data, count as usize) };
            for entry in slice {
                let k = unsafe { entry.Key.to_string() }.unwrap_or_default();
                let v = unsafe { entry.Value.to_string() }.unwrap_or_default();
                if !k.is_empty() {
                    inputs.insert(k, v);
                }
            }
        }

        let decoded = decode_activation(&invoked, &inputs);

        // Vendored patch: the same physical click also reaches the in-process
        // `Activated` handler, so collapse the pair into one event.
        if !claim_activation(&activation_signature(&invoked, &inputs)) {
            log::debug!(
                "Toast activation already delivered; skipping COM callback (args={invoked:?})"
            );
            return Ok(());
        }

        log::debug!("Toast COM activation (args={invoked:?}, inputs={})", inputs.len());
        let _ = crate::listeners::trigger("actionPerformed", decoded.action.to_string());

        if let Some(click_payload) = decoded.click {
            // Deliver live OR buffer — never both. Buffering when a listener is
            // already subscribed causes duplicate events on the next re-subscribe
            // (hot reload, route change).
            if crate::listeners::has_listeners("notificationClicked") {
                let _ = crate::listeners::trigger("notificationClicked", click_payload.to_string());
            } else if let Some(plugin) = self.plugin.upgrade()
                && let Ok(mut buf) = plugin.pending_clicks.write()
            {
                buf.push(click_payload);
            }
        }
        Ok(())
    }
}

impl IClassFactory_Impl for ToastActivatorFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Ref<'_, windows::core::IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if !punkouter.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let activator = ToastActivator {
            plugin: self.plugin.clone(),
        };
        let interface: INotificationActivationCallback = activator.into();
        unsafe { interface.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, _flock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

impl WindowsPlugin {
    fn action_types(&self) -> crate::Result<HashMap<String, ActionType>> {
        Ok(self
            .action_types
            .read()
            .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))?
            .clone())
    }

    fn action_types_mut(
        &self,
    ) -> crate::Result<std::sync::RwLockWriteGuard<'_, HashMap<String, ActionType>>> {
        self.action_types
            .write()
            .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))
    }

    fn is_click_listener_active(&self) -> crate::Result<bool> {
        Ok(*self
            .click_listener_active
            .read()
            .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))?)
    }

    fn set_click_listener(&self, active: bool) -> crate::Result<()> {
        *self
            .click_listener_active
            .write()
            .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))? = active;
        Ok(())
    }

    /// Drain queued cold-start click payloads through the listener bus. Called
    /// when a `notificationClicked` listener subscribes (see
    /// `crate::listeners::register_listener`). Idempotent: subsequent calls
    /// with an empty buffer are a no-op.
    pub fn drain_pending_clicks(&self) {
        let drained: Vec<serde_json::Value> = match self.pending_clicks.write() {
            Ok(mut buf) => std::mem::take(&mut *buf),
            Err(e) => {
                log::error!("pending_clicks lock poisoned during drain: {e}");
                return;
            }
        };
        for payload in drained {
            if let Err(e) = crate::listeners::trigger("notificationClicked", payload.to_string()) {
                log::error!("Failed to dispatch buffered click: {e}");
            }
        }
    }

    // `self` is only touched by the push-notifications body; the stub compiled
    // when the feature is off must keep the same signature for its call site.
    #[cfg_attr(not(feature = "push-notifications"), allow(clippy::unused_self))]
    fn open_push_channel(&self) -> crate::Result<String> {
        #[cfg(feature = "push-notifications")]
        {
            let channel =
                PushNotificationChannelManager::CreatePushNotificationChannelForApplicationAsync()?
                    .get()?;
            let uri = channel.Uri()?.to_string_lossy();
            *self
                .push_channel
                .write()
                .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))? =
                Some(channel);
            Ok(uri)
        }
        #[cfg(not(feature = "push-notifications"))]
        {
            Err(crate::Error::Io(std::io::Error::other(
                "Push notifications feature not enabled",
            )))
        }
    }

    #[cfg_attr(not(feature = "push-notifications"), allow(clippy::unused_self))]
    fn close_push_channel(&self) -> crate::Result<()> {
        #[cfg(feature = "push-notifications")]
        {
            // Take the channel out in its own statement so the write guard is
            // released before calling into WinRT — `Close()` is a cross-process
            // call and shouldn't run with the lock held.
            let channel = self
                .push_channel
                .write()
                .map_err(|_| crate::Error::Io(std::io::Error::other("Lock poisoned")))?
                .take();
            if let Some(channel) = channel {
                channel.Close()?;
            }
            Ok(())
        }
        #[cfg(not(feature = "push-notifications"))]
        {
            Err(crate::Error::Io(std::io::Error::other(
                "Push notifications feature not enabled",
            )))
        }
    }
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
    windows_config: WindowsConfig,
) -> crate::Result<Notifications<R>> {
    let app_id = app.config().identifier.clone();
    let packaged = is_packaged();
    let notifier = if packaged {
        ToastNotificationManager::CreateToastNotifier()?
    } else {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app_id))?
    };

    let plugin = Arc::new(WindowsPlugin {
        app_id,
        packaged,
        notifier,
        action_types: RwLock::new(HashMap::new()),
        click_listener_active: RwLock::new(false),
        pending_clicks: RwLock::new(Vec::new()),
        com_cookie: RwLock::new(None),
        #[cfg(feature = "push-notifications")]
        push_channel: RwLock::new(None),
    });

    // Vendored patch: the COM activator used to be registered only for packaged
    // builds, which meant unpackaged DSH never received click or button events
    // at all. Registering it always is half the fix; the other half is
    // `register_unpackaged_app_id` below, which gives Windows an AUMID whose
    // `CustomActivator` points at this CLSID.
    if let Some(clsid_str) = windows_config.toast_activator_clsid.as_deref() {
        if !packaged {
            let display_name = app
                .config()
                .product_name
                .clone()
                .unwrap_or_else(|| plugin.app_id.clone());
            let icon_path = windows_config.icon_path.as_ref().and_then(|path| {
                match app.path().resolve(path, BaseDirectory::Resource) {
                    Ok(resolved) if resolved.is_file() => Some(resolved),
                    result => {
                        log::warn!("Cannot resolve notification icon {path:?}: {result:?}");
                        None
                    }
                }
            });
            if let Err(e) = register_unpackaged_app_id(
                &display_name,
                &plugin.app_id,
                clsid_str,
                icon_path.as_deref(),
            ) {
                log::error!(
                    "Failed to register AUMID {} for toast activation: {e}; \
                     Action Center clicks will fall back to shortcut launch without payload",
                    plugin.app_id
                );
            }
        }
        spawn_toast_activator(&plugin, clsid_str);
    }

    Ok(Notifications {
        app: app.clone(),
        plugin,
    })
}

/// Vendored patch: write a `REG_SZ` value, creating the key when absent.
fn write_registry_string(key: HKEY, name: Option<&str>, value: &str) -> windows::core::Result<()> {
    let mut buffer: Vec<u16> = value.encode_utf16().collect();
    buffer.push(0);
    // `RegSetValueExW` takes a byte slice and passes its length as `cbdata`, so
    // the UTF-16 code units have to be reinterpreted rather than copied.
    let bytes = unsafe { buffer.align_to::<u8>().1 };

    let name = name.map(HSTRING::from);
    // The two branches instantiate `P1` differently (`&HSTRING` vs `PCWSTR`) —
    // both satisfy `Param<PCWSTR>`, but through different impls, so they cannot
    // share one call expression.
    let status = unsafe {
        match name.as_ref() {
            Some(name) => RegSetValueExW(key, name, None, REG_SZ, Some(bytes)),
            None => RegSetValueExW(key, PCWSTR::null(), None, REG_SZ, Some(bytes)),
        }
    };
    if status.0 != 0 {
        Err(status.into())
    } else {
        Ok(())
    }
}

/// Vendored patch: strip the `\\?\` verbatim prefix so `IconUri` is a plain
/// `C:\…` path.
///
/// Tauri resolves `BaseDirectory::Resource` through
/// `tauri_utils::platform::current_exe`, which canonicalizes the executable path,
/// and Windows canonicalization returns the verbatim form. The toast platform
/// silently ignores an `IconUri` in that form — the notification renders with no
/// app logo — while the identical path without the prefix works, spaces included.
fn plain_icon_path(path: &std::path::Path) -> std::borrow::Cow<'_, str> {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        std::borrow::Cow::Owned(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        std::borrow::Cow::Owned(rest.to_owned())
    } else {
        text
    }
}

/// Vendored patch: register the AUMID an unpackaged build needs for toast
/// activation.
///
/// A packaged app inherits a working AUMID from its manifest. An unpackaged one
/// has none, and without it Windows has no idea which COM class to activate when
/// the user clicks a toast — the click silently degrades into a plain shortcut
/// launch that carries no payload. These keys give it that mapping:
/// `Software\Classes\AppUserModelId\<app_id>` carries the display name and the
/// `CustomActivator` CLSID, and `Software\Classes\CLSID\{clsid}\LocalServer32`
/// points at this executable so Windows can relaunch it for a cold activation.
///
/// Mirrors what the wry/tao notification guides and the Windows SDK describe for
/// unpackaged toast registration. Best-effort: failures are logged and the
/// in-process `Activated` path still delivers clicks while the app is running.
fn register_unpackaged_app_id(
    display_name: &str,
    app_id: &str,
    clsid_str: &str,
    icon_path: Option<&std::path::Path>,
) -> windows::core::Result<()> {
    let exe = std::env::current_exe().map_err(|e| {
        windows::core::Error::new(E_FAIL, format!("cannot resolve current executable: {e}"))
    })?;
    let exe = exe.to_string_lossy().into_owned();

    // HKCU\Software\Classes\AppUserModelId\<app_id>
    let aumid_path = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{app_id}"));
    let mut aumid_key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &aumid_path,
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &raw mut aumid_key,
            None,
        )
    };
    if status.0 != 0 {
        return Err(status.into());
    }
    let result = write_registry_string(aumid_key, Some("DisplayName"), display_name)
        .and_then(|()| match icon_path {
            Some(path) => write_registry_string(aumid_key, Some("IconUri"), &plain_icon_path(path)),
            None => Ok(()),
        })
        .and_then(|()| {
            write_registry_string(
                aumid_key,
                Some("CustomActivator"),
                &format!("{{{clsid_str}}}"),
            )
        });
    unsafe { let _ = RegCloseKey(aumid_key); };
    result?;

    // HKCU\Software\Classes\CLSID\{clsid}
    let clsid_path = HSTRING::from(format!("Software\\Classes\\CLSID\\{{{clsid_str}}}"));
    let mut clsid_key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &clsid_path,
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &raw mut clsid_key,
            None,
        )
    };
    if status.0 != 0 {
        return Err(status.into());
    }
    let result = write_registry_string(clsid_key, None, display_name);
    unsafe { let _ = RegCloseKey(clsid_key); };
    result?;

    // HKCU\Software\Classes\CLSID\{clsid}\LocalServer32 = <exe>
    let server_path = HSTRING::from(format!(
        "Software\\Classes\\CLSID\\{{{clsid_str}}}\\LocalServer32"
    ));
    let mut server_key = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &server_path,
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &raw mut server_key,
            None,
        )
    };
    if status.0 != 0 {
        return Err(status.into());
    }
    let result = write_registry_string(server_key, None, &exe);
    unsafe { let _ = RegCloseKey(server_key); };
    result?;

    log::info!("Registered unpackaged AUMID {app_id} (clsid={clsid_str}, exe={exe})");
    Ok(())
}

/// Vendored patch: run `register_toast_activator` on a dedicated
/// single-threaded-apartment thread that pumps messages for the life of the
/// process.
///
/// `CoRegisterClassObject` binds the class to the apartment of the calling
/// thread, and an STA only serves incoming activation calls while it pumps its
/// message queue. Tauri's main thread is already MTA (`CoInitializeEx` there
/// returns `RPC_E_CHANGED_MODE`, which is why the old code silently failed to
/// register), so registration gets its own thread that blocks in `GetMessageW`.
fn spawn_toast_activator(plugin: &Arc<WindowsPlugin>, clsid_str: &str) {
    let clsid = match parse_clsid(clsid_str) {
        Ok(clsid) => clsid,
        Err(e) => {
            log::error!("Invalid toastActivatorClsid {clsid_str}: {e}");
            return;
        }
    };
    let factory = ToastActivatorFactory {
        plugin: Arc::downgrade(plugin),
    };
    let plugin = Arc::clone(plugin);
    let clsid_str = clsid_str.to_string();

    let spawned = std::thread::Builder::new()
        .name("dsh-toast-activator".to_string())
        .spawn(move || {
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if hr != S_OK && hr != S_FALSE {
                log::error!("Failed to initialize toast activator apartment: {hr:?}");
                return;
            }
            let factory_interface: IClassFactory = factory.into();
            let cookie =
                unsafe { CoRegisterClassObject(&raw const clsid, &factory_interface, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE) };
            match cookie {
                Ok(cookie) => {
                    if let Ok(mut slot) = plugin.com_cookie.write() {
                        *slot = Some(cookie);
                    }
                    log::info!("Toast activator registered (clsid={clsid_str}, cookie={cookie})");
                }
                Err(e) => {
                    log::error!(
                        "Failed to register toast activator (clsid={clsid_str}): {e}; \
                         Action Center clicks will fall back to shortcut launch without payload"
                    );
                    return;
                }
            }

            // Keep the apartment alive and dispatch activation calls until the
            // process exits. `GetMessageW` returning 0 (WM_QUIT) or -1 (error)
            // both end the loop.
            let mut message = MSG::default();
            loop {
                let result = unsafe { GetMessageW(&raw mut message, None, 0, 0) };
                if result.0 == 0 || result.0 == -1 {
                    break;
                }
                unsafe {
                    let _ = TranslateMessage(&raw const message);
                    DispatchMessageW(&raw const message);
                }
            }
            unsafe { CoUninitialize() };
        });

    if let Err(e) = spawned {
        log::error!("Failed to spawn toast activator thread: {e}");
    }
}

// `async` mirrors the mobile/macOS plugin API so callers can `.await` uniformly.
#[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
impl<R: Runtime> crate::NotificationsBuilder<R> {
    /// Build toast notification XML using DOM API (safer than string concatenation).
    fn build_toast_xml(
        &self,
        action_types: &HashMap<String, ActionType>,
    ) -> crate::Result<XmlDocument> {
        let doc = XmlDocument::new()?;

        // Create root <toast>
        let toast = doc.CreateElement(&HSTRING::from("toast"))?;
        doc.AppendChild(&toast)?;

        // Encode notification id + extras into `launch=` so the click payload
        // survives a cold-start activation (the COM `Activate` callback only
        // receives the launch string; the in-process `Activated` handler
        // delivers the same string in `ToastActivatedEventArgs.Arguments`).
        let launch = serde_json::json!({
            "id": self.data.id,
            "data": self.data.extra,
        });
        toast.SetAttribute(
            &HSTRING::from("launch"),
            &HSTRING::from(launch.to_string().as_str()),
        )?;

        // Create <visual><binding template="ToastGeneric">
        let visual = doc.CreateElement(&HSTRING::from("visual"))?;
        let binding = doc.CreateElement(&HSTRING::from("binding"))?;
        binding.SetAttribute(&HSTRING::from("template"), &HSTRING::from("ToastGeneric"))?;

        // Add <text> elements for title/body
        if let Some(title) = &self.data.title {
            let text = doc.CreateElement(&HSTRING::from("text"))?;
            text.SetInnerText(&HSTRING::from(title.as_str()))?;
            binding.AppendChild(&text)?;
        }

        if let Some(body) = &self.data.body {
            let text = doc.CreateElement(&HSTRING::from("text"))?;
            text.SetInnerText(&HSTRING::from(body.as_str()))?;
            binding.AppendChild(&text)?;
        }

        // Skip when identical to `body`: WinRT renders each `<text>` on its
        // own line, so duplicating it just shows the same string twice in the
        // expanded view (issue #231).
        if let Some(large_body) = &self.data.large_body
            && self.data.body.as_ref() != Some(large_body)
        {
            let text = doc.CreateElement(&HSTRING::from("text"))?;
            text.SetInnerText(&HSTRING::from(large_body.as_str()))?;
            binding.AppendChild(&text)?;
        }

        // Add icon if specified. Drop silently when the user-supplied string
        // can't be coerced into a Windows-accepted URI scheme — otherwise the
        // whole toast falls back to "New notification".
        if let Some(icon) = &self.data.icon
            && let Some(src) = resolve_toast_image_src(&self.app, icon, self.plugin.packaged)
        {
            let image = doc.CreateElement(&HSTRING::from("image"))?;
            image.SetAttribute(
                &HSTRING::from("placement"),
                &HSTRING::from("appLogoOverride"),
            )?;
            image.SetAttribute(&HSTRING::from("src"), &HSTRING::from(src.as_str()))?;
            binding.AppendChild(&image)?;
        }

        // Add attachments as images. Same URI resolution applies.
        let mut hero_slot_taken = false;
        for attachment in &self.data.attachments {
            let Some(src) =
                resolve_toast_image_src(&self.app, attachment.url().as_str(), self.plugin.packaged)
            else {
                continue;
            };
            let image = doc.CreateElement(&HSTRING::from("image"))?;
            if !hero_slot_taken {
                image.SetAttribute(&HSTRING::from("placement"), &HSTRING::from("hero"))?;
                hero_slot_taken = true;
            }
            image.SetAttribute(&HSTRING::from("src"), &HSTRING::from(src.as_str()))?;
            binding.AppendChild(&image)?;
        }

        visual.AppendChild(&binding)?;
        toast.AppendChild(&visual)?;

        // Add <actions> if action_type_id specified
        if let Some(action_type_id) = &self.data.action_type_id
            && let Some(action_type) = action_types.get(action_type_id)
        {
            let actions = doc.CreateElement(&HSTRING::from("actions"))?;

            // Vendored patch: text boxes are declared before the buttons that
            // submit them, since `<action hint-inputId=…>` can only reference an
            // id that already exists in the document.
            for action in action_type.actions() {
                if !action.input() {
                    continue;
                }
                let input = doc.CreateElement(&HSTRING::from("input"))?;
                input.SetAttribute(
                    &HSTRING::from("id"),
                    &HSTRING::from(input_element_id(action.id()).as_str()),
                )?;
                input.SetAttribute(&HSTRING::from("type"), &HSTRING::from("text"))?;
                if let Some(placeholder) = action.input_placeholder() {
                    input.SetAttribute(
                        &HSTRING::from("placeHolderContent"),
                        &HSTRING::from(placeholder),
                    )?;
                }
                actions.AppendChild(&input)?;
            }

            for action in action_type.actions() {
                let action_el = doc.CreateElement(&HSTRING::from("action"))?;
                // Vendored patch: an input action's caption is the submit
                // button label, which Windows takes from the same `content=`
                // attribute as any other button.
                let content = action.input_button_title().unwrap_or(action.title());
                action_el.SetAttribute(&HSTRING::from("content"), &HSTRING::from(content))?;
                action_el.SetAttribute(
                    &HSTRING::from("arguments"),
                    &HSTRING::from(action_arguments(action.id(), &self.data.extra).as_str()),
                )?;
                if action.input() {
                    action_el.SetAttribute(
                        &HSTRING::from("hint-inputId"),
                        &HSTRING::from(input_element_id(action.id()).as_str()),
                    )?;
                }
                let activation_type = if action.foreground() {
                    "foreground"
                } else {
                    "background"
                };
                action_el.SetAttribute(
                    &HSTRING::from("activationType"),
                    &HSTRING::from(activation_type),
                )?;
                actions.AppendChild(&action_el)?;
            }
            toast.AppendChild(&actions)?;
        }

        // Add <audio> element for silent or custom sound
        if self.data.silent {
            let audio = doc.CreateElement(&HSTRING::from("audio"))?;
            audio.SetAttribute(&HSTRING::from("silent"), &HSTRING::from("true"))?;
            toast.AppendChild(&audio)?;
        } else if let Some(sound) = &self.data.sound {
            let audio = doc.CreateElement(&HSTRING::from("audio"))?;
            audio.SetAttribute(&HSTRING::from("src"), &HSTRING::from(sound.as_str()))?;
            toast.AppendChild(&audio)?;
        }

        Ok(doc)
    }

    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn show(self) -> crate::Result<()> {
        let action_types = self.plugin.action_types()?;
        let toast_xml = self.build_toast_xml(&action_types)?;

        let tag = HSTRING::from(self.data.id.to_string());
        let group = self.data.group.as_ref().map(|g| HSTRING::from(g.as_str()));

        // Check if this is a scheduled notification
        if let Some(schedule) = &self.data.schedule {
            let delivery_time = schedule_to_datetime(schedule)?;
            let scheduled = ScheduledToastNotification::CreateScheduledToastNotification(
                &toast_xml,
                delivery_time,
            )?;

            scheduled.SetTag(&tag)?;
            if let Some(g) = &group {
                scheduled.SetGroup(g)?;
            }

            self.plugin.notifier.AddToSchedule(&scheduled)?;
        } else {
            // Immediate notification
            let toast = ToastNotification::CreateToastNotification(&toast_xml)?;
            toast.SetTag(&tag)?;
            if let Some(g) = &group {
                toast.SetGroup(g)?;
            }

            // Vendored patch: `is_click_listener_active` alone was the gate, so a
            // subscriber that only listened for `actionPerformed` (the reply
            // button on a question toast, which carries the typed text) never got
            // an in-process handler attached at all. Either listener now counts.
            if self.plugin.is_click_listener_active()?
                || crate::listeners::has_listeners("actionPerformed")
            {
                let notification = ActiveNotification {
                    id: self.data.id,
                    tag: Some(self.data.id.to_string()),
                    title: self.data.title.clone(),
                    body: self.data.body.clone(),
                    group: self.data.group.clone(),
                    group_summary: self.data.group_summary,
                    data: HashMap::new(),
                    extra: self.data.extra.clone(),
                    attachments: self.data.attachments.clone(),
                    action_type_id: self.data.action_type_id.clone(),
                    schedule: self.data.schedule.clone(),
                    sound: self.data.sound.clone(),
                };

                toast.Activated(&TypedEventHandler::new(
                    move |_: windows::core::Ref<'_, ToastNotification>,
                          args: windows::core::Ref<'_, windows::core::IInspectable>| {
                        if let Some(inspectable) = &*args
                            && let Ok(activated) = inspectable.cast::<ToastActivatedEventArgs>()
                        {
                            let arguments = activated
                                .Arguments()
                                .map(|s| s.to_string_lossy())
                                .unwrap_or_default();

                            // Vendored patch: text typed into any `<input>` the
                            // toast declared. Windows delivers it only through
                            // this event args interface, so without reading it
                            // here a reply could never reach the JS layer.
                            let inputs =
                                read_user_input(activated.UserInput().ok().as_ref());
                            let input_value = inputs
                                .values()
                                .next()
                                .cloned()
                                .map_or(serde_json::Value::Null, serde_json::Value::String);

                            // Vendored patch: one click reaches us twice — here
                            // and through the out-of-proc COM activator (see
                            // `claim_activation`). Both carry the same arguments
                            // and inputs, so the first one through wins.
                            if !claim_activation(&activation_signature(&arguments, &inputs)) {
                                log::debug!(
                                    "Toast activation already delivered; skipping in-process handler (args={arguments:?})"
                                );
                                return Ok(());
                            }

                            let parsed: Option<serde_json::Value> =
                                serde_json::from_str::<serde_json::Value>(&arguments)
                                    .ok()
                                    .filter(serde_json::Value::is_object);

                            // Foreground tap: empty `Arguments` (legacy toasts
                            // without `launch=`) or the JSON object we wrote into
                            // `launch=`. A JSON object carrying `actionId` came
                            // from an `<action arguments=…>` button instead — the
                            // `launch=` object never has that key.
                            let button = parsed
                                .as_ref()
                                .and_then(|payload| payload.get("actionId"))
                                .and_then(serde_json::Value::as_str);
                            let is_tap = button.is_none()
                                && (arguments.is_empty() || parsed.is_some());

                            let action_id = match button {
                                Some(action_id) => action_id.to_string(),
                                None => "tap".to_string(),
                            };

                            // Vendored patch: surface `extra` alongside the
                            // notification so the JS layer can recover the
                            // session identity from a button activation too.
                            let extra = parsed
                                .as_ref()
                                .and_then(|payload| payload.get("data"))
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);

                            let payload = serde_json::json!({
                                "actionId": action_id,
                                "inputValue": input_value,
                                "notification": notification,
                                "extra": extra,
                            });
                            if let Err(e) =
                                crate::listeners::trigger("actionPerformed", payload.to_string())
                            {
                                log::error!("Failed to trigger actionPerformed: {e}");
                            }

                            if is_tap {
                                let click_payload = serde_json::json!({
                                    "id": notification.id,
                                    "data": notification.extra,
                                });
                                if let Err(e) = crate::listeners::trigger(
                                    "notificationClicked",
                                    click_payload.to_string(),
                                ) {
                                    log::error!("Failed to trigger notificationClicked: {e}");
                                }
                            }
                        }
                        Ok(())
                    },
                ))?;
            }

            self.plugin.notifier.Show(&toast)?;
        }

        // Trigger notification event
        let payload = serde_json::json!({
            "id": self.data.id,
            "title": self.data.title,
            "body": self.data.body,
            "actionTypeId": self.data.action_type_id,
            "extra": self.data.extra,
        });
        if let Err(e) = crate::listeners::trigger("notification", payload.to_string()) {
            log::error!("Failed to trigger notification: {e}");
        }

        Ok(())
    }
}

/// Convert Schedule to Windows `DateTime`.
fn schedule_to_datetime(schedule: &Schedule) -> crate::Result<DateTime> {
    let now = time::OffsetDateTime::now_utc();

    let delivery_time = match schedule {
        Schedule::At { date, .. } => *date,
        Schedule::Interval { interval, .. } => {
            // Build duration from interval fields
            let seconds = i64::from(interval.second.unwrap_or(0));
            let minutes = i64::from(interval.minute.unwrap_or(0));
            let hours = i64::from(interval.hour.unwrap_or(0));
            let days = i64::from(interval.day.unwrap_or(0));
            let total_seconds = seconds + minutes * 60 + hours * 3600 + days * 86400;
            now + time::Duration::seconds(total_seconds)
        }
        Schedule::Every {
            interval, count, ..
        } => {
            let base_seconds: i64 = match interval {
                ScheduleEvery::Year => 365 * 86400,
                ScheduleEvery::Month => 30 * 86400,
                ScheduleEvery::TwoWeeks => 14 * 86400,
                ScheduleEvery::Week => 7 * 86400,
                ScheduleEvery::Day => 86400,
                ScheduleEvery::Hour => 3600,
                ScheduleEvery::Minute => 60,
                ScheduleEvery::Second => 1,
            };
            now + time::Duration::seconds(base_seconds * i64::from(*count))
        }
    };

    unix_to_windows_datetime(delivery_time)
}

/// Convert a Unix timestamp to Windows `DateTime` (FILETIME).
fn unix_to_windows_datetime(time: time::OffsetDateTime) -> crate::Result<DateTime> {
    let ft = FileTime::try_from(time.to_utc())
        .map_err(|_| crate::Error::Io(std::io::Error::other("Schedule date out of range")))?;
    let raw: i64 = ft
        .to_raw()
        .try_into()
        .map_err(|_| crate::Error::Io(std::io::Error::other("Schedule date out of range")))?;
    Ok(DateTime { UniversalTime: raw })
}

/// Convert Windows `DateTime` (FILETIME) back to Unix timestamp.
fn windows_datetime_to_unix(dt: DateTime) -> crate::Result<time::OffsetDateTime> {
    let raw: u64 = dt
        .UniversalTime
        .try_into()
        .map_err(|_| crate::Error::Io(std::io::Error::other("DateTime out of range")))?;
    let utc = time::UtcDateTime::try_from(FileTime::new(raw))
        .map_err(|_| crate::Error::Io(std::io::Error::other("DateTime out of range")))?;
    Ok(utc.into())
}

pub struct Notifications<R: Runtime> {
    #[allow(dead_code)]
    app: AppHandle<R>,
    plugin: Arc<WindowsPlugin>,
}

// `async` mirrors the mobile/macOS plugin API so callers can `.await` uniformly.
#[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
impl<R: Runtime> Notifications<R> {
    pub fn builder(&self) -> crate::NotificationsBuilder<R> {
        crate::NotificationsBuilder::new(self.app.clone(), self.plugin.clone())
    }

    /// Drain any cold-start activation payloads queued before the JS
    /// `notificationClicked` listener subscribed. Invoked by
    /// `crate::listeners::register_listener` on first subscription so the
    /// `push-listener.tsx` contract ("subscribing flushes the buffered tap")
    /// holds without the app having to call any extra command.
    pub fn drain_pending_clicks(&self) {
        self.plugin.drain_pending_clicks();
    }

    pub async fn request_permission(&self) -> crate::Result<PermissionState> {
        // Windows doesn't have a runtime permission prompt like mobile
        // We can only check the current state
        self.permission_state().await
    }

    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn register_for_push_notifications(&self) -> crate::Result<String> {
        self.plugin.open_push_channel()
    }

    pub fn unregister_for_push_notifications(&self) -> crate::Result<()> {
        self.plugin.close_push_channel()
    }

    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn permission_state(&self) -> crate::Result<PermissionState> {
        notification_permission(self.plugin.notifier.Setting(), self.plugin.packaged)
    }

    pub fn register_action_types(&self, types: Vec<ActionType>) -> crate::Result<()> {
        // Scoped so the write guard is released at the end of the inserts
        // rather than being held until the function returns.
        {
            let mut action_types = self.plugin.action_types_mut()?;
            for action_type in types {
                action_types.insert(action_type.id().to_string(), action_type);
            }
        }
        Ok(())
    }

    pub fn remove_active(&self, notifications: Vec<i32>) -> crate::Result<()> {
        let history = ToastNotificationManager::History()?;
        let app_id = &self.plugin.app_id;
        for id in notifications {
            let tag = HSTRING::from(id.to_string());
            // Use app-scoped removal with empty group (consistent with GetHistoryWithId usage)
            let res = if self.plugin.packaged {
                history.RemoveGroupedTag(&tag, &HSTRING::new())
            } else {
                history.RemoveGroupedTagWithId(&tag, &HSTRING::new(), &HSTRING::from(app_id))
            };
            if let Err(e) = res {
                log::error!("Failed to remove notification {id}: {e}");
            }
        }
        Ok(())
    }

    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn active(&self) -> crate::Result<Vec<ActiveNotification>> {
        let history = ToastNotificationManager::History()?;
        let notifications = if self.plugin.packaged {
            history.GetHistory()?
        } else {
            history.GetHistoryWithId(&HSTRING::from(&self.plugin.app_id))?
        };

        let mut result = Vec::new();
        for i in 0..notifications.Size()? {
            let notification = notifications.GetAt(i)?;
            let tag = notification.Tag()?.to_string_lossy();
            let id = tag.parse::<i32>().unwrap_or(0);
            let group = notification.Group().ok().map(|s| s.to_string_lossy());

            // Extract title/body from XML content
            let (title, body) = if let Ok(content) = notification.Content() {
                let text_elements = content.GetElementsByTagName(&HSTRING::from("text"))?;
                let title = text_elements
                    .GetAt(0)
                    .ok()
                    .and_then(|el| el.InnerText().ok())
                    .map(|s| s.to_string_lossy());
                let body = text_elements
                    .GetAt(1)
                    .ok()
                    .and_then(|el| el.InnerText().ok())
                    .map(|s| s.to_string_lossy());
                (title, body)
            } else {
                (None, None)
            };

            result.push(ActiveNotification {
                id,
                tag: Some(tag),
                title,
                body,
                group,
                group_summary: false,
                data: HashMap::new(),
                extra: HashMap::new(),
                attachments: Vec::new(),
                action_type_id: None,
                schedule: None,
                sound: None,
            });
        }

        Ok(result)
    }

    pub fn remove_all_active(&self) -> crate::Result<()> {
        let history = ToastNotificationManager::History()?;
        if self.plugin.packaged {
            history.Clear()?;
        } else {
            history.ClearWithId(&HSTRING::from(&self.plugin.app_id))?;
        }
        Ok(())
    }

    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn pending(&self) -> crate::Result<Vec<PendingNotification>> {
        let scheduled = self.plugin.notifier.GetScheduledToastNotifications()?;
        let mut result = Vec::new();

        for i in 0..scheduled.Size()? {
            let notification = scheduled.GetAt(i)?;
            let tag = notification.Tag()?.to_string_lossy();
            let id = tag.parse::<i32>().unwrap_or(0);

            let (title, body) = if let Ok(content) = notification.Content() {
                let text_elements = content.GetElementsByTagName(&HSTRING::from("text"))?;
                let title = text_elements
                    .GetAt(0)
                    .ok()
                    .and_then(|el| el.InnerText().ok())
                    .map(|s| s.to_string_lossy());
                let body = text_elements
                    .GetAt(1)
                    .ok()
                    .and_then(|el| el.InnerText().ok())
                    .map(|s| s.to_string_lossy());
                (title, body)
            } else {
                (None, None)
            };

            // Convert Windows `DateTime` back to Schedule::At
            let schedule = notification.DeliveryTime().ok().and_then(|dt| {
                windows_datetime_to_unix(dt).ok().map(|date| Schedule::At {
                    date,
                    repeating: false,
                    allow_while_idle: false,
                })
            });

            // PendingNotification requires schedule (not Option), skip if we can't extract it
            if let Some(schedule) = schedule {
                result.push(PendingNotification {
                    id,
                    title,
                    body,
                    schedule,
                });
            }
        }

        Ok(result)
    }

    pub fn cancel(&self, notifications: Vec<i32>) -> crate::Result<()> {
        let scheduled = self.plugin.notifier.GetScheduledToastNotifications()?;
        let ids_to_cancel: std::collections::HashSet<_> = notifications.into_iter().collect();

        for i in 0..scheduled.Size()? {
            let Ok(notification) = scheduled.GetAt(i) else {
                continue;
            };
            let Ok(tag) = notification.Tag() else {
                continue;
            };
            let Ok(id) = tag.to_string_lossy().parse::<i32>() else {
                continue;
            };
            if !ids_to_cancel.contains(&id) {
                continue;
            }
            if let Err(e) = self.plugin.notifier.RemoveFromSchedule(&notification) {
                log::error!("Failed to cancel notification {id}: {e}");
            }
        }
        Ok(())
    }

    pub fn cancel_all(&self) -> crate::Result<()> {
        let scheduled = self.plugin.notifier.GetScheduledToastNotifications()?;
        for i in 0..scheduled.Size()? {
            let Ok(notification) = scheduled.GetAt(i) else {
                continue;
            };
            if let Err(e) = self.plugin.notifier.RemoveFromSchedule(&notification) {
                log::error!("Failed to cancel scheduled notification: {e}");
            }
        }
        Ok(())
    }

    pub fn set_click_listener_active(&self, active: bool) -> crate::Result<()> {
        self.plugin.set_click_listener(active)
    }

    /// Create a notification channel (not supported on Windows).
    pub fn create_channel(&self, _channel: crate::Channel) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported on Windows",
        )))
    }

    /// Delete a notification channel (not supported on Windows).
    pub fn delete_channel(&self, _id: impl Into<String>) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported on Windows",
        )))
    }

    /// List notification channels (not supported on Windows).
    pub fn list_channels(&self) -> crate::Result<Vec<crate::Channel>> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported on Windows",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Only referenced by tests, so they'd be unused imports at module scope.
    use crate::models::{Action, ScheduleInterval};

    /// PowerShell App User Model ID - always available on Windows.
    const POWERSHELL_APP_ID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

    #[test]
    fn notification_permission_allows_missing_unpackaged_profile() {
        let error = windows::core::Error::from(ERROR_NOT_FOUND.to_hresult());
        assert_eq!(
            notification_permission(Err(error), false).unwrap(),
            PermissionState::Granted
        );
    }

    #[test]
    fn notification_permission_preserves_missing_packaged_profile_error() {
        let error = windows::core::Error::from(ERROR_NOT_FOUND.to_hresult());
        let error = notification_permission(Err(error), true).unwrap_err();
        assert!(error.to_string().contains("0x80070490"));
    }

    #[test]
    fn notification_permission_preserves_other_errors() {
        for packaged in [false, true] {
            let error = notification_permission(Err(E_FAIL.into()), packaged).unwrap_err();
            assert!(error.to_string().contains("0x80004005"));
        }
    }

    #[test]
    fn notification_permission_respects_windows_settings() {
        for packaged in [false, true] {
            assert_eq!(
                notification_permission(Ok(NotificationSetting::Enabled), packaged).unwrap(),
                PermissionState::Granted
            );
            for setting in [
                NotificationSetting::DisabledForApplication,
                NotificationSetting::DisabledForUser,
                NotificationSetting::DisabledByGroupPolicy,
                NotificationSetting::DisabledByManifest,
            ] {
                assert_eq!(
                    notification_permission(Ok(setting), packaged).unwrap(),
                    PermissionState::Denied
                );
            }
            assert_eq!(
                notification_permission(Ok(NotificationSetting(-1)), packaged).unwrap(),
                PermissionState::Prompt
            );
        }
    }

    #[test]
    fn test_plain_icon_path_strips_verbatim_prefix() {
        assert_eq!(
            plain_icon_path(std::path::Path::new(r"\\?\C:\app\icons\32x32.png")),
            r"C:\app\icons\32x32.png"
        );
        assert_eq!(
            plain_icon_path(std::path::Path::new(r"\\?\D:\a b\icons\32x32.png")),
            r"D:\a b\icons\32x32.png"
        );
    }

    #[test]
    fn test_plain_icon_path_maps_verbatim_unc_prefix() {
        assert_eq!(
            plain_icon_path(std::path::Path::new(r"\\?\UNC\server\share\32x32.png")),
            r"\\server\share\32x32.png"
        );
    }

    #[test]
    fn test_plain_icon_path_keeps_plain_path_unchanged() {
        assert_eq!(
            plain_icon_path(std::path::Path::new(r"C:\app\icons\32x32.png")),
            r"C:\app\icons\32x32.png"
        );
    }

    // ==================== Time Conversion Tests ====================

    /// Windows FILETIME epoch (1601-01-01) offset from Unix epoch (1970-01-01),
    /// in 100-nanosecond ticks. Used only as a test reference value.
    const WINDOWS_EPOCH_OFFSET_TICKS: i128 = 116_444_736_000_000_000;

    #[test]
    fn test_unix_to_windows_datetime_epoch() {
        let result = unix_to_windows_datetime(time::OffsetDateTime::UNIX_EPOCH)
            .expect("Failed to convert Unix epoch");
        assert_eq!(i128::from(result.UniversalTime), WINDOWS_EPOCH_OFFSET_TICKS);
    }

    #[test]
    fn test_unix_to_windows_datetime_known_date() {
        let date = time::macros::datetime!(2000-01-01 00:00:00 UTC);
        let result = unix_to_windows_datetime(date).expect("Failed to convert known date");

        let unix_nanos = 946_684_800i128 * 1_000_000_000;
        let expected = (unix_nanos / 100) + WINDOWS_EPOCH_OFFSET_TICKS;
        assert_eq!(i128::from(result.UniversalTime), expected);
    }

    #[test]
    fn test_windows_datetime_roundtrip() {
        let original = time::macros::datetime!(2024-06-15 14:30:45 UTC);
        let windows_dt =
            unix_to_windows_datetime(original).expect("Failed to convert to Windows datetime");
        let roundtrip =
            windows_datetime_to_unix(windows_dt).expect("Failed to convert back to Unix");

        let diff = (original - roundtrip).whole_nanoseconds().abs();
        assert!(diff < 100, "Roundtrip diff: {diff}ns");
    }

    #[test]
    fn test_schedule_at_conversion() {
        let target = time::macros::datetime!(2025-12-25 10:00:00 UTC);
        let schedule = Schedule::At {
            date: target,
            repeating: false,
            allow_while_idle: false,
        };

        let result = schedule_to_datetime(&schedule).expect("Failed to convert schedule");
        let back = windows_datetime_to_unix(result).expect("Failed to convert back");
        assert!((target - back).whole_nanoseconds().abs() < 100);
    }

    #[test]
    fn test_schedule_interval() {
        let schedule = Schedule::Interval {
            interval: ScheduleInterval {
                year: None,
                month: None,
                day: Some(1),
                weekday: None,
                hour: Some(2),
                minute: Some(30),
                second: Some(45),
            },
            allow_while_idle: false,
        };

        let before = time::OffsetDateTime::now_utc();
        let result = schedule_to_datetime(&schedule).expect("Failed to convert interval schedule");
        let converted = windows_datetime_to_unix(result).expect("Failed to convert back");

        let expected = 86400 + 7200 + 1800 + 45; // 1d + 2h + 30m + 45s
        let actual = (converted - before).whole_seconds();
        assert!((actual - expected).abs() <= 2);
    }

    #[test]
    fn test_schedule_every_variants() {
        let cases = [
            (ScheduleEvery::Second, 1, 1i64),
            (ScheduleEvery::Minute, 1, 60),
            (ScheduleEvery::Hour, 1, 3600),
            (ScheduleEvery::Day, 1, 86400),
            (ScheduleEvery::Week, 1, 7 * 86400),
            (ScheduleEvery::TwoWeeks, 1, 14 * 86400),
            (ScheduleEvery::Month, 1, 30 * 86400),
            (ScheduleEvery::Year, 1, 365 * 86400),
        ];

        for (interval, count, expected) in cases {
            let schedule = Schedule::Every {
                interval,
                count,
                allow_while_idle: false,
            };

            let before = time::OffsetDateTime::now_utc();
            let result = schedule_to_datetime(&schedule)
                .unwrap_or_else(|e| panic!("Failed to convert {interval:?}: {e}"));
            let converted = windows_datetime_to_unix(result)
                .unwrap_or_else(|e| panic!("Failed to convert back {interval:?}: {e}"));
            let actual = (converted - before).whole_seconds();
            assert!(
                (actual - expected).abs() <= 2,
                "{interval:?}: {actual} vs {expected}"
            );
        }
    }

    // ==================== Toast Notifier Tests ====================

    #[test]
    fn test_toast_notifier_creation() {
        let result =
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(POWERSHELL_APP_ID));
        assert!(result.is_ok(), "Failed: {:?}", result.err());
    }

    // ==================== XML Building Tests ====================

    #[test]
    fn test_xml_document_creation() {
        assert!(XmlDocument::new().is_ok());
    }

    #[test]
    fn test_toast_xml_structure() {
        let doc = XmlDocument::new().expect("Failed to create XmlDocument");

        let toast = doc
            .CreateElement(&HSTRING::from("toast"))
            .expect("Failed to create toast element");
        doc.AppendChild(&toast).expect("Failed to append toast");

        let visual = doc
            .CreateElement(&HSTRING::from("visual"))
            .expect("Failed to create visual element");
        let binding = doc
            .CreateElement(&HSTRING::from("binding"))
            .expect("Failed to create binding element");
        binding
            .SetAttribute(&HSTRING::from("template"), &HSTRING::from("ToastGeneric"))
            .expect("Failed to set template attribute");

        let text = doc
            .CreateElement(&HSTRING::from("text"))
            .expect("Failed to create text element");
        text.SetInnerText(&HSTRING::from("Test Title"))
            .expect("Failed to set text content");
        binding
            .AppendChild(&text)
            .expect("Failed to append text to binding");
        visual
            .AppendChild(&binding)
            .expect("Failed to append binding to visual");
        toast
            .AppendChild(&visual)
            .expect("Failed to append visual to toast");

        let xml = doc.GetXml().expect("Failed to get XML").to_string_lossy();
        assert!(
            xml.contains("toast") && xml.contains("ToastGeneric") && xml.contains("Test Title")
        );
    }

    #[test]
    fn test_toast_xml_with_actions() {
        let doc = XmlDocument::new().expect("Failed to create XmlDocument");
        let toast = doc
            .CreateElement(&HSTRING::from("toast"))
            .expect("Failed to create toast element");
        doc.AppendChild(&toast).expect("Failed to append toast");

        let actions = doc
            .CreateElement(&HSTRING::from("actions"))
            .expect("Failed to create actions element");
        let action = doc
            .CreateElement(&HSTRING::from("action"))
            .expect("Failed to create action element");
        action
            .SetAttribute(&HSTRING::from("content"), &HSTRING::from("Accept"))
            .expect("Failed to set content attribute");
        action
            .SetAttribute(&HSTRING::from("arguments"), &HSTRING::from("accept"))
            .expect("Failed to set arguments attribute");
        actions
            .AppendChild(&action)
            .expect("Failed to append action");
        toast
            .AppendChild(&actions)
            .expect("Failed to append actions");

        let xml = doc.GetXml().expect("Failed to get XML").to_string_lossy();
        assert!(xml.contains("actions") && xml.contains("Accept"));
    }

    // ==================== Vendored Patch Tests ====================

    /// The text box, the button that submits it, and the JSON `arguments=` the
    /// button carries — the three pieces upstream never emitted.
    #[test]
    fn test_toast_xml_with_input() {
        let action: Action = serde_json::from_value(serde_json::json!({
            "id": "reply",
            "title": "回复",
            "foreground": true,
            "input": true,
            "inputButtonTitle": "回复",
            "inputPlaceholder": "输入回复内容",
        }))
        .expect("input action must deserialize from the camelCase wire shape");

        assert!(action.input());
        assert_eq!(action.input_button_title(), Some("回复"));
        assert_eq!(action.input_placeholder(), Some("输入回复内容"));
        assert_eq!(input_element_id(action.id()), "input-reply");

        let arguments = action_arguments(
            action.id(),
            &HashMap::from([(
                "sessionId".to_string(),
                serde_json::Value::String("s-1".to_string()),
            )]),
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&arguments).expect("arguments must be JSON");
        assert_eq!(parsed["actionId"], "reply");
        assert_eq!(parsed["data"]["sessionId"], "s-1");

        let doc = XmlDocument::new().expect("Failed to create XmlDocument");
        let toast = doc
            .CreateElement(&HSTRING::from("toast"))
            .expect("Failed to create toast element");
        doc.AppendChild(&toast).expect("Failed to append toast");
        let actions = doc
            .CreateElement(&HSTRING::from("actions"))
            .expect("Failed to create actions element");

        let input = doc
            .CreateElement(&HSTRING::from("input"))
            .expect("Failed to create input element");
        input
            .SetAttribute(
                &HSTRING::from("id"),
                &HSTRING::from(input_element_id(action.id()).as_str()),
            )
            .expect("Failed to set id attribute");
        input
            .SetAttribute(&HSTRING::from("type"), &HSTRING::from("text"))
            .expect("Failed to set type attribute");
        input
            .SetAttribute(
                &HSTRING::from("placeHolderContent"),
                &HSTRING::from(action.input_placeholder().unwrap_or_default()),
            )
            .expect("Failed to set placeHolderContent attribute");
        actions.AppendChild(&input).expect("Failed to append input");

        let action_el = doc
            .CreateElement(&HSTRING::from("action"))
            .expect("Failed to create action element");
        action_el
            .SetAttribute(
                &HSTRING::from("content"),
                &HSTRING::from(action.input_button_title().unwrap_or(action.title())),
            )
            .expect("Failed to set content attribute");
        action_el
            .SetAttribute(
                &HSTRING::from("arguments"),
                &HSTRING::from(arguments.as_str()),
            )
            .expect("Failed to set arguments attribute");
        action_el
            .SetAttribute(
                &HSTRING::from("hint-inputId"),
                &HSTRING::from(input_element_id(action.id()).as_str()),
            )
            .expect("Failed to set hint-inputId attribute");
        actions
            .AppendChild(&action_el)
            .expect("Failed to append action");
        toast
            .AppendChild(&actions)
            .expect("Failed to append actions");

        let xml = doc.GetXml().expect("Failed to get XML").to_string_lossy();
        assert!(xml.contains("placeHolderContent"), "xml: {xml}");
        assert!(xml.contains("hint-inputId"), "xml: {xml}");
        assert!(xml.contains("input-reply"), "xml: {xml}");
        // Attribute values are XML-escaped, so the JSON's own quotes arrive as
        // `&quot;` — match on the bare key instead.
        assert!(xml.contains("actionId"), "xml: {xml}");
        assert!(xml.contains("sessionId"), "xml: {xml}");
    }

    #[test]
    fn test_toast_xml_silent() {
        let doc = XmlDocument::new().expect("Failed to create XmlDocument");
        let toast = doc
            .CreateElement(&HSTRING::from("toast"))
            .expect("Failed to create toast element");
        doc.AppendChild(&toast).expect("Failed to append toast");

        let audio = doc
            .CreateElement(&HSTRING::from("audio"))
            .expect("Failed to create audio element");
        audio
            .SetAttribute(&HSTRING::from("silent"), &HSTRING::from("true"))
            .expect("Failed to set silent attribute");
        toast.AppendChild(&audio).expect("Failed to append audio");

        assert!(
            doc.GetXml()
                .expect("Failed to get XML")
                .to_string_lossy()
                .contains("silent")
        );
    }

    // ==================== Action Types Tests ====================

    #[test]
    fn test_action_types_storage() {
        let types: RwLock<HashMap<String, ActionType>> = RwLock::new(HashMap::new());
        let action_type = ActionType::new("test", vec![Action::new("btn", "Button", false)]);

        types
            .write()
            .expect("RwLock poisoned")
            .insert("test".to_string(), action_type);

        let read = types.read().expect("RwLock poisoned");
        assert!(read.contains_key("test"));
        assert_eq!(read.get("test").expect("Key not found").actions().len(), 1);
        drop(read);
    }

    #[test]
    fn test_multiple_action_types() {
        let types: RwLock<HashMap<String, ActionType>> = RwLock::new(HashMap::new());

        {
            let mut w = types.write().expect("RwLock poisoned");
            w.insert(
                "confirm".to_string(),
                ActionType::new(
                    "confirm",
                    vec![
                        Action::new("yes", "Yes", true),
                        Action::new("no", "No", false),
                    ],
                ),
            );
            w.insert(
                "reply".to_string(),
                ActionType::new("reply", vec![Action::new("reply", "Reply", true)]),
            );
        }

        let r = types.read().expect("RwLock poisoned");
        assert_eq!(r.len(), 2);
        assert!(r.contains_key("confirm") && r.contains_key("reply"));
        drop(r);
    }
}
