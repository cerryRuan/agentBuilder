import { useEffect, useMemo, useState } from 'react'
import type {
  AppConfig,
  DeployTargetCheck,
  ImageDeployStep,
  ImageFileInfo,
  SyncLogEvent
} from '../../../shared/types'
import {
  filterActiveAppServices,
  servicesForImageNames
} from '../../../shared/image-services'
import LogViewer from '../components/LogViewer'
import { useReportRunning, useTaskSession } from '../task-session'

interface Props {
  config: AppConfig
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function ServiceDeployPage({ config }: Props): React.JSX.Element {
  const packageServers = useMemo(
    () => config.servers.filter((s) => (s.role || 'package') === 'package'),
    [config.servers]
  )
  const deployServers = useMemo(
    () => config.servers.filter((s) => s.role === 'deploy'),
    [config.servers]
  )

  const [packageServerId, setPackageServerId] = useState(packageServers[0]?.id || '')
  const [deployServerId, setDeployServerId] = useState(deployServers[0]?.id || '')
  const [images, setImages] = useState<ImageFileInfo[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [loadingImages, setLoadingImages] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<DeployTargetCheck | null>(null)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<SyncLogEvent[]>([])
  const { anyRunning } = useTaskSession()
  useReportRunning('deploy', running)

  useEffect(() => {
    if (!packageServerId && packageServers[0]) setPackageServerId(packageServers[0].id)
  }, [packageServers, packageServerId])

  useEffect(() => {
    if (!deployServerId && deployServers[0]) setDeployServerId(deployServers[0].id)
  }, [deployServers, deployServerId])

  useEffect(() => {
    const off = window.api.onSyncLog((event) => {
      if (event.channel && event.channel !== 'image-deploy') return
      setLogs((prev) => [...prev, event])
    })
    return off
  }, [])

  const logLines = useMemo(
    () =>
      logs.map((l, i) => ({
        id: `${l.ts}-${i}`,
        className: `log-${l.level}`,
        text: `[${new Date(l.ts).toLocaleTimeString()}] ${l.message}`
      })),
    [logs]
  )

  const logCopyText = useMemo(
    () =>
      logs
        .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] [${l.level}] ${l.message}`)
        .join('\n'),
    [logs]
  )

  const refreshImages = async (): Promise<void> => {
    if (!packageServerId) return
    setLoadingImages(true)
    try {
      const list = await window.api.listPackageImages(packageServerId)
      setImages(list)
      setSelected((prev) => {
        const next: Record<string, boolean> = {}
        for (const img of list) next[img.name] = Boolean(prev[img.name])
        return next
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      setImages([])
    } finally {
      setLoadingImages(false)
    }
  }

  const refreshCheck = async (): Promise<void> => {
    if (!deployServerId) return
    setChecking(true)
    try {
      setCheck(await window.api.checkDeployTarget(deployServerId))
    } catch (e) {
      setCheck(null)
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (packageServerId) void refreshImages()
    else {
      setImages([])
      setSelected({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageServerId])

  useEffect(() => {
    if (deployServerId) void refreshCheck()
    else setCheck(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployServerId])

  const selectedNames = images.filter((i) => selected[i.name]).map((i) => i.name)
  const allSelected = images.length > 0 && selectedNames.length === images.length

  const restartPlan = useMemo(() => {
    const wanted = servicesForImageNames(selectedNames)
    const toRestart = filterActiveAppServices(wanted, check?.activeComposeServices)
    const skipped = wanted.filter((s) => !toRestart.includes(s))
    return { wanted, toRestart, skipped }
  }, [selectedNames, check?.activeComposeServices])

  const toggleAll = (value: boolean): void => {
    const next: Record<string, boolean> = {}
    for (const img of images) next[img.name] = value
    setSelected(next)
  }

  const run = async (step: ImageDeployStep): Promise<void> => {
    if (anyRunning) {
      alert('已有任务进行中，请等待完成后再开始')
      return
    }
    if (!deployServerId) {
      alert('请选择部署服务器')
      return
    }
    if (step !== 'apply' && !packageServerId) {
      alert('请选择打包服务器')
      return
    }
    if (selectedNames.length === 0) {
      alert('请至少勾选一个镜像包')
      return
    }
    if (check && !check.ok) {
      alert(`目标部署目录检查未通过，缺少: ${check.missing.join(', ')}`)
      return
    }

    const stepTip =
      step === 'transfer'
        ? '仅上传镜像到目标机（不 load / 不重启）'
        : step === 'apply'
          ? '仅对目标机已有 tar 执行 load + 重启（不重新上传）'
          : '上传镜像并 load + 重启'

    const syncPythonCode = selectedNames.some(
      (n) => /python/i.test(n) || /(^|[-_])all\.tar$/i.test(n)
    )

    const ok = confirm(
      [
        stepTip,
        '',
        `镜像：`,
        selectedNames.join('\n'),
        '',
        check?.summary ? `目标环境：${check.summary}` : '',
        step !== 'transfer' && restartPlan.toRestart.length
          ? `将重启：${restartPlan.toRestart.join(', ')}`
          : '',
        step !== 'transfer' && restartPlan.skipped.length
          ? `将跳过：${restartPlan.skipped.join(', ')}`
          : '',
        syncPythonCode
          ? '含 Python：将同步打包机 data/python/code → 部署机（覆盖挂载代码）'
          : '',
        step !== 'transfer' ? '不会启用 bundled-infra / 不会拉起外置中间件。' : '',
        '',
        '继续？'
      ]
        .filter(Boolean)
        .join('\n')
    )
    if (!ok) return

    setRunning(true)
    setLogs([])
    try {
      const result = await window.api.runImageDeploy({
        packageServerId: packageServerId || deployServerId,
        deployServerId,
        imageNames: selectedNames,
        step
      })
      setLogs((prev) => [
        ...prev,
        {
          level: result.status === 'failed' ? 'error' : 'success',
          message: result.status === 'failed' ? '任务结束：失败（详见上方日志）' : '任务结束：成功',
          ts: new Date().toISOString(),
          channel: 'image-deploy'
        }
      ])
      if (step !== 'transfer') void refreshCheck()
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        {
          level: 'error',
          message: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString(),
          channel: 'image-deploy'
        }
      ])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">服务部署</h1>
      <p className="page-desc">
        从打包服务器 <code>deploy/images</code> 选择镜像 tar。可分开操作：
        <strong>仅上传</strong>、<strong>仅执行</strong>（load + 重启，目标机已有包时不必重传）、或
        <strong>上传并执行</strong>。勾选 Python 时会额外同步{' '}
        <code>data/python/code</code> 挂载目录。中间件若为外置不会被拉起。
      </p>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label>打包服务器（源）</label>
            <select
              value={packageServerId}
              onChange={(e) => setPackageServerId(e.target.value)}
              disabled={running}
            >
              <option value="">请选择</option>
              {packageServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
            {packageServers.length === 0 && (
              <p className="muted" style={{ margin: '6px 0 0' }}>
                暂无打包服务器，请先在「服务器」中新增并选择类型为打包服务器。
              </p>
            )}
          </div>
          <div className="field">
            <label>部署服务器（目标）</label>
            <select
              value={deployServerId}
              onChange={(e) => setDeployServerId(e.target.value)}
              disabled={running}
            >
              <option value="">请选择</option>
              {deployServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
            {deployServers.length === 0 && (
              <p className="muted" style={{ margin: '6px 0 0' }}>
                暂无部署服务器，请先在「服务器」中新增并选择类型为部署服务器。
              </p>
            )}
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 4 }}>
          <button
            className="btn"
            type="button"
            disabled={!deployServerId || checking || running}
            onClick={() => void refreshCheck()}
          >
            {checking ? '分析环境中…' : '检查/分析环境'}
          </button>
        </div>

        {check && (
          <div className={`deploy-check ${check.ok ? 'ok' : 'bad'}`}>
            <div className="deploy-check-main">
              <div>
                目标目录：<code>{check.deployDir}</code> / 镜像目录：<code>{check.imagesDir}</code>
              </div>
              <div className="deploy-check-tags">
                {check.ok ? (
                  <span className="tag ok">部署目录完整</span>
                ) : (
                  <span className="tag err">缺少：{check.missing.join('、')}</span>
                )}
                {check.present.length > 0 && (
                  <span className="muted">已存在：{check.present.join('、')}</span>
                )}
              </div>
              {check.summary && (
                <div className="deploy-env-summary">
                  环境分析：{check.summary}
                  {check.composeProfiles.length > 0 ? (
                    <span className="muted">
                      {' '}
                      · profiles=<code>{check.composeProfiles.join(',')}</code>
                    </span>
                  ) : (
                    <span className="muted"> · 未启用 COMPOSE_PROFILES</span>
                  )}
                </div>
              )}
              {check.services?.length > 0 && (
                <div className="deploy-svc-grid">
                  {check.services.map((svc) => (
                    <div key={svc.name} className="deploy-svc-item" title={svc.detail}>
                      <span className="deploy-svc-name">{svc.name}</span>
                      <span
                        className={`tag ${
                          svc.mode === 'compose' ? 'ok' : svc.mode === 'external' ? 'run' : 'err'
                        }`}
                      >
                        {svc.mode === 'compose'
                          ? 'compose'
                          : svc.mode === 'external'
                            ? '外置'
                            : '未定义'}
                      </span>
                      {/* 外置中间件不在本机 compose 里，探测不到真实状态，勿显示「未运行」误导 */}
                      {svc.mode !== 'external' && (
                        <span className={`tag ${svc.running ? 'ok' : ''}`}>
                          {svc.running ? '运行中' : '未运行'}
                        </span>
                      )}
                      <span className="muted deploy-svc-detail">{svc.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="toolbar" style={{ padding: '12px 14px 0' }}>
          <button
            className="btn"
            type="button"
            disabled={!packageServerId || loadingImages || running}
            onClick={() => void refreshImages()}
          >
            {loadingImages ? '刷新镜像中…' : '刷新镜像列表'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={images.length === 0}
            onClick={() => toggleAll(!allSelected)}
          >
            {allSelected ? '全不选' : '全选'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={running || anyRunning || !packageServerId || !deployServerId}
            onClick={() => void run('transfer')}
            title="只把 tar 传到部署机 images/，不 load、不重启"
          >
            {running ? '执行中…' : '仅上传'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={running || anyRunning || !deployServerId}
            onClick={() => void run('apply')}
            title="对目标机已有 tar 执行 load-images + 重启业务容器"
          >
            {running ? '执行中…' : '仅执行'}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={running || anyRunning || !packageServerId || !deployServerId}
            onClick={() => void run('all')}
          >
            {running ? '部署中…' : '上传并执行'}
          </button>
        </div>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">勾选</th>
                <th>镜像包</th>
                <th style={{ width: 120 }}>大小</th>
                <th style={{ width: 180 }}>修改时间</th>
              </tr>
            </thead>
            <tbody>
              {images.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    {packageServerId
                      ? loadingImages
                        ? '加载中…'
                        : '未找到 *.tar，请确认打包机 deploy/images 目录'
                      : '请先选择打包服务器'}
                  </td>
                </tr>
              ) : (
                images.map((img) => (
                  <tr key={img.name}>
                    <td className="col-check">
                      <label className="check-inline" style={{ justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[img.name])}
                          disabled={running}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [img.name]: e.target.checked }))
                          }
                        />
                      </label>
                    </td>
                    <td>{img.name}</td>
                    <td className="muted">{formatBytes(img.size)}</td>
                    <td className="muted">
                      {img.mtimeMs ? new Date(img.mtimeMs).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <LogViewer
          lines={logLines}
          copyText={logCopyText}
          emptyText="等待任务…"
          running={running}
        />
      </div>
    </div>
  )
}
