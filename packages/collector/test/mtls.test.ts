import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpServer, sendJson, type RouteHandler } from '../src/server'
import type { Server } from 'node:http'

let workDir: string

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function generateCa(name: string): { keyPath: string; certPath: string } {
  const keyPath = join(workDir, `${name}.key`)
  const certPath = join(workDir, `${name}.crt`)
  execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'pipe' })
  execFileSync(
    'openssl',
    ['req', '-x509', '-new', '-nodes', '-key', keyPath, '-sha256', '-days', '2', '-out', certPath, '-subj', `/CN=${name}`],
    { stdio: 'pipe' }
  )
  return { keyPath, certPath }
}

function generateSignedCert(
  name: string,
  ca: { keyPath: string; certPath: string },
  subjectCn: string,
  subjectAltName?: string
): { keyPath: string; certPath: string } {
  const keyPath = join(workDir, `${name}.key`)
  const csrPath = join(workDir, `${name}.csr`)
  const certPath = join(workDir, `${name}.crt`)
  execFileSync('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'pipe' })
  execFileSync('openssl', ['req', '-new', '-key', keyPath, '-out', csrPath, '-subj', `/CN=${subjectCn}`], { stdio: 'pipe' })
  const args = [
    'x509', '-req', '-in', csrPath, '-CA', ca.certPath, '-CAkey', ca.keyPath, '-CAcreateserial',
    '-out', certPath, '-days', '2', '-sha256'
  ]
  if (subjectAltName !== undefined) {
    const extfilePath = join(workDir, `${name}.ext`)
    execFileSync('sh', ['-c', `printf "subjectAltName=${subjectAltName}" > ${extfilePath}`], { stdio: 'pipe' })
    args.push('-extfile', extfilePath)
  }
  execFileSync('openssl', args, { stdio: 'pipe' })
  return { keyPath, certPath }
}

const hasOpenssl = opensslAvailable()
const describeIfOpenssl = hasOpenssl ? describe : describe.skip

describeIfOpenssl('mTLS handshake', () => {
  let server: Server
  let port: number
  let trustedCaCertPath: string
  let validClientCertPath: string
  let validClientKeyPath: string
  let wrongCaClientCertPath: string
  let wrongCaClientKeyPath: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'apiscope-mtls-'))
    const trustedCa = generateCa('trusted-ca')
    const wrongCa = generateCa('wrong-ca')
    const serverCert = generateSignedCert('server', trustedCa, '127.0.0.1', 'IP:127.0.0.1')
    const validClientCert = generateSignedCert('valid-client', trustedCa, 'valid-client')
    const wrongCaClientCert = generateSignedCert('wrong-ca-client', wrongCa, 'wrong-ca-client')
    trustedCaCertPath = trustedCa.certPath
    validClientCertPath = validClientCert.certPath
    validClientKeyPath = validClientCert.keyPath
    wrongCaClientCertPath = wrongCaClientCert.certPath
    wrongCaClientKeyPath = wrongCaClientCert.keyPath

    const routes = new Map<string, RouteHandler>([['GET /health', (_request, response) => sendJson(response, 200, { status: 'ok' })]])
    server = createHttpServer(routes, [], {
      key: readFileSync(serverCert.keyPath, 'utf8'),
      cert: readFileSync(serverCert.certPath, 'utf8'),
      ca: readFileSync(trustedCa.certPath, 'utf8'),
      requestCert: true
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    port = address.port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(workDir, { recursive: true, force: true })
  })

  function attempt(clientCertPath?: string, clientKeyPath?: string): Promise<'accepted' | 'rejected'> {
    return new Promise((resolve) => {
      const request = httpsRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/health',
          method: 'GET',
          ca: readFileSync(trustedCaCertPath, 'utf8'),
          ...(clientCertPath === undefined ? {} : { cert: readFileSync(clientCertPath, 'utf8') }),
          ...(clientKeyPath === undefined ? {} : { key: readFileSync(clientKeyPath, 'utf8') })
        },
        (response) => {
          response.on('data', () => {})
          response.on('end', () => resolve(response.statusCode === 200 ? 'accepted' : 'rejected'))
        }
      )
      request.once('error', () => resolve('rejected'))
      request.end()
    })
  }

  it('rejects a client presenting no certificate', async () => {
    expect(await attempt()).toBe('rejected')
  })

  it('rejects a client certificate signed by an untrusted CA', async () => {
    expect(await attempt(wrongCaClientCertPath, wrongCaClientKeyPath)).toBe('rejected')
  })

  it('accepts a client certificate signed by the trusted CA', async () => {
    expect(await attempt(validClientCertPath, validClientKeyPath)).toBe('accepted')
  })
})
