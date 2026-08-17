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

async function fetchTranscript(videoUrl) {
  // Try public API first
  try {
    const res = await fetch('https://youtube-transcript-api-tau-one.vercel.app/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl }),
    })
    const data = await res.json()
    if (data.status === 'success' && data.transcript) {
      return data.transcript
    }
  } catch {}

  // Fallback: scrape YouTube HTML
  const videoId = getVideoId(videoUrl)
  if (!videoId) throw new Error('Invalid URL')

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  const html = await pageRes.text()

  // Try innertube API approach from youtube-transcript package
  const innerTubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId,
    }),
  })
  if (innerTubeRes.ok) {
    const playerData = await innerTubeRes.json()
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (tracks?.length) {
      const track = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
        || tracks.find(t => t.languageCode === 'en') || tracks[0]
      const capRes = await fetch(track.baseUrl)
      const xml = await capRes.text()
      if (xml) return xml
    }
  }

  throw new Error('No captions found')
}

function parseTranscript(text) {
  // Check if it's XML
  if (text.includes('<text start=') || text.includes('<p t=')) {
    return parseXml(text)
  }
  // Plain text - split into sentences
  return buildSentencesFromText(text)
}

function parseXml(xml) {
  const rows = []
  // srv3: <p t="ms" d="ms">
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let m
  while ((m = pRegex.exec(xml))) {
    let text = ''
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g
    let s
    while ((s = sRegex.exec(m[3]))) text += s[1]
    if (!text) text = m[3].replace(/<[^>]+>/g, '')
    text = text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
    if (text) rows.push({ text, start: parseInt(m[1]) / 1000, duration: parseInt(m[2]) / 1000 })
  }
  if (rows.length) return rows
  // classic: <text start="s" dur="s">
  const classic = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g
  while ((m = classic.exec(xml))) {
    const text = m[3].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
    if (text) rows.push({ text, start: parseFloat(m[1]), duration: parseFloat(m[2]) })
  }
  return rows
}

function buildSentencesFromText(text) {
  // Split by sentence boundaries, estimate timestamps
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  const avgDur = 4
  return sentences.map((s, i) => ({
    text: s,
    start: i * avgDur,
    duration: avgDur,
  }))
}

function buildSentences(rows) {
  const MAX = 110
  for (let i = 0; i < rows.length; i++) {
    rows[i].end = i < rows.length - 1 ? rows[i + 1].start : rows[i].start + rows[i].duration
  }
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
    const text = row.text.replace(/\[[^\]]*\]/g, '').replace(/>>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (!/[.!?]["']?\s*$/.test(text)) {
      buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end || row.start + row.duration })
      if (buffer.map(b => b.text).join(' ').length > MAX) flush()
      continue
    }
    buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end || row.start + row.duration })
    flush()
  }
  flush()
  return sentences
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  const u = new URL(req.url, 'http://localhost')
  const target = u.searchParams.get('url') || ''
  try {
    if (!getVideoId(target)) throw new Error('Paste a valid YouTube URL to begin.')
    const raw = await fetchTranscript(target)
    const rows = parseTranscript(raw)
    const sentences = buildSentences(rows)
    if (!sentences.length) throw new Error('No captions found')
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify({ sentences }))
  } catch (err) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: err.message || 'No captions found' }))
  }
}
