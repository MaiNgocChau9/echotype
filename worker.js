// Cloudflare Worker proxy for YouTube transcript
// Deploy at cloudflare.com → Workers & Pages → Create Worker
// Then set YOUTUBE_TRANSCRIPT_PROXY env var in Vercel to your worker URL

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // GET /?url=https://www.youtube.com/watch?v=xxx
    const target = url.searchParams.get('url') || ''
    const videoId = getVideoId(target)
    if (!videoId) {
      return jsonResponse({ detail: 'Paste a valid YouTube URL to begin.' }, 400)
    }

    try {
      // Step 1: Fetch YouTube page HTML from CF (not blocked)
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      if (!pageRes.ok) throw new Error('Failed to fetch YouTube page')
      const html = await pageRes.text()

      // Step 2: Extract captionTracks from ytInitialPlayerResponse
      const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s)
      if (!playerMatch) throw new Error('No captions found')
      const playerData = JSON.parse(playerMatch[1])
      const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
      if (!tracks?.length) throw new Error('No captions found for this video')

      // Step 3: Pick English track, fetch XML
      const enTrack = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
        || tracks.find(t => t.languageCode === 'en')
        || tracks[0]

      const capRes = await fetch(enTrack.baseUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const xml = await capRes.text()
      if (!xml) throw new Error('Caption content is empty')

      // Step 4: Parse XML
      const rows = parseTranscriptXml(xml)
      const sentences = buildSentences(rows)

      return jsonResponse({ sentences })
    } catch (err) {
      return jsonResponse({ detail: err.message || 'No captions found' }, 404)
    }
  },
}

function getVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || ''
    return u.searchParams.get('v') || ''
  } catch { return '' }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function parseTranscriptXml(xml) {
  const results = []
  // srv3: <p t="ms" d="ms"><s>word</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let m
  while ((m = pRegex.exec(xml))) {
    let text = ''
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g
    let s
    while ((s = sRegex.exec(m[3]))) text += s[1]
    if (!text) text = m[3].replace(/<[^>]+>/g, '')
    text = decodeEntities(text).trim()
    if (text) results.push({ text, offset: parseInt(m[1]), duration: parseInt(m[2]) })
  }
  if (results.length) return results
  // classic: <text start="s" dur="s">content</text>
  const classic = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g
  while ((m = classic.exec(xml))) {
    const text = decodeEntities(m[3]).trim()
    if (text) results.push({ text, offset: parseFloat(m[1]) * 1000, duration: parseFloat(m[2]) * 1000 })
  }
  return results
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
}

function buildSentences(rows) {
  const MAX = 110
  const norm = rows.map(r => ({ text: r.text, start: r.offset / 1000, duration: r.duration / 1000 }))
  for (let i = 0; i < norm.length; i++) {
    norm[i].end = i < norm.length - 1 ? norm[i + 1].start : norm[i].start + norm[i].duration
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
  for (const row of norm) {
    const text = row.text.replace(/\[[^\]]*\]/g, '').replace(/>>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) continue
    if (!/[.!?]["']?\s*$/.test(text)) {
      buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
      if (buffer.map(b => b.text).join(' ').length > MAX) flush()
      continue
    }
    buffer.push({ text, start: buffer.length ? buffer[0].start : row.start, end: row.end })
    flush()
  }
  flush()
  return sentences
}
