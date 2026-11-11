import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Code review R50/R51: hostile files must neither loop forever nor block the event loop. Each case
// runs in a child Node process bounded in time and memory, so that a regression fails this test
// instead of hanging or crashing the whole suite.
const TEXT_DIR = __dirname
const FIXTURES = join(__dirname, '../../../testing/document-fixtures.ts')

function runIsolated(body: string): { ok: boolean; output: unknown; detail: string } {
  const code = `
    const { extractDocumentText } = require(${JSON.stringify(join(TEXT_DIR, 'document-text.ts'))})
    const { paginate } = require(${JSON.stringify(join(TEXT_DIR, 'text-collector.ts'))})
    const { zipOf } = require(${JSON.stringify(FIXTURES)})
    const LIMITS = { maxChars: 100_000, maxPdfPages: 50 }
    const run = async () => { ${body} }
    run().then((r) => console.log(JSON.stringify(r)))
  `
  // No core dump when a regression makes the child run out of memory.
  const child = spawnSync(
    'sh',
    [
      '-c',
      'ulimit -c 0; exec "$0" "$@"',
      process.execPath,
      '--max-old-space-size=128',
      '--require',
      'tsx/cjs',
      '-e',
      code,
    ],
    { cwd: join(__dirname, '../../../..'), encoding: 'utf8', timeout: 20_000 },
  )
  const ok = child.status === 0 && child.stdout.trim() !== ''
  return {
    ok,
    output: ok ? JSON.parse(child.stdout.trim().split('\n').pop()!) : null,
    detail: `status ${child.status}, signal ${child.signal}, ${child.stderr.slice(0, 500)}`,
  }
}

describe('hostile documents (code review R50, R51)', () => {
  it('R50: a sheet name of 20 000 characters is shortened and the text is still split into parts', () => {
    const run = runIsolated(`
      const name = 'N'.repeat(20_050)
      const xlsx = zipOf({
        'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="' + name + '" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row></sheetData></worksheet>',
      })
      const read = await extractDocumentText(
        xlsx,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        LIMITS,
      )
      const parts = paginate(read.units, 20_000)
      return {
        labelLength: read.units[0].label.length,
        parts: parts.length,
        longest: Math.max(...parts.map((p) => p.text.length)),
        hasValue: parts.some((p) => p.text.includes('Value')),
      }
    `)
    expect({ ok: run.ok, detail: run.ok ? '' : run.detail }).toEqual({ ok: true, detail: '' })
    const out = run.output as {
      labelLength: number
      parts: number
      longest: number
      hasValue: boolean
    }
    expect(out.labelLength).toBeLessThanOrEqual(150)
    expect(out).toMatchObject({ parts: 1, hasValue: true })
    expect(out.longest).toBeLessThanOrEqual(20_000)
  })

  it('R50: pagination always progresses, even when a label leaves no room for text', () => {
    const run = runIsolated(`
      const parts = paginate([{ label: 'x'.repeat(30_000), text: 'a'.repeat(50_000) }], 20_000)
      const tiny = paginate([{ label: 'Page 1', text: 'abcdefghij' }], 5)
      return {
        parts: parts.length,
        longest: Math.max(...parts.map((p) => p.text.length)),
        text: parts.map((p) => p.text.replace(/^--- .* ---\\n/, '')).join(''),
        tiny: tiny.map((p) => p.text.replace(/^--- .* ---\\n/, '')).join(''),
      }
    `)
    expect({ ok: run.ok, detail: run.ok ? '' : run.detail }).toEqual({ ok: true, detail: '' })
    const out = run.output as { parts: number; longest: number; text: string; tiny: string }
    expect(out.parts).toBeLessThan(10)
    expect(out.longest).toBeLessThanOrEqual(20_000)
    expect(out.text).toBe('a'.repeat(50_000))
    expect(out.tiny).toBe('abcdefghij')
  })

  it('R51: unterminated tags are rejected at once as a damaged document', () => {
    const run = runIsolated(`
      const docx = zipOf({
        'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Début</w:t></w:r></w:p>' + '<a'.repeat(100_000),
      })
      const started = Date.now()
      const read = await extractDocumentText(
        docx,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        LIMITS,
      )
      return { read, ms: Date.now() - started }
    `)
    expect({ ok: run.ok, detail: run.ok ? '' : run.detail }).toEqual({ ok: true, detail: '' })
    const out = run.output as { read: unknown; ms: number }
    expect(out.read).toEqual({ readable: false, reason: expect.stringContaining('illisible') })
    expect(out.ms).toBeLessThan(1_000)
  })

  it('R51: reading Office markup stops at its time limit instead of holding the server', () => {
    const run = runIsolated(`
      const docx = zipOf({
        'word/document.xml': '<w:document><w:body>' + '<w:p><w:r><w:t>x</w:t></w:r></w:p>'.repeat(200_000) + '</w:body></w:document>',
      })
      const started = Date.now()
      const read = await extractDocumentText(
        docx,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        { ...LIMITS, officeTimeLimitMs: 0 },
      )
      return { read, ms: Date.now() - started }
    `)
    expect({ ok: run.ok, detail: run.ok ? '' : run.detail }).toEqual({ ok: true, detail: '' })
    const out = run.output as { read: unknown; ms: number }
    expect(out.read).toEqual({
      readable: false,
      reason: expect.stringContaining('Lecture interrompue'),
    })
    expect(out.ms).toBeLessThan(1_000)
  })
})
