import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const processes = [
  spawn(process.execPath, [path.join(root, 'server', 'index.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '0.0.0.0'], { cwd: root, stdio: 'inherit' }),
]
let shuttingDown = false

function shutdown(signal = 'SIGTERM', exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of processes) {
    if (!child.killed) child.kill(signal)
  }
  process.exitCode = exitCode
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(error)
    shutdown('SIGTERM', 1)
  })
  child.on('exit', (code, signal) => {
    if (!shuttingDown) shutdown(signal || 'SIGTERM', code || 0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
