import { createContext, useContext, useEffect, useMemo, useState } from 'react'

interface TaskSessionState {
  publishRunning: boolean
  deployRunning: boolean
  setPublishRunning: (v: boolean) => void
  setDeployRunning: (v: boolean) => void
  anyRunning: boolean
}

const TaskSessionContext = createContext<TaskSessionState | null>(null)

export function TaskSessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [publishRunning, setPublishRunning] = useState(false)
  const [deployRunning, setDeployRunning] = useState(false)

  const value = useMemo(
    () => ({
      publishRunning,
      deployRunning,
      setPublishRunning,
      setDeployRunning,
      anyRunning: publishRunning || deployRunning
    }),
    [publishRunning, deployRunning]
  )

  return <TaskSessionContext.Provider value={value}>{children}</TaskSessionContext.Provider>
}

export function useTaskSession(): TaskSessionState {
  const ctx = useContext(TaskSessionContext)
  if (!ctx) throw new Error('useTaskSession must be used within TaskSessionProvider')
  return ctx
}

/** 把页面 running 同步到侧栏角标；页面常驻挂载时不要在 cleanup 里清掉 */
export function useReportRunning(kind: 'publish' | 'deploy', running: boolean): void {
  const session = useContext(TaskSessionContext)
  const setPublish = session?.setPublishRunning
  const setDeploy = session?.setDeployRunning
  useEffect(() => {
    if (kind === 'publish') setPublish?.(running)
    else setDeploy?.(running)
  }, [kind, running, setPublish, setDeploy])
}
