#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddrV4, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{App, AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const DEV_SERVER_URL: &str = "http://127.0.0.1:5174";
const EMBEDDED_SERVER_HOST: &str = "127.0.0.1";
const EMBEDDED_SERVER_PORT: u16 = 31467;
const NATIVE_LOG_DIRECTORY_NAME: &str = "open-mission-native";
const NATIVE_LOG_FILE_NAME: &str = "native-host.log";
const EMBEDDED_SERVER_STDOUT_FILE_NAME: &str = "embedded-server.stdout.log";
const EMBEDDED_SERVER_STDERR_FILE_NAME: &str = "embedded-server.stderr.log";

struct EmbeddedServerChildState(Mutex<Option<Child>>);

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            app.manage(EmbeddedServerChildState(Mutex::new(None)));

            if let Err(error) = ensure_open_mission_daemon_started() {
                eprintln!("Open Mission daemon startup from Tauri failed: {error}");
            }

            let webview_url = if cfg!(debug_assertions) {
                WebviewUrl::External(DEV_SERVER_URL.parse().expect("valid development URL"))
            } else {
                let native_log_directory =
                    resolve_native_log_directory().map_err(tauri::Error::Anyhow)?;
                log_native_event(
                    &native_log_directory,
                    &format!(
                        "Starting embedded Open Mission web server bootstrap on {}.",
                        embedded_server_url(EMBEDDED_SERVER_PORT)
                    ),
                );
                let embedded_server_child = start_embedded_web_server(app, EMBEDDED_SERVER_PORT)?;
                let embedded_server_state = app.state::<EmbeddedServerChildState>();
                let mut child_slot = embedded_server_state.0.lock().unwrap();
                *child_slot = Some(embedded_server_child);
                log_native_event(
                    &native_log_directory,
                    &format!(
                        "Embedded Open Mission web server is ready on {}.",
                        embedded_server_url(EMBEDDED_SERVER_PORT)
                    ),
                );
                WebviewUrl::External(embedded_server_url(EMBEDDED_SERVER_PORT).parse().unwrap())
            };

            WebviewWindowBuilder::new(app, "main", webview_url)
                .title("Flying Pillow Open Mission")
                .inner_size(1440.0, 960.0)
                .min_inner_size(1100.0, 720.0)
                .resizable(true)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Open Mission native host");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_embedded_web_server(app_handle);
        }
    });
}

fn start_embedded_web_server(app: &App, port: u16) -> Result<Child, tauri::Error> {
    let repository_root =
        resolve_repository_root().map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
    let embedded_server_root = resolve_embedded_server_root(app).map_err(tauri::Error::Anyhow)?;
    let node_binary = resolve_node_binary(app).map_err(tauri::Error::Anyhow)?;
    let native_log_directory = resolve_native_log_directory().map_err(tauri::Error::Anyhow)?;
    let embedded_server_stdout_path = native_log_directory.join(EMBEDDED_SERVER_STDOUT_FILE_NAME);
    let embedded_server_stderr_path = native_log_directory.join(EMBEDDED_SERVER_STDERR_FILE_NAME);
    let entry_path = embedded_server_root.join("build/index.js");
    if !entry_path.is_file() {
        return Err(tauri::Error::Anyhow(anyhow::anyhow!(
            "embedded Open Mission web server entrypoint is missing: {}",
            entry_path.display()
        )));
    }

    let origin = embedded_server_url(port);
    let stdout_log_file =
        open_log_file(&embedded_server_stdout_path).map_err(tauri::Error::Anyhow)?;
    let stderr_log_file =
        open_log_file(&embedded_server_stderr_path).map_err(tauri::Error::Anyhow)?;

    log_native_event(
        &native_log_directory,
        &format!(
            "Launching embedded Open Mission web server with node '{}' from '{}' using entry '{}'. stdout='{}' stderr='{}'.",
            node_binary.display(),
            embedded_server_root.display(),
            entry_path.display(),
            embedded_server_stdout_path.display(),
            embedded_server_stderr_path.display()
        ),
    );

    let mut child = Command::new(&node_binary)
        .current_dir(&embedded_server_root)
        .env("HOST", EMBEDDED_SERVER_HOST)
        .env("PORT", port.to_string())
        .env("ORIGIN", &origin)
        .env("OPEN_MISSION_REPOSITORY_ROOT", &repository_root)
        .arg(&entry_path)
        .stdout(Stdio::from(stdout_log_file))
        .stderr(Stdio::from(stderr_log_file))
        .spawn()
        .map_err(|error| {
            tauri::Error::Anyhow(anyhow::anyhow!(
                "could not start embedded Open Mission web server with '{}' at {}: {error}",
                node_binary.display(),
                entry_path.display()
            ))
        })?;

    wait_for_embedded_server(&mut child, port, &native_log_directory)
        .map_err(tauri::Error::Anyhow)?;
    Ok(child)
}

fn wait_for_embedded_server(
    child: &mut Child,
    port: u16,
    native_log_directory: &Path,
) -> Result<(), anyhow::Error> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    let deadline = Instant::now() + Duration::from_secs(15);

    loop {
        if TcpStream::connect_timeout(&address.into(), Duration::from_millis(250)).is_ok() {
            return Ok(());
        }

        if let Some(status) = child.try_wait()? {
            log_native_event(
                native_log_directory,
                &format!(
                    "Embedded Open Mission web server exited before becoming ready with status {status}. stdout='{}' stderr='{}'.",
                    native_log_directory.join(EMBEDDED_SERVER_STDOUT_FILE_NAME).display(),
                    native_log_directory.join(EMBEDDED_SERVER_STDERR_FILE_NAME).display()
                ),
            );
            return Err(anyhow::anyhow!(
                "embedded Open Mission web server exited before becoming ready with status {status}. See logs in {}",
                native_log_directory.display()
            ));
        }

        if Instant::now() >= deadline {
            log_native_event(
                native_log_directory,
                &format!(
                    "Timed out waiting for embedded Open Mission web server on {}. stdout='{}' stderr='{}'.",
                    embedded_server_url(port),
                    native_log_directory.join(EMBEDDED_SERVER_STDOUT_FILE_NAME).display(),
                    native_log_directory.join(EMBEDDED_SERVER_STDERR_FILE_NAME).display()
                ),
            );
            return Err(anyhow::anyhow!(
                "timed out waiting for embedded Open Mission web server on {}. See logs in {}",
                embedded_server_url(port),
                native_log_directory.display()
            ));
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn embedded_server_url(port: u16) -> String {
    format!("http://{EMBEDDED_SERVER_HOST}:{port}")
}

fn stop_embedded_web_server(app_handle: &AppHandle) {
    let Some(state) = app_handle.try_state::<EmbeddedServerChildState>() else {
        return;
    };

    let mut child_slot = state.0.lock().unwrap();
    let Some(mut child) = child_slot.take() else {
        return;
    };

    if let Ok(native_log_directory) = resolve_native_log_directory() {
        log_native_event(
            &native_log_directory,
            &format!(
                "Stopping embedded Open Mission web server pid={}",
                child.id()
            ),
        );
    }

    let _ = child.kill();
    let _ = child.wait();
}

fn resolve_native_log_directory() -> Result<PathBuf, anyhow::Error> {
    let directory_path = env::temp_dir().join(NATIVE_LOG_DIRECTORY_NAME);
    fs::create_dir_all(&directory_path)?;
    Ok(directory_path)
}

fn open_log_file(path: &Path) -> Result<File, anyhow::Error> {
    if let Some(parent_directory) = path.parent() {
        fs::create_dir_all(parent_directory)?;
    }

    Ok(OpenOptions::new().create(true).append(true).open(path)?)
}

fn log_native_event(log_directory: &Path, message: &str) {
    let log_file_path = log_directory.join(NATIVE_LOG_FILE_NAME);
    let Ok(mut log_file) = open_log_file(&log_file_path) else {
        return;
    };

    let _ = writeln!(log_file, "{}", message);
}

fn resolve_embedded_server_root(app: &App) -> Result<PathBuf, anyhow::Error> {
    let resource_directory = app.path().resource_dir()?;
    let embedded_server_root = resource_directory.join("embedded-server");
    if embedded_server_root.is_dir() {
        return Ok(embedded_server_root);
    }

    Err(anyhow::anyhow!(
        "embedded Open Mission web server resources are missing at {}",
        embedded_server_root.display()
    ))
}

fn resolve_node_binary(app: &App) -> Result<PathBuf, anyhow::Error> {
    if let Ok(configured_path) = env::var("OPEN_MISSION_NATIVE_NODE_BINARY") {
        let trimmed_path = configured_path.trim();
        if !trimmed_path.is_empty() {
            return Ok(PathBuf::from(trimmed_path));
        }
    }

    let resource_directory = app.path().resource_dir()?;
    let bundled_node_binary = resource_directory.join("runtime/node");
    if bundled_node_binary.is_file() {
        return Ok(bundled_node_binary);
    }

    Ok(PathBuf::from("node"))
}

fn ensure_open_mission_daemon_started() -> Result<(), String> {
    if env_flag_is_disabled("OPEN_MISSION_NATIVE_DAEMON_AUTOSTART") {
        return Ok(());
    }

    let repository_root = resolve_repository_root()?;
    let daemon_entry_path = resolve_daemon_entry_path(&repository_root)?;
    let node_binary =
        env::var("OPEN_MISSION_NATIVE_NODE_BINARY").unwrap_or_else(|_| String::from("node"));

    let output = Command::new(&node_binary)
        .current_dir(&repository_root)
        .env("OPEN_MISSION_DAEMON_RUNTIME_MODE", "build")
        .arg(&daemon_entry_path)
        .arg("start")
        .arg("--json")
        .output()
        .map_err(|error| {
            format!(
                "could not execute '{node_binary}' for open-missiond startup at {}: {error}",
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
        format!("open-missiond start exited with status {}", output.status)
    };

    Err(detail)
}

fn resolve_repository_root() -> Result<PathBuf, String> {
    if let Ok(configured_path) = env::var("OPEN_MISSION_REPOSITORY_ROOT") {
        let trimmed_path = configured_path.trim();
        if !trimmed_path.is_empty() {
            let path = PathBuf::from(trimmed_path);
            if path.is_dir() {
                return Ok(path);
            }

            return Err(format!(
                "OPEN_MISSION_REPOSITORY_ROOT does not point to a directory: {}",
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

        if candidate_root.join("packages/open-mission").is_dir() {
            return Ok(candidate_root);
        }
    }

    Err(format!(
        "could not resolve Repository root from {}",
        manifest_directory.display()
    ))
}

fn resolve_daemon_entry_path(repository_root: &Path) -> Result<PathBuf, String> {
    if let Ok(configured_path) = env::var("OPEN_MISSION_NATIVE_DAEMON_ENTRY") {
        let trimmed_path = configured_path.trim();
        if !trimmed_path.is_empty() {
            let path = PathBuf::from(trimmed_path);
            if path.is_file() {
                return Ok(path);
            }

            return Err(format!(
                "OPEN_MISSION_NATIVE_DAEMON_ENTRY does not point to a file: {}",
                path.display()
            ));
        }
    }

    let default_entry_path = repository_root.join("packages/open-mission/build/open-missiond.js");
    if default_entry_path.is_file() {
        return Ok(default_entry_path);
    }

    Err(format!(
        "could not find built open-missiond entrypoint at {}",
        default_entry_path.display()
    ))
}

fn env_flag_is_disabled(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref().map(str::trim),
        Some("0") | Some("false") | Some("FALSE") | Some("False")
    )
}
