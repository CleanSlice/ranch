import { describe, expect, test } from 'bun:test'
import {
  CitedSourceError,
  CitedSourceErrorCodes,
  describeCitedSourceError,
  filenameFromDisposition,
  isInlineViewable,
} from './citedSourceFile'

describe('filenameFromDisposition', () => {
  test('quoted filename', () => {
    expect(filenameFromDisposition('inline; filename="Handbook 2026.pdf"')).toBe('Handbook 2026.pdf')
  })

  test('bare filename', () => {
    expect(filenameFromDisposition('attachment; filename=notes.txt')).toBe('notes.txt')
  })

  test('RFC 5987 form wins over the plain one', () => {
    expect(
      filenameFromDisposition(
        "inline; filename=\"fallback.pdf\"; filename*=UTF-8''%D0%9F%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%B0.pdf",
      ),
    ).toBe('Правила.pdf')
  })

  test('escaped quotes inside the quoted form', () => {
    expect(filenameFromDisposition('inline; filename="a \\"b\\" c.md"')).toBe('a "b" c.md')
  })

  test('nothing named', () => {
    expect(filenameFromDisposition('inline')).toBe(null)
    expect(filenameFromDisposition(null)).toBe(null)
    expect(filenameFromDisposition('')).toBe(null)
  })
})

describe('isInlineViewable', () => {
  test('pdf, images and text open in a tab', () => {
    expect(isInlineViewable('application/pdf')).toBe(true)
    expect(isInlineViewable('image/png')).toBe(true)
    expect(isInlineViewable('text/markdown; charset=utf-8')).toBe(true)
    expect(isInlineViewable('TEXT/PLAIN')).toBe(true)
  })

  test('everything else is a download', () => {
    expect(isInlineViewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
    expect(isInlineViewable('application/octet-stream')).toBe(false)
    expect(isInlineViewable('')).toBe(false)
    expect(isInlineViewable(null)).toBe(false)
  })
})

describe('describeCitedSourceError', () => {
  test('one line per code, server text never shown', () => {
    expect(describeCitedSourceError(new CitedSourceError(CitedSourceErrorCodes.SourceGone, 410))).toBe(
      'this document is no longer in the knowledge base',
    )
    expect(describeCitedSourceError(new CitedSourceError(CitedSourceErrorCodes.ReaderAccessClosed, 403))).toBe(
      'this knowledge base does not allow opening documents',
    )
    expect(describeCitedSourceError(new CitedSourceError(CitedSourceErrorCodes.NotFound, 404))).toBe(
      'the source was not found',
    )
    expect(describeCitedSourceError(new CitedSourceError(CitedSourceErrorCodes.Offline, null))).toBe(
      'the server could not be reached',
    )
    expect(describeCitedSourceError(new Error('boom'))).toBe('the server rejected the request')
  })
})
