# Development

System Manager is a Tauri v2 app. A Rust backend reads the system, and the UI is
React 19 with TanStack Router, Tailwind v4 and Base UI.

## Requirements

- macOS
- Node 20 or later, and pnpm
- Rust stable, from [rustup](https://rustup.rs)

## Run it

```bash
pnpm install
```

```bash
pnpm app
```

`pnpm app` runs `tauri dev`, which starts Vite and the Rust app together. `pnpm dev`
on its own serves only the web UI, which has no backend, so the app shows an error
explaining that.

## Build an app bundle

```bash
pnpm app:build
```

This writes `System Manager.app` and a disk image under `src-tauri/target/release/bundle/`,
for the Mac you build on. The release workflow builds one app for both Apple Silicon and
Intel instead:

```bash
pnpm tauri build --target universal-apple-darwin --bundles app,dmg
```

That needs the Intel target installed once with `rustup target add x86_64-apple-darwin`.

Bundles are ad-hoc signed (`signingIdentity: "-"` in `tauri.conf.json`). That is enough
to run on any Mac, but not to pass Gatekeeper on a downloaded copy, which needs a
Developer ID and notarisation.

## Publish a release

1. Set the new version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
   `package.json`.
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0
   ```

   ```bash
   git push origin v0.2.0
   ```

The [release workflow](../.github/workflows/release.yml) refuses a tag that doesn't
match the app version. It runs the tests, builds the universal app, and publishes a
GitHub release with:

- `System-Manager-<version>-macos-universal.zip`, which the install script and
  Homebrew download
- `System-Manager-<version>-macos-universal.dmg`, for browser downloads
- `checksums.txt`, which the install script verifies against
- `system-manager.rb`, the Homebrew cask filled in for this version

To update Homebrew, copy `system-manager.rb` from the release into `Casks/` in the
[heisdeku/homebrew-tap](https://github.com/heisdeku/homebrew-tap) repository.

The install script and the downloads only work once the repository and its releases
are public.

### Test the install script locally

`scripts/package-release.sh` builds the same assets locally, and `SYSTEM_MANAGER_RELEASE_URL`
points the install script at them. `SYSTEM_MANAGER_DIR` keeps it away from `/Applications`:

```bash
scripts/package-release.sh 0.1.0 /tmp/sm-release
```

```bash
SYSTEM_MANAGER_DIR=/tmp/sm-apps SYSTEM_MANAGER_RELEASE_URL=file:///tmp/sm-release bash scripts/install.sh --version 0.1.0 --no-open
```

## Tests

```bash
cd src-tauri && cargo test
```

Unit tests cover the `lsof` field parser, `ps` time and column parsing, process states,
`.app` bundle detection and project-root detection. Two integration tests scan the real
machine and check the whole pipeline, including that a deleted working directory is
reported as deleted.

Storage tests run in throwaway folders and never touch real data. They create real
APFS clones and hard links to check sizing, try to escape the delete boundary with
crafted ids and symlinks, and compare the macOS size against `df`.

To measure your real disk without deleting anything:

```bash
cd src-tauri && cargo test --test live_storage -- --ignored --nocapture
```

## How the port scan works

Each scan runs these commands in parallel, each with a timeout so a stale network
mount can't freeze the window:

| Step | Command |
| --- | --- |
| Listening sockets | `lsof -nP -w -iTCP -sTCP:LISTEN -F pftPn` |
| UDP sockets, when enabled | `lsof -nP -w -iUDP -F pftPn` |
| Process stats | `ps -axo pid=,ppid=,state=,user=,%cpu=,%mem=,etime=` |
| Executable path | `ps -axo pid=,comm=` |
| Command line | `ps -axo pid=,command=` |
| Working directory | `lsof -a -w -p <pids> -d cwd -F pn` |
| Containers | `docker ps`, only when Docker is running |

`comm` and `command` need separate `ps` calls because both can contain spaces, so each
must be the last column of its own call.

## How storage is measured

Every size is what deleting would free. For each file the backend reads its APFS clone
ID, reference count and private size with `getattrlist`. A file shared with something
outside the item, through a clone or a hard link, only counts for the bytes nothing
else uses. The macOS total reads each system volume's own usage, as `df` does, because
`statfs` reports the whole APFS container for every volume.

The UI never sends a path to delete. It sends an id, which `storage.rs` resolves and
checks again before acting, and measuring and cleaning walk the same list of paths.

## Layout

```
src/
  routes/          TanStack Router routes: __root, index (Ports), storage, settings
  components/      Port table, detail panel, actions, toasts, Base UI wrappers
  lib/             Tauri bindings, filtering, formatting, app and storage state, motion
src-tauri/src/
  lib.rs           Tauri commands
  ports.rs         lsof parsing, grouping, Docker details
  proc.rs          ps snapshot, working directories, project-root detection
  control.rs       Signals, and opening Finder, Terminal or an editor
  storage.rs       Sizing, the list of cleanable items, deletion and the Trash
  sh.rs            Runs commands with a timeout
scripts/
  install.sh       The install script users run
  package-release.sh  Collects a build into release assets
packaging/homebrew/   Cask template, filled in by the release workflow
docs/icon.svg      Icon artwork, with instructions for regenerating the icons
```

## Screenshots

The README screenshots use made-up data, so no real paths end up in the repository.
