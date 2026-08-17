import http from 'http'
import transcriptHandler from './api/transcript.js'

const PORT = process.env.PORT || 8000

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (u.pathname === '/api/transcript') {
      transcriptHandler(req, res)
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 404
    res.end(JSON.stringify({ detail: 'Not found' }))
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`EchoType API listening on http://0.0.0.0:${PORT}`)
  })
