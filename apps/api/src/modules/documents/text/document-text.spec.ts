import { docxWith, escapeXml, pdfWithPages, zipOf } from '../../../testing/document-fixtures'
import { LEGACY_OFFICE, OOXML_AND_ODF, RECOGNISED_TYPES } from '../document-types'
import { extractDocumentText, readingOf, type ExtractedText } from './document-text'
import { paginate } from './text-collector'

const LIMITS = { maxChars: 100_000, maxPdfPages: 50 }

function texts(result: ExtractedText) {
  if (!result.readable) throw new Error(`not readable: ${result.reason}`)
  return result.units.map((u) => [u.label, u.text])
}

describe('readingOf', () => {
  it('classifies every accepted format explicitly: readable, OCR unavailable or old Office format', () => {
    for (const type of RECOGNISED_TYPES) {
      const reading = readingOf(type)
      if (!reading.readable) expect(reading.reason).not.toMatch(/^Format dont/)
    }
    expect(readingOf('image/png')).toEqual({
      readable: false,
      reason: expect.stringContaining('OCR'),
    })
    expect(readingOf(LEGACY_OFFICE.doc)).toEqual({
      readable: false,
      reason: expect.stringContaining('Ancien format'),
    })
    expect(readingOf('application/pdf')).toMatchObject({ readable: true, note: /scanné/ })
    expect(readingOf(OOXML_AND_ODF.xlsx)).toEqual({ readable: true })
  })

  it('does not read an unknown type (closed by default)', () => {
    expect(readingOf('application/x-unknown')).toEqual({
      readable: false,
      reason: expect.any(String),
    })
  })
})

describe('extractDocumentText', () => {
  it('reads plain text and a CSV exported in Windows-1252', async () => {
    const txt = await extractDocumentText(
      Buffer.from('\uFEFFChiffre d’affaires\r\n2025 : 1,2 M€'),
      'text/plain',
      LIMITS,
    )
    expect(texts(txt)).toEqual([[null, 'Chiffre d’affaires\n2025 : 1,2 M€']])
    const csv = await extractDocumentText(
      Buffer.from('Année;Coût\n2026;12 000\n', 'latin1'),
      'text/csv',
      LIMITS,
    )
    expect(texts(csv)).toEqual([[null, 'Année;Coût\n2026;12 000']])
  })

  it('reads the text runs of a Word document, never field codes, deleted text or tab stops', async () => {
    const xml =
      '<w:document xmlns:w="w"><w:body>' +
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
      '<w:r><w:t>Effectif</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">12 &amp; 3</w:t></w:r>' +
      '<w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r><w:del><w:r><w:delText>supprimé</w:delText></w:r></w:del></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Poste</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Montant</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>R&amp;D</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40 000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '</w:body></w:document>'
    const result = await extractDocumentText(
      zipOf({ 'word/document.xml': xml }),
      OOXML_AND_ODF.docx,
      LIMITS,
    )
    expect(texts(result)).toEqual([[null, 'Effectif\t12 & 3\nPoste\tMontant\nR&D\t40 000']])
  })

  it('reads every sheet of a workbook in its order, cells at their column', async () => {
    const workbook = zipOf({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="2" r:id="rId2"/><sheet name="Équipe" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Poste</t></si><si><r><t>Mon</t></r><r><t>tant</t></r><rPh><t>ignored</t></rPh></si><si><t>Ingénieure</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Salaires</t></is></c><c r="C2"><f>SUM(X1:X9)</f><v>48000.5</v></c></row>' +
        '<row r="3"><c r="A3"/></row></sheetData></worksheet>',
    })
    const result = await extractDocumentText(workbook, OOXML_AND_ODF.xlsx, LIMITS)
    expect(texts(result)).toEqual([
      ['Feuille « Budget »', 'Poste\t\tMontant\nSalaires\t\t48000.5'],
      ['Feuille « Équipe »', 'Ingénieure\tVRAI'],
    ])
  })

  it('reads the slides of a presentation in their numeric order', async () => {
    const slide = (text: string) =>
      `<p:sld xmlns:a="a" xmlns:p="p"><p:txBody><a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r><a:br/><a:r><a:t>suite</a:t></a:r></a:p></p:txBody></p:sld>`
    const deck = zipOf({
      'ppt/slides/slide10.xml': slide('Dix'),
      'ppt/slides/slide2.xml': slide('Deux'),
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships/>',
    })
    const result = await extractDocumentText(deck, OOXML_AND_ODF.pptx, LIMITS)
    expect(texts(result)).toEqual([
      ['Diapositive 1', 'Deux\nsuite'],
      ['Diapositive 2', 'Dix\nsuite'],
    ])
  })

  it('reads OpenDocument text, spreadsheets and presentations, without tracked deletions or comments', async () => {
    const content = (body: string) =>
      zipOf({
        'content.xml': `<office:document-content><office:body>${body}</office:body></office:document-content>`,
      })
    const odt = await extractDocumentText(
      content(
        '<office:text><text:tracked-changes><text:changed-region><text:p>effacé</text:p></text:changed-region></text:tracked-changes>' +
          '<text:h>Marché</text:h><text:p>TAM<text:s text:c="2"/>:<text:tab/>3 Md€<office:annotation><text:p>note</text:p></office:annotation></text:p></office:text>',
      ),
      OOXML_AND_ODF.odt,
      LIMITS,
    )
    expect(texts(odt)).toEqual([[null, 'Marché\nTAM  :\t3 Md€']])
    const ods = await extractDocumentText(
      content(
        '<office:spreadsheet><table:table table:name="Prévisionnel"><table:table-row><table:table-cell><text:p>CA</text:p></table:table-cell>' +
          '<table:table-cell table:number-columns-repeated="3"/><table:table-cell><text:p>1 200</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
      ),
      OOXML_AND_ODF.ods,
      LIMITS,
    )
    expect(texts(ods)).toEqual([['Feuille « Prévisionnel »', 'CA\t\t1 200']])
    const odp = await extractDocumentText(
      content(
        '<office:presentation><draw:page><draw:frame><text:p>Équipe</text:p></draw:frame><presentation:notes><text:p>notes</text:p></presentation:notes></draw:page>' +
          '<draw:page><text:p>Marché</text:p></draw:page></office:presentation>',
      ),
      OOXML_AND_ODF.odp,
      LIMITS,
    )
    expect(texts(odp)).toEqual([
      ['Diapositive 1', 'Équipe'],
      ['Diapositive 2', 'Marché'],
    ])
  })

  it('reads the text layer of a PDF page by page and points out pages without text', async () => {
    const pdf = pdfWithPages([
      'Kbis de BIOSENSIO SAS\nSIREN 912 345 678',
      '',
      'Capital social : 10 000 EUR',
    ])
    const result = await extractDocumentText(pdf, 'application/pdf', LIMITS)
    expect(result).toMatchObject({ readable: true, truncated: false, unitsWithoutText: ['Page 2'] })
    const pages = texts(result)
    expect(pages.map(([label]) => label)).toEqual(['Page 1', 'Page 2', 'Page 3'])
    expect(pages[0][1]).toContain('Kbis de BIOSENSIO SAS')
    expect(pages[0][1]).toContain('SIREN 912 345 678')
    expect(pages[1][1]).toContain('OCR non disponible')
    expect(pages[2][1]).toContain('Capital social : 10 000 EUR')
  })

  it('reports a PDF without any text layer (a scan) as needing OCR, which is not available', async () => {
    const result = await extractDocumentText(pdfWithPages(['', '']), 'application/pdf', LIMITS)
    expect(result).toEqual({ readable: false, reason: expect.stringContaining('OCR') })
  })

  it('stops at the page limit and says the text is truncated', async () => {
    const result = await extractDocumentText(
      pdfWithPages(['Un', 'Deux', 'Trois'].map((w) => `Page ${w} du document`)),
      'application/pdf',
      { maxChars: 100_000, maxPdfPages: 2 },
    )
    expect(result).toMatchObject({ readable: true, truncated: true })
    expect(texts(result)).toHaveLength(2)
  })

  it('reports damaged files, images and old Office formats as unreadable instead of failing', async () => {
    const pdf = await extractDocumentText(
      Buffer.from('%PDF-1.4\ngarbage'),
      'application/pdf',
      LIMITS,
    )
    expect(pdf).toEqual({ readable: false, reason: expect.stringContaining('illisible') })
    const docx = await extractDocumentText(
      Buffer.from('PK\x03\x04 not a zip'),
      OOXML_AND_ODF.docx,
      LIMITS,
    )
    expect(docx).toEqual({ readable: false, reason: expect.stringContaining('illisible') })
    const image = await extractDocumentText(Buffer.from('x'), 'image/jpeg', LIMITS)
    expect(image).toEqual({ readable: false, reason: expect.stringContaining('OCR') })
    const doc = await extractDocumentText(Buffer.from('x'), LEGACY_OFFICE.doc, LIMITS)
    expect(doc).toEqual({ readable: false, reason: expect.stringContaining('Ancien format') })
  })

  it('refuses to inflate a part beyond its limit (zip bomb)', async () => {
    const bomb = zipOf({ 'word/document.xml': Buffer.alloc(41 * 1024 * 1024, 0x20) })
    expect(bomb.length).toBeLessThan(200_000)
    const result = await extractDocumentText(bomb, OOXML_AND_ODF.docx, LIMITS)
    expect(result).toEqual({ readable: false, reason: expect.stringContaining('illisible') })
  })

  it('keeps at most maxChars characters and marks the text truncated', async () => {
    const result = await extractDocumentText(
      docxWith(['a'.repeat(50), 'b'.repeat(50)]),
      OOXML_AND_ODF.docx,
      {
        ...LIMITS,
        maxChars: 60,
      },
    )
    expect(result).toMatchObject({ readable: true, truncated: true })
    expect(texts(result)[0][1]).toBe(`${'a'.repeat(50)}\n${'b'.repeat(9)}`)
  })
})

describe('paginate', () => {
  it('keeps units whole when they fit, and splits a longer unit at line breaks with its label', () => {
    const parts = paginate(
      [
        { label: 'Page 1', text: 'court' },
        { label: 'Page 2', text: 'aussi court' },
        { label: 'Page 3', text: Array.from({ length: 10 }, (_, i) => `ligne ${i}`).join('\n') },
      ],
      60,
    )
    expect(parts[0]).toEqual({
      text: '--- Page 1 ---\ncourt\n\n--- Page 2 ---\naussi court',
      from: 'Page 1',
      to: 'Page 2',
    })
    expect(parts.slice(1).every((p) => p.from === 'Page 3' && p.text.length <= 60)).toBe(true)
    expect(parts[2].text).toMatch(/^--- Page 3 \(suite\) ---\n/)
    expect(
      parts
        .slice(1)
        .map((p) => p.text.replace(/^--- .*---\n/, ''))
        .join('\n'),
    ).toBe(Array.from({ length: 10 }, (_, i) => `ligne ${i}`).join('\n'))
  })

  it('returns a plain text without labels', () => {
    expect(paginate([{ label: null, text: 'abc' }], 100)).toEqual([
      { text: 'abc', from: null, to: null },
    ])
  })
})
