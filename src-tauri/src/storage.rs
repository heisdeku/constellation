use std::collections::HashMap;
use std::ffi::CString;
use std::fs::{self, Metadata};
use std::os::macos::fs::MetadataExt as _;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::sh;

const DATA_VOLUME: &str = "/System/Volumes/Data";
const SIMCTL_TIMEOUT: Duration = Duration::from_secs(120);
const FINDER_TIMEOUT: Duration = Duration::from_secs(30);
const PS_TIMEOUT: Duration = Duration::from_secs(4);
const SYSTEM_VOLUMES: &[&str] = &["/", "/System/Volumes/Preboot"];
const APPLICATIONS: &str = "/Applications";
const OWN_BUNDLE: &str = "marè.app";
const OPAQUE_SUFFIXES: &[&str] = &[".photoslibrary", ".musiclibrary", ".tvlibrary", ".git"];
const FILE_FOLDERS: &[&str] = &["Documents", "Downloads", "Desktop", "Movies", "Music"];
const ICLOUD_FOLDER: &str = "Library/Mobile Documents";
const GUARDED: &[&str] = &[
    "Desktop",
    "Documents",
    "Downloads",
    "Movies",
    "Music",
    "Pictures",
    ICLOUD_FOLDER,
    "Library/Messages",
    ".Trash",
];
const ACCESS_PROBE: &str = "/Library/Application Support/com.apple.TCC/TCC.db";
const PRIVACY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles";
const OPEN_TIMEOUT: Duration = Duration::from_secs(4);
const TEMP_MIN_AGE: Duration = Duration::from_secs(3 * 24 * 60 * 60);

const PROJECT_ROOTS: &[&str] = &["dev", "code", "projects", "src", "repos", "work", "Developer"];

const ARTIFACTS: &[(&str, &[&str])] = &[
    ("node_modules", &["package.json"]),
    (".next", &["package.json"]),
    (".turbo", &["package.json"]),
    ("target", &["Cargo.toml"]),
    ("Pods", &["Podfile"]),
    ("build", &["build.gradle", "build.gradle.kts"]),
    (".gradle", &["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"]),
];

const SF_NOUNLINK: u32 = 0x0010_0000;
const UNDELETABLE: u32 = libc::UF_IMMUTABLE | libc::SF_IMMUTABLE | SF_NOUNLINK;

const ELECTRON_CACHES: &[&str] = &["Cache", "Code Cache", "GPUCache", "CachedData", "DawnCache"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Safety {
    Safe,
    Review,
    Keep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    Packages,
    Mobile,
    Apps,
    Hidden,
    Projects,
    Applications,
    Documents,
    Icloud,
    Messages,
    Photos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Disposal {
    Delete,
    Trash,
    None,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub group: Group,
    pub label: String,
    pub detail: String,
    pub path: String,
    pub safety: Safety,
    pub disposal: Disposal,
    pub browsable: bool,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub apparent_bytes: u64,
    pub reclaimable_bytes: u64,
    pub unreadable: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub system_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub removed: u64,
    pub protected_items: u64,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cleanup {
    Contents,
    Whole,
    Stale,
    AllButNewest,
    Command(&'static [&'static str]),
    Trash,
    Nothing,
}

#[derive(Debug, Clone)]
struct Plan {
    target: Target,
    cleanup: Cleanup,
}

fn plan(
    id: String,
    group: Group,
    label: impl Into<String>,
    detail: &str,
    path: PathBuf,
    safety: Safety,
    cleanup: Cleanup,
) -> Plan {
    let disposal = match cleanup {
        Cleanup::Trash => Disposal::Trash,
        Cleanup::Nothing => Disposal::None,
        _ => Disposal::Delete,
    };
    Plan {
        target: Target {
            id,
            group,
            label: label.into(),
            detail: detail.to_string(),
            path: path.to_string_lossy().into_owned(),
            safety,
            disposal,
            browsable: false,
            modified_ms: None,
        },
        cleanup,
    }
}

fn fixed_plans(home: &Path) -> Vec<Plan> {
    use Cleanup::*;
    use Group::*;
    use Safety::*;

    #[rustfmt::skip]
    let entries: [(&str, Group, &str, &str, &str, Safety, Cleanup); 15] = [
        ("npm", Packages, "npm cache", "Every package npm has ever downloaded. Installs re-fetch what they need.", ".npm/_cacache", Safe, Contents),
        ("npx", Packages, "npx cache", "Tools run once with npx. They download again next time you run them.", ".npm/_npx", Safe, Contents),
        ("pnpm", Packages, "pnpm store", "Shared package store. Projects keep working; new installs download again.", "Library/pnpm/store", Safe, Contents),
        ("bun", Packages, "Bun cache", "Packages Bun has downloaded. Installs re-fetch what they need.", ".bun/install/cache", Safe, Contents),
        ("gradle", Packages, "Gradle caches", "Downloaded dependencies and build caches. The next Android build is slower.", ".gradle/caches", Safe, Contents),
        ("gradle-dists", Packages, "Gradle distributions", "Whole copies of Gradle per version. Projects download theirs again.", ".gradle/wrapper/dists", Safe, Contents),
        ("cargo", Packages, "Cargo registry", "Downloaded crates. The next Rust build fetches them again.", ".cargo/registry", Safe, Contents),
        ("dot-cache", Packages, "~/.cache", "Mixed tool caches. Some hold models or data that are slow to fetch again.", ".cache", Review, Contents),
        ("derived-data", Mobile, "Xcode DerivedData", "Build output and indexes. The next Xcode build starts from scratch.", "Library/Developer/Xcode/DerivedData", Safe, Contents),
        ("device-support", Mobile, "iOS device support", "Symbols copied from phones you've plugged in. Xcode copies them again.", "Library/Developer/Xcode/iOS DeviceSupport", Safe, Contents),
        ("archives", Mobile, "Xcode archives", "Builds you archived for release. Needed to symbolicate crash reports for them.", "Library/Developer/Xcode/Archives", Review, Contents),
        ("simulators", Mobile, "Simulator devices", "Erases every simulator, with its apps and data. Fails while one is running.", "Library/Developer/CoreSimulator/Devices", Review, Command(&["xcrun", "simctl", "erase", "all"])),
        ("logs", Apps, "App logs", "Logs apps wrote for troubleshooting. Nothing depends on them.", "Library/Logs", Safe, Contents),
        ("app-support", Apps, "Application Support", "Your apps' real data: accounts, chats, projects. Clear it from inside each app.", "Library/Application Support", Keep, Nothing),
        ("trash", Hidden, "Trash", "Everything you've already moved to the Trash.", ".Trash", Review, Contents),
    ];

    entries
        .into_iter()
        .map(|(id, group, label, detail, path, safety, cleanup)| {
            plan(id.to_string(), group, label, detail, home.join(path), safety, cleanup)
        })
        .chain([plan(
            "temp".to_string(),
            Group::Hidden,
            "Old temporary files",
            "Temp files untouched for three days. Sockets and anything recent are left alone.",
            std::env::temp_dir(),
            Safety::Safe,
            Stale,
        )])
        .collect()
}

/// The folders of your own that appear as rows, each opened to act on what's inside.
fn location_plans(home: &Path) -> Vec<Plan> {
    let folder = |name: &str, group, detail: &str| {
        let mut out = plan(
            format!("folder:{name}"),
            group,
            name.rsplit('/').next().unwrap_or(name),
            detail,
            home.join(name),
            Safety::Keep,
            Cleanup::Nothing,
        );
        out.target.browsable = true;
        out
    };

    let mut plans: Vec<Plan> = FILE_FOLDERS
        .iter()
        .chain(PROJECT_ROOTS)
        .map(|name| folder(name, Group::Documents, "Open to see what's taking up space."))
        .collect();
    plans.push(folder(
        ICLOUD_FOLDER,
        Group::Icloud,
        "Only what's downloaded to this Mac counts here.",
    ));
    plans.push(plan(
        "messages".to_string(),
        Group::Messages,
        "Messages",
        "Conversations and attachments. Delete them in Messages: removing the files breaks its library.",
        home.join("Library/Messages"),
        Safety::Keep,
        Cleanup::Nothing,
    ));
    plans.push(plan(
        "photos".to_string(),
        Group::Photos,
        "Photos Library",
        "Delete in Photos: removing files from inside the library corrupts it.",
        home.join("Pictures/Photos Library.photoslibrary"),
        Safety::Keep,
        Cleanup::Nothing,
    ));
    plans
}

fn app_folders(home: &Path) -> [PathBuf; 2] {
    [PathBuf::from(APPLICATIONS), home.join("Applications")]
}

fn app_plan(path: &Path) -> Plan {
    let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    plan(
        format!("app:{}", path.display()),
        Group::Applications,
        name,
        "Moves the app to the Trash. Its settings and data stay in your Library.",
        path.to_path_buf(),
        Safety::Review,
        Cleanup::Trash,
    )
}

/// A real, removable app: symlinks like Safari's point into the sealed system.
fn is_removable_app(path: &Path) -> bool {
    let is_app = path.extension().is_some_and(|e| e == "app");
    let own = path.file_name().is_some_and(|n| n == OWN_BUNDLE);
    is_app && !own && fs::symlink_metadata(path).is_ok_and(|m| m.is_dir()) && !undeletable(path)
}

fn app_plans(home: &Path) -> Vec<Plan> {
    app_folders(home)
        .iter()
        .flat_map(|dir| fs::read_dir(dir).into_iter().flatten().flatten())
        .map(|e| e.path())
        .filter(|p| is_removable_app(p))
        .map(|p| app_plan(&p))
        .collect()
}

fn browse_roots(home: &Path) -> Vec<PathBuf> {
    FILE_FOLDERS
        .iter()
        .chain(PROJECT_ROOTS)
        .chain([&ICLOUD_FOLDER])
        .map(|r| home.join(r))
        .collect()
}

fn is_opaque(path: &Path) -> bool {
    path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        OPAQUE_SUFFIXES.iter().any(|s| name.ends_with(s))
    })
}

/// Something of yours that may be moved to the Trash: strictly inside a browsable
/// folder, reached without `..`, and not a symlink leading somewhere else.
fn is_browsable_item(path: &Path, home: &Path) -> bool {
    let inside = browse_roots(home).iter().any(|r| path.starts_with(r) && path != r);
    inside
        && !path.components().any(|c| c.as_os_str() == "..")
        && !is_opaque(path)
        && !undeletable(path)
        && fs::symlink_metadata(path).is_ok()
}

fn item_plan(path: &Path, home: &Path) -> Plan {
    let icloud = path.starts_with(home.join(ICLOUD_FOLDER));
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let detail = if icloud {
        "Moving this to the Trash removes it from iCloud on all your devices."
    } else {
        "Goes to the Trash."
    };
    let mut out = plan(
        format!("item:{}", path.display()),
        if icloud { Group::Icloud } else { Group::Documents },
        name,
        detail,
        path.to_path_buf(),
        Safety::Review,
        Cleanup::Trash,
    );
    let meta = fs::symlink_metadata(path).ok();
    out.target.browsable = meta.as_ref().is_some_and(|m| m.is_dir());
    out.target.modified_ms = meta.as_ref().and_then(modified_ms);
    out
}

/// What's directly inside a folder, for drilling down from a row.
pub fn children(path: &str, home: &Path) -> Result<Vec<Target>, String> {
    let dir = Path::new(path);
    let is_root = browse_roots(home).iter().any(|r| r == dir);
    if !is_root && !is_browsable_item(dir, home) {
        return Err(format!("`{path}` can't be browsed here."));
    }
    let read = fs::read_dir(dir).map_err(|e| format!("Could not read `{path}`: {e}"))?;
    Ok(read
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_browsable_item(p, home))
        .map(|p| item_plan(&p, home).target)
        .collect())
}

fn child_names(dir: &Path) -> Vec<String> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    read.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

/// A folder name that came back from the UI: one path component, nothing more.
fn single_component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/')
}

fn cache_plan(home: &Path, name: &str) -> Plan {
    plan(
        format!("cache:{name}"),
        Group::Apps,
        name,
        "App cache. Rebuilt as the app runs; it may feel slower at first.",
        home.join("Library/Caches").join(name),
        Safety::Safe,
        Cleanup::Contents,
    )
}

fn electron_plan(home: &Path, app: &str, folder: &str) -> Plan {
    plan(
        format!("electron:{app}/{folder}"),
        Group::Apps,
        format!("{app} · {folder}"),
        "Web content cache inside the app's data folder. Your data isn't touched.",
        home.join("Library/Application Support").join(app).join(folder),
        Safety::Safe,
        Cleanup::Contents,
    )
}

/// Chromium clones its own bundle at launch so an update can't invalidate the running
/// copy's signature, then deletes the clone on exit. A crash or kill leaves it behind.
fn clones_folder() -> Option<PathBuf> {
    std::env::temp_dir().parent().map(|p| p.join("X"))
}

fn clones_plan(name: &str) -> Option<Plan> {
    let browser = name.strip_suffix(".code_sign_clone")?;
    let browser = browser.rsplit('.').next().unwrap_or(browser);
    Some(plan(
        format!("clones:{name}"),
        Group::Hidden,
        format!("{browser} leftover copies"),
        "Copies of the browser left behind by crashes. The newest is kept in case it's in use.",
        clones_folder()?.join(name),
        Safety::Safe,
        Cleanup::AllButNewest,
    ))
}

fn modified_ms(meta: &Metadata) -> Option<u64> {
    let modified = meta.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn project_plan(root: &Path, artifact: &Path) -> Option<Plan> {
    let name = artifact.file_name()?.to_string_lossy().into_owned();
    let project = artifact.parent()?;
    let shown = project.strip_prefix(root).unwrap_or(project).to_string_lossy().into_owned();
    let mut out = plan(
        format!("project:{}", artifact.display()),
        Group::Projects,
        format!("{shown} · {name}"),
        "Rebuilt by reinstalling or building the project. Anything running from it will break.",
        artifact.to_path_buf(),
        Safety::Review,
        Cleanup::Whole,
    );
    out.target.modified_ms = fs::symlink_metadata(artifact).ok().as_ref().and_then(modified_ms);
    Some(out)
}

fn is_artifact(dir: &Path) -> bool {
    let (Some(name), Some(project)) = (dir.file_name(), dir.parent()) else {
        return false;
    };
    ARTIFACTS.iter().any(|(artifact, markers)| {
        name.as_bytes() == artifact.as_bytes() && markers.iter().any(|m| project.join(m).is_file())
    })
}

fn project_roots(home: &Path) -> Vec<PathBuf> {
    PROJECT_ROOTS.iter().map(|r| home.join(r)).filter(|p| p.is_dir()).collect()
}

fn find_artifacts(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let path = entry.path();
            if is_artifact(&path) {
                found.push(path);
            } else if entry.file_name() != ".git" {
                stack.push(path);
            }
        }
    }
    found
}

pub fn has_full_disk_access() -> bool {
    fs::File::open(ACCESS_PROBE).is_ok()
}

/// Opens System Settings at the Full Disk Access list.
pub fn open_privacy_settings() -> Result<(), String> {
    if sh::run_ok("open", &[PRIVACY_SETTINGS], OPEN_TIMEOUT)? {
        Ok(())
    } else {
        Err("Couldn't open System Settings. Open Privacy & Security › Full Disk Access there."
            .to_string())
    }
}

/// Everything worth showing on this machine. Sizes come later from [`measure`], one
/// target at a time, because the slowest of them take minutes. Without
/// `include_guarded`, folders macOS would prompt for are left out.
pub fn targets(home: &Path, include_guarded: bool) -> Vec<Target> {
    let mut plans: Vec<Plan> = fixed_plans(home);
    plans.extend(location_plans(home));
    plans.extend(app_plans(home));

    let caches = home.join("Library/Caches");
    plans.extend(child_names(&caches).iter().map(|name| cache_plan(home, name)));

    let support = home.join("Library/Application Support");
    for app in child_names(&support) {
        for folder in ELECTRON_CACHES {
            plans.push(electron_plan(home, &app, folder));
        }
    }

    if let Some(folder) = clones_folder() {
        plans.extend(child_names(&folder).iter().filter_map(|name| clones_plan(name)));
    }

    for root in project_roots(home) {
        plans.extend(find_artifacts(&root).iter().filter_map(|a| project_plan(&root, a)));
    }

    let guarded: Vec<PathBuf> = GUARDED.iter().map(|g| home.join(g)).collect();
    plans
        .into_iter()
        .map(|p| p.target)
        .filter(|t| include_guarded || !guarded.iter().any(|g| Path::new(&t.path).starts_with(g)))
        .filter(|t| Path::new(&t.path).is_dir())
        .collect()
}

/// Turn an id from the UI back into a plan, or refuse it. Ids carrying a path are
/// checked as strictly as the scan that produced them: this is the delete boundary.
fn find(id: &str, home: &Path) -> Result<Plan, String> {
    let refused = || format!("Unknown storage target `{id}`.");

    if let Some(name) = id.strip_prefix("cache:") {
        return single_component(name).then(|| cache_plan(home, name)).ok_or_else(refused);
    }
    if let Some(rest) = id.strip_prefix("electron:") {
        let (app, folder) = rest.split_once('/').ok_or_else(refused)?;
        let valid = single_component(app) && ELECTRON_CACHES.contains(&folder);
        return valid.then(|| electron_plan(home, app, folder)).ok_or_else(refused);
    }
    if let Some(name) = id.strip_prefix("clones:") {
        return single_component(name).then(|| clones_plan(name)).flatten().ok_or_else(refused);
    }
    if let Some(path) = id.strip_prefix("project:") {
        let path = Path::new(path);
        let root = project_roots(home).into_iter().find(|r| path.starts_with(r));
        let inside = root.filter(|_| !path.components().any(|c| c.as_os_str() == ".."));
        return inside
            .filter(|_| is_artifact(path))
            .and_then(|root| project_plan(&root, path))
            .ok_or_else(refused);
    }
    if let Some(path) = id.strip_prefix("app:") {
        let path = Path::new(path);
        let listed = path.parent().is_some_and(|p| app_folders(home).iter().any(|f| f == p));
        return (listed && is_removable_app(path)).then(|| app_plan(path)).ok_or_else(refused);
    }
    if let Some(path) = id.strip_prefix("item:") {
        let path = Path::new(path);
        return is_browsable_item(path, home).then(|| item_plan(path, home)).ok_or_else(refused);
    }
    fixed_plans(home)
        .into_iter()
        .chain(location_plans(home))
        .find(|p| p.target.id == id)
        .ok_or_else(refused)
}

/// True when nothing under `path` is recent, and nothing is a socket or pipe: those
/// keep old timestamps for as long as the process listening on them runs.
fn is_stale(path: &Path, cutoff: SystemTime) -> bool {
    let mut stack = vec![path.to_path_buf()];
    while let Some(next) = stack.pop() {
        let Ok(meta) = fs::symlink_metadata(&next) else { return false };
        let kind = meta.file_type();
        if kind.is_socket() || kind.is_fifo() || !meta.modified().is_ok_and(|m| m < cutoff) {
            return false;
        }
        if kind.is_dir() {
            let Ok(read) = fs::read_dir(&next) else { return false };
            stack.extend(read.flatten().map(|e| e.path()));
        }
    }
    true
}

fn undeletable(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.st_flags() & UNDELETABLE != 0)
}

/// The paths a plan covers. Measuring and cleaning both go through here.
fn entries(plan: &Plan) -> Result<Vec<PathBuf>, String> {
    let root = Path::new(&plan.target.path);
    let children = || -> Result<Vec<PathBuf>, String> {
        match fs::read_dir(root) {
            Ok(read) => Ok(read
                .flatten()
                .map(|e| e.path())
                .filter(|p| !undeletable(p))
                .collect()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(format!("Could not read `{}`: {e}", plan.target.path)),
        }
    };

    Ok(match plan.cleanup {
        Cleanup::Whole | Cleanup::Command(_) | Cleanup::Trash | Cleanup::Nothing => {
            vec![root.to_path_buf()]
        }
        Cleanup::Contents => children()?,
        Cleanup::Stale => {
            let cutoff = SystemTime::now() - TEMP_MIN_AGE;
            children()?.into_iter().filter(|p| is_stale(p, cutoff)).collect()
        }
        Cleanup::AllButNewest => {
            let mut all = children()?;
            all.sort_by_key(|p| fs::symlink_metadata(p).and_then(|m| m.modified()).ok());
            all.pop();
            all
        }
    })
}

struct CloneInfo {
    id: u64,
    references: u32,
    private_bytes: u64,
}

fn clone_info(path: &Path) -> Option<CloneInfo> {
    const ATTR_CMNEXT_PRIVATESIZE: u32 = 0x0000_0008;
    const ATTR_CMNEXT_CLONEID: u32 = 0x0000_0100;
    const ATTR_CMNEXT_CLONE_REFCNT: u32 = 0x0000_1000;
    const FSOPT_NOFOLLOW: u32 = 0x0000_0001;
    const FSOPT_ATTR_CMN_EXTENDED: u32 = 0x0000_0020;
    const WANTED: u32 = ATTR_CMNEXT_PRIVATESIZE | ATTR_CMNEXT_CLONEID | ATTR_CMNEXT_CLONE_REFCNT;

    #[repr(C, packed(4))]
    #[derive(Default)]
    struct Reply {
        length: u32,
        returned: [u32; 5],
        private_bytes: i64,
        clone_id: u64,
        references: u32,
    }

    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut request: libc::attrlist = unsafe { std::mem::zeroed() };
    request.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    request.commonattr = libc::ATTR_CMN_RETURNED_ATTRS;
    request.forkattr = WANTED;

    let mut reply = Reply::default();
    let rc = unsafe {
        libc::getattrlist(
            c_path.as_ptr(),
            std::ptr::addr_of_mut!(request).cast(),
            std::ptr::addr_of_mut!(reply).cast(),
            std::mem::size_of::<Reply>(),
            FSOPT_NOFOLLOW | FSOPT_ATTR_CMN_EXTENDED,
        )
    };
    let returned = reply.returned;
    if rc != 0 || returned[4] & WANTED != WANTED {
        return None;
    }
    Some(CloneInfo {
        id: reply.clone_id,
        references: reply.references,
        private_bytes: reply.private_bytes.max(0) as u64,
    })
}

#[derive(Default)]
struct SharedStream {
    seen: u64,
    references: u64,
    bytes: u64,
    private_bytes: u64,
}

#[derive(Default)]
struct Tally {
    apparent: u64,
    reclaimable: u64,
    unreadable: u64,
    clones: HashMap<u64, SharedStream>,
    links: HashMap<u64, SharedStream>,
}

impl Tally {
    fn add(&mut self, path: &Path, meta: &Metadata) {
        let bytes = meta.st_blocks() * 512;
        if meta.nlink() > 1 && meta.is_file() {
            let link = self.links.entry(meta.ino()).or_default();
            if link.seen == 0 {
                self.apparent += bytes;
            }
            link.seen += 1;
            link.references = meta.nlink();
            link.bytes = bytes;
            return;
        }

        self.apparent += bytes;
        let info = meta.is_file().then(|| clone_info(path)).flatten();
        match info {
            Some(info) if info.references > 1 => {
                let stream = self.clones.entry(info.id).or_default();
                stream.seen += 1;
                stream.references = u64::from(info.references);
                stream.bytes = bytes;
                stream.private_bytes += info.private_bytes;
            }
            Some(info) => self.reclaimable += info.private_bytes.min(bytes),
            None => self.reclaimable += bytes,
        }
    }

    fn walk(&mut self, root: &Path) {
        let top = match fs::symlink_metadata(root) {
            Ok(top) => top,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => {
                self.unreadable += 1;
                return;
            }
        };
        let device = top.dev();
        let mut stack = vec![(root.to_path_buf(), top)];
        while let Some((path, meta)) = stack.pop() {
            if meta.dev() != device {
                continue;
            }
            self.add(&path, &meta);
            if !meta.is_dir() {
                continue;
            }
            let Ok(read) = fs::read_dir(&path) else {
                self.unreadable += 1;
                continue;
            };
            for entry in read.flatten() {
                match entry.metadata() {
                    Ok(meta) => stack.push((entry.path(), meta)),
                    Err(_) => self.unreadable += 1,
                }
            }
        }
    }

    fn finish(self) -> Measurement {
        let links: u64 = self.links.values().filter(|l| l.seen >= l.references).map(|l| l.bytes).sum();
        let clones: u64 = self
            .clones
            .values()
            .map(|s| if s.seen >= s.references { s.bytes } else { s.private_bytes.min(s.bytes) })
            .sum();
        Measurement {
            apparent_bytes: self.apparent,
            reclaimable_bytes: self.reclaimable + links + clones,
            unreadable: self.unreadable,
        }
    }
}

pub fn measure(id: &str, home: &Path) -> Result<Measurement, String> {
    let plan = find(id, home)?;
    let mut tally = Tally::default();
    match entries(&plan) {
        Ok(paths) => paths.iter().for_each(|path| tally.walk(path)),
        Err(_) => tally.unreadable += 1,
    }
    let mut measurement = tally.finish();
    if plan.target.safety == Safety::Keep {
        measurement.reclaimable_bytes = 0;
    }
    Ok(measurement)
}

/// The resolved path must still be where the plan says. A cache folder swapped for a
/// symlink into something precious is the failure this exists to stop.
fn confirm_location(plan: &Plan, home: &Path) -> Result<(), String> {
    let path = Path::new(&plan.target.path);
    let real = path
        .canonicalize()
        .map_err(|e| format!("Could not resolve `{}`: {e}", plan.target.path))?;
    let parent = path.parent().ok_or_else(|| "Refusing to clean a filesystem root.".to_string())?;
    let expected = parent.canonicalize().map_err(|e| e.to_string())?;
    let name_matches = real.file_name() == path.file_name();

    let temp_root = std::env::temp_dir().parent().and_then(|p| p.canonicalize().ok());
    let inside = real.starts_with(home.canonicalize().map_err(|e| e.to_string())?)
        || real.starts_with(APPLICATIONS)
        || temp_root.is_some_and(|t| real.starts_with(t));

    if real.parent() == Some(expected.as_path()) && name_matches && inside {
        Ok(())
    } else {
        Err(format!("`{}` points somewhere unexpected, so it was left alone.", plan.target.path))
    }
}

/// `remove_dir_all` and `remove_file` act on a symlink itself, never on what it points at.
fn remove(path: &Path) -> std::io::Result<()> {
    if fs::symlink_metadata(path)?.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn is_running(app: &Path) -> Result<bool, String> {
    let bundle = format!("{}/Contents/", app.display());
    Ok(sh::run("ps", &["-axo", "comm="], PS_TIMEOUT)?.lines().any(|l| l.starts_with(&bundle)))
}

/// Through Finder rather than a rename, so Put Back works and name clashes are handled.
/// The path travels as an argument, never as script text.
fn move_to_trash(path: &str) -> Result<(), String> {
    let script = [
        "-e",
        "on run argv",
        "-e",
        "tell application \"Finder\" to delete (POSIX file (item 1 of argv) as alias)",
        "-e",
        "end run",
        path,
    ];
    if sh::run_ok("osascript", &script, FINDER_TIMEOUT)? {
        return Ok(());
    }
    Err("Finder couldn't move it to the Trash. Allow marè to control Finder in \
         System Settings › Privacy & Security › Automation, or check you own the item."
        .to_string())
}

/// Permanently delete a target's contents. Bypasses the Trash on purpose: moving files
/// there would free nothing. Partial success is normal, as a running app may recreate
/// or hold files, so failures are reported rather than aborting the rest.
pub fn clean(id: &str, home: &Path) -> Result<CleanResult, String> {
    let plan = find(id, home)?;
    if plan.target.safety == Safety::Keep {
        return Err(format!("{} is never cleaned here.", plan.target.label));
    }
    confirm_location(&plan, home)?;

    if plan.cleanup == Cleanup::Trash {
        let path = Path::new(&plan.target.path);
        if plan.target.group == Group::Applications && is_running(path)? {
            return Err(format!("Quit {} first.", plan.target.label));
        }
        move_to_trash(&plan.target.path)?;
        return Ok(CleanResult { removed: 1, protected_items: 0, failures: Vec::new() });
    }

    if let Cleanup::Command([program, args @ ..]) = plan.cleanup {
        return if sh::run_ok(program, args, SIMCTL_TIMEOUT)? {
            Ok(CleanResult { removed: 1, protected_items: 0, failures: Vec::new() })
        } else {
            Err(format!("`{}` failed. Shut down any running simulators and try again.", program))
        };
    }

    let mut result = CleanResult { removed: 0, protected_items: 0, failures: Vec::new() };
    for entry in entries(&plan)? {
        match remove(&entry) {
            Ok(()) => result.removed += 1,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                result.protected_items += 1
            }
            Err(e) => result.failures.push(format!("{}: {e}", entry.display())),
        }
    }
    Ok(result)
}

fn volume_stats(volume: &str) -> Result<libc::statfs, String> {
    let path = CString::new(volume).map_err(|e| e.to_string())?;
    let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(path.as_ptr(), &mut stats) } != 0 {
        return Err(format!(
            "Could not read disk usage: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(stats)
}

/// Space one volume uses. `statfs` can't answer this: APFS volumes share a container,
/// so each reports the whole container's usage, and adding two counts it twice.
fn volume_used(volume: &str) -> Result<u64, String> {
    const ATTR_VOL_SPACEUSED: u32 = 0x0080_0000;
    const ATTR_VOL_INFO: u32 = 0x8000_0000;

    #[repr(C, packed(4))]
    #[derive(Default)]
    struct Reply {
        length: u32,
        used: i64,
    }

    let path = CString::new(volume).map_err(|e| e.to_string())?;
    let mut request: libc::attrlist = unsafe { std::mem::zeroed() };
    request.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    request.volattr = ATTR_VOL_INFO | ATTR_VOL_SPACEUSED;

    let mut reply = Reply::default();
    let rc = unsafe {
        libc::getattrlist(
            path.as_ptr(),
            std::ptr::addr_of_mut!(request).cast(),
            std::ptr::addr_of_mut!(reply).cast(),
            std::mem::size_of::<Reply>(),
            0,
        )
    };
    if rc != 0 {
        return Err(format!(
            "Could not read the size of {volume}: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(reply.used.max(0) as u64)
}

pub fn disk_usage() -> Result<DiskUsage, String> {
    let data = volume_stats(DATA_VOLUME)?;
    let block = u64::from(data.f_bsize);
    let mut system_bytes = 0;
    for volume in SYSTEM_VOLUMES {
        system_bytes += volume_used(volume)?;
    }
    Ok(DiskUsage {
        total_bytes: data.f_blocks * block,
        free_bytes: data.f_bavail * block,
        system_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(name: &str) -> Self {
            let unique = format!("mare-{name}-{}", std::process::id());
            let dir = std::env::temp_dir().join(unique);
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Sandbox(dir.canonicalize().unwrap())
        }

        fn write(&self, path: &str, bytes: usize) -> PathBuf {
            let full = self.0.join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, vec![7u8; bytes]).unwrap();
            fs::File::open(&full).unwrap().sync_all().unwrap();
            full
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const MB: usize = 1024 * 1024;

    fn clone_file(from: &Path, to: &Path) {
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        assert!(Command::new("cp").arg("-c").arg(from).arg(to).status().unwrap().success());
    }

    fn near(actual: u64, expected: usize) -> bool {
        actual.abs_diff(expected as u64) < (MB / 8) as u64
    }

    #[test]
    fn clones_of_a_file_outside_the_target_free_nothing() {
        let home = Sandbox::new("clones-outside");
        let original = home.write("app.bin", 4 * MB);
        for n in 0..5 {
            clone_file(&original, &home.0.join(format!(".npm/_cacache/copy{n}")));
        }

        let size = measure("npm", &home.0).unwrap();
        assert!(near(size.apparent_bytes, 20 * MB), "{size:?}");
        assert!(size.reclaimable_bytes < MB as u64, "{size:?}");
    }

    #[test]
    fn clones_wholly_inside_the_target_count_once() {
        let home = Sandbox::new("clones-inside");
        let original = home.write(".npm/_cacache/original", 4 * MB);
        for n in 0..3 {
            clone_file(&original, &home.0.join(format!(".npm/_cacache/copy{n}")));
        }

        let size = measure("npm", &home.0).unwrap();
        assert!(near(size.apparent_bytes, 16 * MB), "{size:?}");
        assert!(near(size.reclaimable_bytes, 4 * MB), "{size:?}");
    }

    #[test]
    fn hard_links_outside_the_target_free_nothing() {
        let home = Sandbox::new("links");
        let original = home.write("kept", 4 * MB);
        fs::create_dir_all(home.0.join(".npm/_cacache")).unwrap();
        fs::hard_link(&original, home.0.join(".npm/_cacache/link")).unwrap();

        let size = measure("npm", &home.0).unwrap();
        assert_eq!(size.reclaimable_bytes, 0, "{size:?}");
    }

    #[test]
    fn plain_files_are_fully_reclaimable_and_get_removed() {
        let home = Sandbox::new("plain");
        home.write(".npm/_cacache/a", 2 * MB);
        home.write(".npm/_cacache/deep/b", MB);

        assert!(near(measure("npm", &home.0).unwrap().reclaimable_bytes, 3 * MB));

        let result = clean("npm", &home.0).unwrap();
        assert_eq!(result.removed, 2);
        assert!(result.failures.is_empty());
        assert!(home.0.join(".npm/_cacache").is_dir(), "the folder itself stays");
        assert_eq!(fs::read_dir(home.0.join(".npm/_cacache")).unwrap().count(), 0);
    }

    #[test]
    fn cleaning_leaves_the_target_of_a_symlink_alone() {
        let home = Sandbox::new("inner-link");
        let precious = home.write("precious/keep.txt", 16);
        home.write(".npm/_cacache/a", 16);
        std::os::unix::fs::symlink(home.0.join("precious"), home.0.join(".npm/_cacache/link")).unwrap();

        clean("npm", &home.0).unwrap();
        assert!(precious.is_file());
    }

    #[test]
    fn refuses_a_cache_folder_redirected_by_a_symlink() {
        let home = Sandbox::new("redirect");
        let precious = home.write("precious/keep.txt", 16);
        fs::create_dir_all(home.0.join(".npm")).unwrap();
        std::os::unix::fs::symlink(home.0.join("precious"), home.0.join(".npm/_cacache")).unwrap();

        assert!(clean("npm", &home.0).is_err());
        assert!(precious.is_file());
    }

    #[test]
    fn refuses_ids_that_escape_their_folder() {
        let home = Sandbox::new("escape");
        home.write("Documents/thesis.txt", 16);
        home.write("dev/app/package.json", 16);
        home.write("dev/app/src/main.ts", 16);

        for id in [
            "cache:..",
            "cache:../../Documents",
            "cache:a/b",
            "electron:../../Documents/Cache",
            "electron:App/Documents",
            "clones:..",
            "clones:not-a-clone-folder",
            "project:/etc",
            "project:/Users",
        ] {
            assert!(clean(id, &home.0).is_err(), "{id} should be refused");
        }

        let outside = format!("project:{}/Documents", home.0.display());
        let not_artifact = format!("project:{}/dev/app/src", home.0.display());
        let traversal = format!("project:{}/dev/app/../../Documents", home.0.display());
        for id in [outside, not_artifact, traversal] {
            assert!(clean(&id, &home.0).is_err(), "{id} should be refused");
        }
        assert!(home.0.join("Documents/thesis.txt").is_file());
        assert!(home.0.join("dev/app/src/main.ts").is_file());
    }

    #[test]
    fn keep_targets_cannot_be_cleaned() {
        let home = Sandbox::new("keep");
        let data = home.write("Library/Application Support/Notes/data.db", 16);

        assert!(clean("app-support", &home.0).is_err());
        assert_eq!(measure("app-support", &home.0).unwrap().reclaimable_bytes, 0);
        assert!(data.is_file());
    }

    #[test]
    fn project_artifacts_need_their_marker_file() {
        let home = Sandbox::new("markers");
        home.write("dev/web/package.json", 16);
        home.write("dev/web/node_modules/lib/index.js", 16);
        home.write("dev/web/node_modules/lib/node_modules/nested/index.js", 16);
        home.write("dev/notes/target/meeting.md", 16);
        home.write("dev/rusty/Cargo.toml", 16);
        home.write("dev/rusty/target/debug/app", 16);

        let found = targets(&home.0, true);
        let projects: Vec<_> = found.iter().filter(|t| t.group == Group::Projects).collect();
        assert_eq!(projects.len(), 2, "{projects:?}");
        assert!(projects.iter().all(|t| t.safety == Safety::Review));
        assert!(!projects.iter().any(|t| t.path.contains("notes")));

        let web = projects.iter().find(|t| t.path.ends_with("web/node_modules")).unwrap();
        assert_eq!(web.label, "web · node_modules");
        clean(&web.id, &home.0).unwrap();
        assert!(!home.0.join("dev/web/node_modules").exists());
        assert!(home.0.join("dev/web/package.json").is_file());
        assert!(home.0.join("dev/notes/target/meeting.md").is_file());
    }

    #[test]
    fn all_but_newest_spares_the_most_recent_entry() {
        let home = Sandbox::new("newest");
        let old = home.write("old/copy", 16);
        let new = home.write("new/copy", 16);
        let long_ago = fs::FileTimes::new().set_modified(SystemTime::now() - TEMP_MIN_AGE);
        fs::File::open(old.parent().unwrap()).unwrap().set_times(long_ago).unwrap();

        let target = plan(
            "t".into(),
            Group::Hidden,
            "t",
            "",
            home.0.clone(),
            Safety::Safe,
            Cleanup::AllButNewest,
        );
        let chosen = entries(&target).unwrap();
        assert!(chosen.contains(&old.parent().unwrap().to_path_buf()));
        assert!(!chosen.contains(&new.parent().unwrap().to_path_buf()));
    }

    #[test]
    fn your_files_go_to_the_trash_and_stay_inside_their_folders() {
        let home = Sandbox::new("items");
        let file = home.write("Downloads/movie.mp4", 16);
        home.write(".ssh/id_rsa", 16);
        home.write("dev/app/.git/config", 16);
        home.write("Pictures/Photos Library.photoslibrary/database", 16);
        home.write("Library/Preferences/app.plist", 16);

        let target = find(&format!("item:{}", file.display()), &home.0).unwrap().target;
        assert_eq!(target.disposal, Disposal::Trash);
        assert_eq!(target.safety, Safety::Review);

        for path in [
            "Downloads",
            ".ssh/id_rsa",
            "dev/app/.git/config",
            "Library/Preferences/app.plist",
            "Pictures/Photos Library.photoslibrary/database",
            "Downloads/../.ssh/id_rsa",
        ] {
            let id = format!("item:{}", home.0.join(path).display());
            assert!(find(&id, &home.0).is_err(), "{path} should be refused");
        }
        assert!(find("item:/etc/hosts", &home.0).is_err());
    }

    #[test]
    fn browsing_hides_what_cannot_be_acted_on() {
        let home = Sandbox::new("browse");
        home.write("dev/app/src/main.ts", 16);
        home.write("dev/app/.git/config", 16);

        let root = home.0.join("dev/app");
        let names: Vec<_> = children(root.to_str().unwrap(), &home.0)
            .unwrap()
            .into_iter()
            .map(|t| t.label)
            .collect();
        assert_eq!(names, ["src"]);

        assert!(children("/etc", &home.0).is_err());
        assert!(children(home.0.to_str().unwrap(), &home.0).is_err());
    }

    #[test]
    fn apps_must_be_real_bundles_in_an_applications_folder() {
        let home = Sandbox::new("apps");
        home.write("Applications/Tool.app/Contents/Info.plist", 16);
        home.write("Applications/marè.app/Contents/Info.plist", 16);
        home.write("Documents/Tool.app/Contents/Info.plist", 16);
        std::os::unix::fs::symlink(
            home.0.join("Applications/Tool.app"),
            home.0.join("Applications/Link.app"),
        )
        .unwrap();

        let app = |path: &str| format!("app:{}", home.0.join(path).display());
        let tool = find(&app("Applications/Tool.app"), &home.0).unwrap().target;
        assert_eq!(tool.label, "Tool");
        assert_eq!(tool.disposal, Disposal::Trash);

        for path in [
            "Applications/marè.app",
            "Applications/Link.app",
            "Documents/Tool.app",
            "Applications/Tool.app/Contents",
        ] {
            assert!(find(&app(path), &home.0).is_err(), "{path} should be refused");
        }
    }

    #[test]
    fn messages_and_photos_cannot_be_cleaned() {
        let home = Sandbox::new("libraries");
        home.write("Library/Messages/chat.db", 16);
        home.write("Pictures/Photos Library.photoslibrary/database", 16);

        assert!(clean("messages", &home.0).is_err());
        assert!(clean("photos", &home.0).is_err());
        assert!(clean("folder:Documents", &home.0).is_err());
    }

    #[test]
    fn a_target_that_has_gone_measures_as_empty_not_unreadable() {
        let home = Sandbox::new("gone");
        let size = measure("npm", &home.0).unwrap();
        assert_eq!((size.apparent_bytes, size.unreadable), (0, 0));
    }

    /// `df` reads the per-volume figure, so it's the independent check on ours.
    #[test]
    fn system_size_agrees_with_df_for_each_volume() {
        for volume in SYSTEM_VOLUMES {
            let output = Command::new("df").args(["-k", volume]).output().unwrap();
            let output = String::from_utf8(output.stdout).unwrap();
            let used_kb: u64 = output
                .lines()
                .nth(1)
                .and_then(|line| line.split_whitespace().nth(2))
                .and_then(|used| used.parse().ok())
                .unwrap();
            let ours = volume_used(volume).unwrap();
            assert!(ours.abs_diff(used_kb * 1024) < 100_000_000, "{volume}: {ours} vs {used_kb}KB");
        }

        let disk = disk_usage().unwrap();
        assert!(disk.system_bytes < disk.total_bytes - disk.free_bytes);
    }

    #[test]
    fn a_scan_without_access_leaves_guarded_folders_out() {
        let home = Sandbox::new("guarded");
        home.write("Documents/report.pdf", 16);
        home.write("Library/Messages/chat.db", 16);
        home.write("dev/web/package.json", 16);
        home.write("dev/web/node_modules/lib/index.js", 16);
        home.write(".npm/_cacache/blob", 16);

        let ids = |include| -> Vec<String> {
            targets(&home.0, include).into_iter().map(|t| t.id).collect()
        };
        let limited = ids(false);
        assert!(limited.contains(&"npm".to_string()));
        assert!(limited.iter().any(|id| id.starts_with("project:")));
        assert!(!limited.iter().any(|id| id == "folder:Documents" || id == "messages"));

        let full = ids(true);
        assert!(full.iter().any(|id| id == "folder:Documents"));
        assert!(full.iter().any(|id| id == "messages"));
    }

    fn lock(path: &Path, flag: &str) {
        assert!(Command::new("chflags").arg(flag).arg(path).status().unwrap().success());
    }

    #[test]
    fn folders_macos_protects_are_neither_counted_nor_attempted() {
        let home = Sandbox::new("protected-top");
        let locked = home.write(".npm/_cacache/locked/data", MB);
        home.write(".npm/_cacache/plain", MB);
        lock(locked.parent().unwrap(), "uchg");

        let size = measure("npm", &home.0).unwrap();
        let result = clean("npm", &home.0).unwrap();
        lock(locked.parent().unwrap(), "nouchg");

        assert!(near(size.reclaimable_bytes, MB), "{size:?}");
        assert_eq!((result.removed, result.protected_items), (1, 0));
        assert!(result.failures.is_empty());
        assert!(locked.is_file());
        assert!(!home.0.join(".npm/_cacache/plain").exists());
    }

    #[test]
    fn protection_found_deeper_down_is_reported_not_failed() {
        let home = Sandbox::new("protected-nested");
        let locked = home.write(".npm/_cacache/folder/locked", 16);
        lock(&locked, "uchg");

        let result = clean("npm", &home.0).unwrap();
        lock(&locked, "nouchg");

        assert_eq!((result.removed, result.protected_items), (0, 1));
        assert!(result.failures.is_empty());
    }

    #[test]
    fn staleness_is_judged_on_everything_inside() {
        let home = Sandbox::new("stale");
        let cutoff = SystemTime::now() - Duration::from_secs(60);
        let fresh = home.write("job/nested/fresh", 16);
        assert!(!is_stale(fresh.parent().unwrap().parent().unwrap(), cutoff));

        let future = SystemTime::now() + Duration::from_secs(60);
        assert!(is_stale(&fresh, future));

        let socket = home.0.join("agent.sock");
        std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert!(!is_stale(&socket, future), "a socket may have a live listener");
    }
}
