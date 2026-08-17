import { YoutubeTranscript } from 'youtube-transcript'

const MAX_SENTENCE = 110

export function getVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be' || u.hostname === 'www.youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] || ''
    }
    return u.searchParams.get('v') || ''
  } catch {
    return ''
  }
}

function cleanRow(text) {
  return text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/>>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTs(val) {
  // youtube-transcript srv3 format returns milliseconds, classic returns seconds.
  // Typical caption duration is 1-10s; anything > 100 is clearly ms.
  return val > 100 ? val / 1000 : val
}

function flushBuffer(buffer, sentences) {
  if (!buffer.length) return
  const text = buffer.map((b) => b.text).join(' ').trim()
  if (text) {
    sentences.push({
      id: sentences.length + 1,
      text,
      start: Math.round(buffer[0].start * 100) / 100,
      duration: Math.round(Math.max(0, buffer[buffer.length - 1].end - buffer[0].start) * 100) / 100,
    })
  }
  buffer.length = 0
}

function splitRowByPunct(text, rowStart, rowDuration) {
  // Find all sentence boundary positions (end of punctuation)
  const boundaries = []
  const re = /[.!?]["']?/g
  let m
  while ((m = re.exec(text))) {
    boundaries.push(m.index + m[0].length)
  }
  if (!boundaries.length) return [{ text: text.trim(), start: rowStart }]

  const parts = []
  let prev = 0
  for (let i = 0; i < boundaries.length; i++) {
    const seg = text.slice(prev, boundaries[i]).trim()
    if (seg) {
      const ratio = prev / text.length
      parts.push({ text: seg, start: rowStart + rowDuration * ratio })
    }
    prev = boundaries[i]
  }
  const tail = text.slice(prev).trim()
  if (tail) {
    const ratio = prev / text.length
    parts.push({ text: tail, start: rowStart + rowDuration * ratio })
  }
  return parts
}

export async function getTranscript(url) {
  const videoId = getVideoId(url)
  if (!videoId) throw new Error('Paste a valid YouTube URL to begin.')

  let rows
  try {
    rows = await YoutubeTranscript.fetchTranscript(videoId)
  } catch {
    throw new Error('No captions found for this video. Please try a video with CC.')
  }

  // YouTube transcript rows have overlapping timestamps.
  // Use start time of next row as end time of current row for accurate timing.
  const normalized = rows.map((r) => ({
    text: r.text,
    start: normalizeTs(r.offset ?? r.start ?? 0),
    duration: normalizeTs(r.duration ?? 0),
  }))
  for (let i = 0; i < normalized.length; i++) {
    normalized[i].end = i < normalized.length - 1 ? normalized[i + 1].start : normalized[i].start + normalized[i].duration
  }

  const sentences = []
  const buffer = []

  const flush = () => flushBuffer(buffer, sentences)

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i]
    const text = cleanRow(row.text)
    if (!text) continue

    const endsWithPunct = /[.!?]["']?\s*$/.test(text)
    const hasMidPunct = /[.!?]["']?\s+/.test(text)

    if (!endsWithPunct && !hasMidPunct) {
      // No sentence boundary — accumulate with row timestamps
      buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
      if (buffer.map((b) => b.text).join(' ').length > MAX_SENTENCE) flush()
      continue
    }

    if (hasMidPunct) {
      // Split at sentence boundary, estimate split point proportionally
      const parts = splitRowByPunct(text, row.start, row.end - row.start)
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j]
        const partEnd = j < parts.length - 1 ? parts[j + 1].start : row.end
        buffer.push({ text: part.text, start: buffer.length ? buffer[0].start : part.start, end: partEnd })
        if (/[.!?]["']?\s*$/.test(part.text)) flush()
      }
    } else {
      // Row ends with sentence boundary — accumulate then flush
      buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
      flush()
    }
  }
  flush()

  if (!sentences.length) throw new Error('No captions found for this video. Please try a video with CC.')
  return { sentences }
}
