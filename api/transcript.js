import { YoutubeTranscript } from 'youtube-transcript'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

function getVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || ''
    return u.searchParams.get('v') || ''
  } catch { return '' }
}

function decodeXmlEntities(text) {
  return text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'").replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(parseInt(d,10)))
}

function cleanRow(text) {
  return decodeXmlEntities(text.replace(/\[[^\]]*\]/g,'').replace(/>></g,' ').replace(/\s+/g,' ').trim())
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  const u = new URL(req.url, 'http://localhost')
  const target = u.searchParams.get('url') || ''
  try {
    const videoId = getVideoId(target)
    if (!videoId) throw new Error('Paste a valid YouTube URL to begin.')

    const raw = await YoutubeTranscript.fetchTranscript(videoId)
    if (!raw?.length) throw new Error('No captions found')

    const rows = raw.map(r => ({
      text: cleanRow(r.text),
      start: r.offset / 1000,
      duration: r.duration / 1000,
    })).filter(r => r.text)

    for (let i = 0; i < rows.length; i++) {
      rows[i].end = i < rows.length - 1 ? rows[i + 1].start : rows[i].start + rows[i].duration
    }

    const MAX = 110
    const sentences = []
    const buffer = []
    const flush = () => {
      if (!buffer.length) return
      const text = buffer.map(b => b.text).join(' ').trim()
      if (text) sentences.push({
        id: sentences.length + 1,
        text,
        start: Math.round(buffer[0].start * 100) / 100,
        duration: Math.round(Math.max(0, buffer[buffer.length - 1].end - buffer[0].start) * 100) / 100,
      })
      buffer.length = 0
    }

    for (const row of rows) {
      if (!/[.!?]["']?\s*$/.test(row.text)) {
        buffer.push({ text: row.text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
        if (buffer.map(b => b.text).join(' ').length > MAX) flush()
        continue
      }
      buffer.push({ text: row.text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
      flush()
    }
    flush()

    if (!sentences.length) throw new Error('No captions found')
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify({ sentences }))
  } catch (err) {
    console.error('[transcript]', err.message)
    const isBlocked = err.message?.includes('Transcript is disabled') || err.message?.includes('disabled')
    res.statusCode = isBlocked ? 403 : 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: err.message || 'No captions found' }))
  }
}
