import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  DeployTargetCheck,
  HistoryRecord,
  ImageDeployTask,
  ImageFileInfo,
  PublishTask,
  ServerConfig,
  SyncLogEvent
} from '../shared/types'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (config: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:save', config),
  setCredential: (ref: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke('credential:set', ref, value),
  getCredential: (ref: string): Promise<string> => ipcRenderer.invoke('credential:get', ref),
  hasCredential: (ref: string): Promise<boolean> => ipcRenderer.invoke('credential:has', ref),
  credentialStatus: (refs: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('credential:status', refs),
  testServer: (serverId: string): Promise<string> => ipcRenderer.invoke('server:test', serverId),
  testServerDraft: (server: ServerConfig, passwordOrKey: string): Promise<string> =>
    ipcRenderer.invoke('server:testDraft', server, passwordOrKey),
  listBranches: (serverId: string, repoId: string): Promise<string[]> =>
    ipcRenderer.invoke('git:listBranches', serverId, repoId),
  runPublish: (task: PublishTask): Promise<HistoryRecord> =>
    ipcRenderer.invoke('publish:run', task),
  listPackageImages: (packageServerId: string): Promise<ImageFileInfo[]> =>
    ipcRenderer.invoke('deploy:listImages', packageServerId),
  checkDeployTarget: (deployServerId: string): Promise<DeployTargetCheck> =>
    ipcRenderer.invoke('deploy:checkTarget', deployServerId),
  runImageDeploy: (task: ImageDeployTask): Promise<HistoryRecord> =>
    ipcRenderer.invoke('deploy:runImages', task),
  listHistory: (): Promise<HistoryRecord[]> => ipcRenderer.invoke('history:list'),
  createId: (): Promise<string> => ipcRenderer.invoke('id:create'),
  exportJson: (
    defaultName: string,
    data: unknown
  ): Promise<{ ok: false } | { ok: true; path: string }> =>
    ipcRenderer.invoke('dialog:exportJson', defaultName, data),
  importJson: (): Promise<{ ok: false } | { ok: true; data: unknown; path: string }> =>
    ipcRenderer.invoke('dialog:importJson'),
  setTitleBarTheme: (theme: string): Promise<boolean> =>
    ipcRenderer.invoke('ui:setTitleBar', theme),
  onSyncLog: (handler: (event: SyncLogEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: SyncLogEvent): void => handler(event)
    ipcRenderer.on('sync:log', listener)
    return () => ipcRenderer.removeListener('sync:log', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type AgentBuilderApi = typeof api
