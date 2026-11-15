// Runs the Windows SMTC helper build only on Windows, then starts electron-vite dev.
import { spawnSync } from 'node:child_process'

const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (process.platform === 'win32') run('npm run build:helper')
run('electron-vite dev')
