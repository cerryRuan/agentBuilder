import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function credDir(): string {
  const dir = join(app.getPath('userData'), 'credentials')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function credPath(ref: string): string {
  const safe = ref.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(credDir(), `${safe}.bin`)
}

export function setCredential(ref: string, value: string): void {
  if (!value) {
    deleteCredential(ref)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // fallback plaintext only for unsupported platforms (rare)
    writeFileSync(credPath(ref) + '.txt', value, 'utf-8')
    return
  }
  const buf = safeStorage.encryptString(value)
  writeFileSync(credPath(ref), buf)
}

export function getCredential(ref: string): string {
  const enc = credPath(ref)
  const plain = enc + '.txt'
  if (existsSync(enc) && safeStorage.isEncryptionAvailable()) {
    const buf = readFileSync(enc)
    return safeStorage.decryptString(buf)
  }
  if (existsSync(plain)) {
    return readFileSync(plain, 'utf-8')
  }
  return ''
}

export function deleteCredential(ref: string): void {
  const enc = credPath(ref)
  const plain = enc + '.txt'
  if (existsSync(enc)) unlinkSync(enc)
  if (existsSync(plain)) unlinkSync(plain)
}

export function hasCredential(ref: string): boolean {
  return Boolean(getCredential(ref))
}
