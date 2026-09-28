import type { AgentBuilderApi } from './index'

declare global {
  interface Window {
    api: AgentBuilderApi
  }
}

export {}
