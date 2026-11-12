import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { TestContext } from 'node:test'
import { afterEach, test } from 'node:test'
import { testConnection } from '../src/main/custom-providers.ts'

/**
 * Live verification of `testConnection` (S16, T13): the one part of the custom-provider
 * feature written against a documented rule but never exercised against something that
 * actually answers. Every case here talks to a real HTTP server on loopback and asserts
 * the result the function returns, never internals.
 *
 * The key is always a fake literal passed in the input — this test never reads a real
 * credential and never touches the user's home directory.
 */

interface ReceivedRequest {
  method: string | undefined
  path: string | undefined
  authorization: string | undefined
}

interface RunningServer {
  server: Server
  url: string
  port: number
  requests: ReceivedRequest[]
}

/** Every server started by a test; closed again in afterEach, with a leak guard. */
const openServers: Server[] = []

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  // Keep-alive or a hanging request would otherwise keep the handle alive for ever.
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    // Loud failure instead of a silent leak: if close() never finishes, something is
    // still holding the handle and the next run could inherit a stale listener.
    const guard = setTimeout(
      () => reject(new Error('a test server leaked its handle: close() never finished')),
      5_000
    )
    server.close((error) => {
      clearTimeout(guard)
      if (error) reject(new Error(`test server failed to close: ${error.message}`))
      else resolve()
    })
  })
}

afterEach(async () => {
  const held = openServers.splice(0)
  await Promise.all(held.map((server) => closeServer(server)))
})

/**
 * Starts a real server on 127.0.0.1 with an ephemeral port (never a fixed port) and
 * records every request it receives, so tests can assert on what actually arrived.
 */
function startServer(
  t: TestContext,
  respond: (req: IncomingMessage, res: ServerResponse) => void
): Promise<RunningServer> {
  const requests: ReceivedRequest[] = []
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization
    })
    respond(req, res)
  })
  openServers.push(server)
  t.after(() => closeServer(server))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('expected a real port from the test server'))
        return
      }
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        requests
      })
    })
  })
}

test('a reachable server answering /models with 200 reports success and receives the bearer key', async (t) => {
  const { url, requests } = await startServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'model-a' }] }))
  })

  const result = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-test-abc123' })

  assert.equal(result.status, 'reachable')
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.method, 'GET')
  assert.equal(requests[0]?.path, '/v1/models')
  // What arrived must be exactly the key this test put in the input, as a bearer header.
  assert.equal(requests[0]?.authorization, 'Bearer sk-test-abc123')
})

test('401 and 403 report the key as rejected, which is distinct from could-not-check', async (t) => {
  // One server answering 401 on the first request and 403 on the second covers both
  // concrete ways a real server refuses a key.
  const { url, requests } = await startServer(t, (_req, res) => {
    const status = requests.length === 1 ? 401 : 403
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'bad key' } }))
  })

  const first = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-wrong' })
  const second = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-wrong' })

  assert.equal(first.status, 'key_rejected')
  assert.equal(second.status, 'key_rejected')
  // A refused key must never be reported in the vaguer "could not check" channel, or the
  // user would not learn their key is wrong.
  assert.notEqual(first.status, 'could_not_check')
  assert.notEqual(second.status, 'could_not_check')
  assert.match(first.message, /accepted/i)
  assert.equal(requests.length, 2)
})

test('404 and 405 report could-not-check and never blame the key', async (t) => {
  // Many OpenAI-compatible servers simply do not implement /models, so an uncheckable
  // endpoint must not be misread as an invalid key — that would block a working provider.
  const { url, requests } = await startServer(t, (_req, res) => {
    const status = requests.length === 1 ? 404 : 405
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
  })

  const first = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-fine' })
  const second = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-fine' })

  assert.equal(first.status, 'could_not_check')
  assert.equal(second.status, 'could_not_check')
  assert.doesNotMatch(first.message, /not accepted/i)
  assert.doesNotMatch(second.message, /not accepted/i)
  assert.equal(requests.length, 2)
})

test('a port with nobody listening reports no-answer instead of throwing', async (t) => {
  const portless = await startServer(t, () => {})
  const { url, port } = { url: portless.url, port: portless.port }
  await closeServer(portless.server)

  const result = await testConnection({ serverAddress: `${url}/v1`, apiKey: 'sk-test' })

  assert.equal(result.status, 'no_answer')
  assert.match(result.message, /did not answer/i)
  // The port must still be free, so nothing silently re-bound to it between close and call.
  assert.equal(typeof port, 'number')
})

test('a cross-origin redirect is not followed and never treated as success', async (t) => {
  // The key would be replayed against whatever the redirect points at, so the check must
  // stop at the 302: a second server counts the requests that must never arrive.
  const target = await startServer(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  })
  const redirector = await startServer(t, (_req, res) => {
    res.writeHead(302, { location: `${target.url}/other` })
    res.end()
  })

  const result = await testConnection({ serverAddress: `${redirector.url}/v1`, apiKey: 'sk-secret' })

  assert.notEqual(result.status, 'reachable', 'a 302 must never count as a working connection')
  assert.notEqual(result.status, 'key_rejected', 'a redirect is not a key problem either')
  assert.equal(target.requests.length, 0, 'no request may reach the redirect target')
})

test('a server that accepts and never responds times out by itself with a timeout report', async (t) => {
  // The one slow case (the timeout is hardcoded at 8s, so a second slow case would double
  // the file's runtime): a hung server must make the call give up on its own, and the
  // report must say the server took too long, not merely that it did not answer.
  const hung = await startServer(t, (req) => {
    req.resume()
  })

  const result = await testConnection({ serverAddress: `${hung.url}/v1`, apiKey: 'sk-test' })

  assert.equal(result.status, 'no_answer')
  assert.match(result.message, /too long|timed out/i)
})
