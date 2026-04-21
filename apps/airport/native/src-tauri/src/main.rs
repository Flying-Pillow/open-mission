#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    tauri::Builder::default()
        .setup(|_| {
            if let Err(error) = ensure_mission_daemon_started() {
                eprintln!("Mission daemon startup from Tauri failed: {error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mission Airport native host");
}

fn ensure_mission_daemon_started() -> Result<(), String> {
    if env_flag_is_disabled("MISSION_NATIVE_DAEMON_AUTOSTART") {
        return Ok(());
    }

    let mission_root = resolve_mission_root()?;
    let daemon_entry_path = resolve_daemon_entry_path(&mission_root)?;
    let node_binary = env::var("MISSION_NATIVE_NODE_BINARY").unwrap_or_else(|_| String::from("node"));

    let output = Command::new(&node_binary)
        .current_dir(&mission_root)
        .env("MISSION_SURFACE_PATH", &mission_root)
        .env("MISSION_DAEMON_RUNTIME_MODE", "build")
        .arg(&daemon_entry_path)
        .arg("start")
        .arg("--json")
        .output()
        .map_err(|error| {
            format!(
                "could not execute '{node_binary}' for missiond startup at {}: {error}",
                daemon_entry_path.display()
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("missiond start exited with status {}", output.status)
    };

    Err(detail)
}

fn resolve_mission_root() -> Result<PathBuf, String> {
    if let Ok(configured_path) = env::var("MISSION_CONTROL_ROOT") {
        let trimmed_path = configured_path.trim();
        if !trimmed_path.is_empty() {
            let path = PathBuf::from(trimmed_path);
            if path.is_dir() {
                return Ok(path);
            }

            return Err(format!(
                "MISSION_CONTROL_ROOT does not point to a directory: {}",
                path.display()
            ));
        }
    }

    let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"));
    for relative_path in ["../../../..", "../../.."] {
        let candidate = manifest_directory.join(relative_path);
        let Ok(candidate_root) = candidate.canonicalize() else {
            continue;
        };

        if candidate_root.join("packages/mission").is_dir() {
            return Ok(candidate_root);
        }
    }

    Err(format!(
        "could not resolve Mission workspace root from {}",
        manifest_directory.display()
    ))
}

fn resolve_daemon_entry_path(mission_root: &Path) -> Result<PathBuf, String> {
    if let Ok(configured_path) = env::var("MISSION_NATIVE_DAEMON_ENTRY") {
        let trimmed_path = configured_path.trim();
        if !trimmed_path.is_empty() {
            let path = PathBuf::from(trimmed_path);
            if path.is_file() {
                return Ok(path);
            }

            return Err(format!(
                "MISSION_NATIVE_DAEMON_ENTRY does not point to a file: {}",
                path.display()
            ));
        }
    }

    let default_entry_path = mission_root.join("packages/mission/build/missiond.js");
    if default_entry_path.is_file() {
        return Ok(default_entry_path);
    }

    Err(format!(
        "could not find built missiond entrypoint at {}",
        default_entry_path.display()
    ))
}

fn env_flag_is_disabled(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref().map(str::trim),
        Some("0") | Some("false") | Some("FALSE") | Some("False")
    )
}
