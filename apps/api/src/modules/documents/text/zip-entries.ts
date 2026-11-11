import { inflateRawSync } from 'node:zlib'

// Minimal reader for the zip containers of Office Open XML and OpenDocument files: the few entries
// holding the text are read, nothing else. Every size is bounded (a declared size can lie: the
// inflated output itself is capped), so a crafted archive cannot exhaust the API's memory.

export class ZipFormatError extends Error {}

export interface ZipEntry {
  name: string
  method: number
  flags: number
  compressedSize: number
  localHeaderOffset: number
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const MAX_ENTRIES = 10_000

export function listZipEntries(zip: Buffer): Map<string, ZipEntry> {
  const end = findEndOfCentralDirectory(zip)
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  if (count > MAX_ENTRIES) throw new ZipFormatError('too many entries')
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new ZipFormatError('bad central directory')
    }
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, {
      name,
      flags: zip.readUInt16LE(offset + 8),
      method: zip.readUInt16LE(offset + 10),
      compressedSize: zip.readUInt32LE(offset + 20),
      localHeaderOffset: zip.readUInt32LE(offset + 42),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

// The entry's content, at most `maxBytes` once inflated.
export function readZipEntry(zip: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  if (entry.flags & 0x1) throw new ZipFormatError('encrypted entry')
  const at = entry.localHeaderOffset
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== LOCAL_FILE_HEADER) {
    throw new ZipFormatError('bad local header')
  }
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28)
  const data = zip.subarray(start, start + entry.compressedSize)
  if (data.length !== entry.compressedSize) throw new ZipFormatError('truncated entry')
  if (entry.method === 0) {
    if (data.length > maxBytes) throw new ZipFormatError('entry too large')
    return data
  }
  if (entry.method !== 8) throw new ZipFormatError('unsupported compression')
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes })
  } catch {
    throw new ZipFormatError('entry too large or damaged')
  }
}

function findEndOfCentralDirectory(zip: Buffer): number {
  // The record is 22 bytes, followed by a comment of at most 65 535 bytes.
  const lowest = Math.max(0, zip.length - 22 - 0xffff)
  for (let i = zip.length - 22; i >= lowest; i--) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i
  }
  throw new ZipFormatError('not a zip archive')
}
