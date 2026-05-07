#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const coreDir = path.join(projectRoot, 'packages/core/src');

let daemonProcess = null;
let restartTimeout = null;

function startDaemon() {
  console.log('[daemon-watch] Starting daemon...');
  
  daemonProcess = spawn('pnpm', ['--filter', '@flying-pillow/mission', 'run', 'missiond:dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MISSION_SURFACE_PATH: projectRoot,
      MISSION_DAEMON_RUNTIME_MODE: 'source'
    }
  });

  daemonProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`[daemon-watch] Daemon exited with code ${code}`);
    }
  });
}

function restartDaemon() {
  console.log('[daemon-watch] Restarting daemon due to file changes...');
  
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }
  
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
  
  restartTimeout = setTimeout(() => {
    startDaemon();
  }, 500);
}

// Watch for changes in daemon-related files
const watcher = fs.watch(coreDir, { recursive: true }, (eventType, filename) => {
  if (filename && (filename.includes('daemon') || filename.includes('Terminal') || filename.includes('AgentSession'))) {
    restartDaemon();
  }
});

console.log('[daemon-watch] Watching for changes in', coreDir);
startDaemon();

process.on('SIGINT', () => {
  console.log('[daemon-watch] Shutting down...');
  watcher.close();
  if (daemonProcess) {
    daemonProcess.kill();
  }
  process.exit(0);
});
