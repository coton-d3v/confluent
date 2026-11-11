import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

export type PdfText =
  | { ok: true; numPages: number; pages: string[] }
  | { ok: false; error: 'password' | 'invalid' | 'timeout' | 'busy' }

export interface PdfLimits {
  maxPages: number
  maxChars: number
}

// A PDF is parsed in its own worker thread (pdf-text.worker.mjs), killed when it takes too long or
// exceeds its memory: a crafted file cannot block or exhaust the API.
const TIMEOUT_MS = 30_000
const MEMORY_LIMIT_MB = 256
// Readings at once; a few more wait for a free worker, beyond that the reading is refused.
const MAX_RUNNING = 2
const MAX_WAITING = 8

const WORKER_FILE = join(__dirname, 'pdf-text.worker.mjs')

let running = 0
const waiting: Array<() => void> = []

export async function extractPdfText(buffer: Buffer, limits: PdfLimits): Promise<PdfText> {
  if (running < MAX_RUNNING) running++
  else if (waiting.length >= MAX_WAITING) return { ok: false, error: 'busy' }
  // A waiting reading takes over the slot of the one that ends.
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await runWorker(buffer, limits)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

function runWorker(buffer: Buffer, limits: PdfLimits): Promise<PdfText> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: { data: new Uint8Array(buffer), ...limits },
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_LIMIT_MB },
      stdout: true,
      stderr: true,
    })
    // PDF.js warnings about the file are not the API's logs.
    worker.stdout.resume()
    worker.stderr.resume()
    let settled = false
    const settle = (result: PdfText) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
      void worker.terminate()
    }
    const timer = setTimeout(() => settle({ ok: false, error: 'timeout' }), TIMEOUT_MS)
    worker.once('message', (result: PdfText) => settle(result))
    // Out of memory, crash, or exit without an answer.
    worker.once('error', () => settle({ ok: false, error: 'invalid' }))
    worker.once('exit', () => settle({ ok: false, error: 'invalid' }))
  })
}
