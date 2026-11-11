// Reads the text layer of a PDF, page by page, in a worker thread started by pdf-text.ts: an
// untrusted file is parsed with bounded memory and time, away from the API's event loop. Plain
// JavaScript module because PDF.js is only published as an ES module.
import { parentPort, workerData } from 'node:worker_threads'
import { getDocumentProxy } from 'unpdf'

const { data, maxPages, maxChars } = workerData

try {
  const pdf = await getDocumentProxy(new Uint8Array(data), {
    // No code generated from the file's fonts, no system fonts, no font loading: text only.
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const pages = []
  let chars = 0
  const last = Math.min(pdf.numPages, maxPages)
  for (let n = 1; n <= last && chars < maxChars; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      text += item.str
      if (item.hasEOL) text += '\n'
    }
    pages.push(text)
    chars += text.length
    page.cleanup()
  }
  parentPort.postMessage({ ok: true, numPages: pdf.numPages, pages })
  await pdf.destroy()
} catch (err) {
  parentPort.postMessage({
    ok: false,
    error: err && err.name === 'PasswordException' ? 'password' : 'invalid',
  })
}
