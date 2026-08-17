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

async function getCaptionsFromHTML(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error('Failed to fetch YouTube page')
  const html = await res.text()

  const match = html.match(/"captionTracks":\[([^\]]*)\]/)
  if (!match) throw new Error('No captions found for this video. Please try a video with CC.')

  let tracks
  try {
    tracks = JSON.parse('[' + match[1] + ']')
  } catch {
    throw new Error('Failed to parse caption tracks')
  }

  const enTrack = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || tracks.find(t => t.languageCode === 'en')
    || tracks[0]
  if (!enTrack) throw new Error('No English captions found')

  const captionRes = await fetch(enTrack.baseUrl + '&fmt=json3', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!captionRes.ok) throw new Error('Failed to fetch captions')
  const captionData = await captionRes.json()

  return (captionData.events || [])
    .filter(e => e.segs)
    .map(e => ({
      text: e.segs.map(s => s.utf8).join('').trim(),
      start: (e.tStartMs || 0) / 1000,
      duration: (e.dDurationMs || 0) / 1000,
    }))
    .filter(r => r.text && r.text !== '\n')
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
  try {
    const videoId = getVideoId(target)
    if (!videoId) throw new Error('Paste a valid YouTube URL to begin.')

    const rows = await getCaptionsFromHTML(videoId)

    const normalized = rows.map((r) => ({
      text: r.text,
      start: normalizeTs(r.start),
      duration: normalizeTs(r.duration),
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
