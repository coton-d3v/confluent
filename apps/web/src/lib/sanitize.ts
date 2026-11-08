// Removes invisible and control characters; `multiline` keeps line breaks (long text answers).
export function stripNonPrintable(value: string, { multiline = false } = {}): string {
  const text = multiline ? value.replace(/\r\n?/g, '\n') : value
  return text.replace(
    multiline
      ? // eslint-disable-next-line no-control-regex -- stripping C0 controls is the intent
        /[\u0000-\u0009\u000B-\u001F\u007F\u00AD\u200B-\u200D\u2066-\u2069\u202A-\u202E\uFEFF]/g
      : // eslint-disable-next-line no-control-regex -- stripping C0 controls is the intent
        /[\u0000-\u001F\u007F\u00AD\u200B-\u200D\u2066-\u2069\u202A-\u202E\uFEFF]/g,
    '',
  )
}
