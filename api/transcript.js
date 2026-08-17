import { getTranscript } from '../lib/transcript.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
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
    const data = await getTranscript(target)
    console.log('[transcript] success:', data.sentences?.length, 'sentences')
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify(data))
  } catch (err) {
    console.error('[transcript] error:', err.message, err.stack)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: err.message || 'No captions found for this video. Please try a video with CC.' }))
  }
}