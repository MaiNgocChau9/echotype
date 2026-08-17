const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

const CF_WORKER_URL = process.env.YOUTUBE_TRANSCRIPT_PROXY || 'https://yt-transcript.YOUR_SUBDOMAIN.workers.dev'

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
    const proxyRes = await fetch(`${CF_WORKER_URL}?url=${encodeURIComponent(target)}`)
    const data = await proxyRes.json()
    res.statusCode = proxyRes.status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: err.message || 'Transcript proxy failed' }))
  }
}
