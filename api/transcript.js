import { YoutubeTranscript } from 'youtube-transcript'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

function getVideoId(url) {
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
  return text.replace(/\[[^\]]*\]/g, '').replace(/>>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeTs(val) {
  return val > 100 ? val / 1000 : val
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const u = new URL(req.url, 'http://localhost')
  const target = u.searchParams.get('url') || ''
  console.log('[transcript] fetching:', target)
  try {
    const videoId = getVideoId(target)
    if (!videoId) throw new Error('Paste a valid YouTube URL to begin.')
    const rows = await YoutubeTranscript.fetchTranscript(videoId)
    console.log('[transcript] raw rows:', rows.length)

    const normalized = rows.map((r) => ({
      text: r.text,
      start: normalizeTs(r.offset ?? r.start ?? 0),
      duration: normalizeTs(r.duration ?? 0),
    }))
    for (let i = 0; i < normalized.length; i++) {
      normalized[i].end = i < normalized.length - 1 ? normalized[i + 1].start : normalized[i].start + normalized[i].duration
    }

    const MAX_SENTENCE = 110
    const sentences = []
    const buffer = []
    const flush = () => {
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

    for (let i = 0; i < normalized.length; i++) {
      const row = normalized[i]
      const text = cleanRow(row.text)
      if (!text) continue
      const endsWithPunct = /[.!?]["']?\s*$/.test(text)
      if (!endsWithPunct) {
        buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
        if (buffer.map((b) => b.text).join(' ').length > MAX_SENTENCE) flush()
        continue
      }
      buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
      flush()
    }
    flush()

    console.log('[transcript] sentences:', sentences.length)
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify({ sentences }))
  } catch (err) {
    console.error('[transcript] error:', err.message)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: err.message || 'No captions found for this video. Please try a video with CC.' }))
  }
}