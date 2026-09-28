import { Client, ConnectConfig } from 'ssh2'
import { ServerConfig } from '../shared/types'
import { getCredential } from './credentials'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function buildConnectConfig(server: ServerConfig): ConnectConfig {
  const secret = getCredential(server.credentialRef)
  if (!secret) {
    throw new Error(`服务器「${server.name}」未配置凭证，请先在服务器管理中填写密码或私钥`)
  }

  const base: ConnectConfig = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: 15000,
    // allow first connect; Electron desktop tool for intranet
    hostVerifier: () => true
  }

  if (server.authType === 'privateKey') {
    return { ...base, privateKey: secret }
  }
  return { ...base, password: secret }
}

export function withSsh<T>(
  server: ServerConfig,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client
      .on('ready', () => {
        fn(client)
          .then((result) => {
            client.end()
            resolve(result)
          })
          .catch((err) => {
            client.end()
            reject(err)
          })
      })
      .on('error', (err) => reject(err))
      .connect(buildConnectConfig(server))
  })
}

export function execCommand(client: Client, command: string): Promise<ExecResult> {
  return execCommandStreaming(client, command)
}

export function execCommandStreaming(
  client: Client,
  command: string,
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      stream
        .on('close', (code: number) => {
          resolve({ code: code ?? 0, stdout, stderr })
        })
        .on('data', (data: Buffer) => {
          const text = data.toString()
          stdout += text
          onChunk?.(text, 'stdout')
        })
      stream.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderr += text
        onChunk?.(text, 'stderr')
      })
    })
  })
}

export async function testSshConnection(server: ServerConfig): Promise<string> {
  return withSsh(server, async (client) => {
    const result = await execCommand(client, 'echo ok && uname -a && pwd')
    if (result.code !== 0) {
      throw new Error(result.stderr || `exit ${result.code}`)
    }
    return result.stdout.trim()
  })
}

/** Escape for single-quoted remote shell string */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}
