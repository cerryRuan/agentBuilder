/** 与 compose 业务服务名对应的应用服务 */
export const APP_COMPOSE_SERVICES = ['frontend', 'java-backend', 'python-agent'] as const

/** 是否为「全量」镜像包（仅匹配独立 all 包名，避免误伤其它文件名） */
function isAllImagePackage(name: string): boolean {
  const base = name.toLowerCase().replace(/\.tar$/i, '')
  // park-ai-all / xxx-all / all
  return /(^|[-_])all$/.test(base) || base === 'all'
}

/** 根据镜像 tar 文件名推断要重启的 compose 业务服务 */
export function servicesForImageNames(names: string[]): string[] {
  const set = new Set<string>()
  for (const name of names) {
    const lower = name.toLowerCase()
    if (isAllImagePackage(name)) {
      return [...APP_COMPOSE_SERVICES]
    }
    if (lower.includes('frontend') || lower.includes('h5')) set.add('frontend')
    if (lower.includes('java')) set.add('java-backend')
    if (lower.includes('python')) set.add('python-agent')
  }
  return Array.from(set)
}

/** 仅保留目标环境当前 compose 已激活的业务服务 */
export function filterActiveAppServices(
  wanted: string[],
  activeComposeServices: string[] | undefined
): string[] {
  if (!activeComposeServices?.length) {
    return wanted.filter((s) =>
      (APP_COMPOSE_SERVICES as readonly string[]).includes(s)
    )
  }
  const active = new Set(activeComposeServices)
  return wanted.filter((s) => active.has(s))
}
