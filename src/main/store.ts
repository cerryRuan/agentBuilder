import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppConfig, DEFAULT_CONFIG, HistoryRecord } from '../shared/types'

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function configPath(): string {
  return join(dataDir(), 'config.json')
}

function historyPath(): string {
  return join(dataDir(), 'history.json')
}

export function loadConfig(): AppConfig {
  const path = configPath()
  if (!existsSync(path)) {
    saveConfig(DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as AppConfig
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      git: { ...DEFAULT_CONFIG.git, ...(raw.git || {}) },
      ui: { ...DEFAULT_CONFIG.ui, ...(raw.ui || {}) },
      servers: (raw.servers || []).map((s) => ({
        ...s,
        role: s.role === 'deploy' ? 'deploy' : 'package',
        deployDir: s.deployDir || ''
      })),
      repos: (raw.repos || []).map((r) => ({
        ...r,
        buildRole: r.buildRole || 'none'
      })),
      mappings: raw.mappings || []
    }
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function loadHistory(): HistoryRecord[] {
  const path = historyPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as HistoryRecord[]
  } catch {
    return []
  }
}

export function saveHistory(records: HistoryRecord[]): void {
  writeFileSync(historyPath(), JSON.stringify(records.slice(0, 100), null, 2), 'utf-8')
}

export function upsertHistory(record: HistoryRecord): void {
  const list = loadHistory().filter((h) => h.id !== record.id)
  list.unshift(record)
  saveHistory(list)
}
