# EchoType

Browser-based English listening practice with sentence-by-sentence dictation.

## Features

- **YouTube Mode** — Paste a URL, auto-fetch captions, practice immediately
- **Local File Mode** — Upload video/audio, auto-transcribe with Whisper (runs 100% in-browser)
- **Character-by-character reveal** — Tiles show progress, correct = green, wrong = red shake
- **Keyboard-driven** — Tab (replay), Enter (next), Backspace (delete), Ctrl+Enter (hint)
- **Dark/Light theme** — Toggle with sun/moon button
- **SRT export** — Download auto-generated captions
- **No server needed** — YouTube captions via CORS proxy, Whisper in Web Worker

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React + Tailwind CSS |
| Build | Vite |
| Icons | Lucide React |
| YouTube captions | `youtube-transcript` (client-side via CORS proxy) |
| Speech recognition | `@xenova/transformers` (Whisper tiny, WASM, Web Worker) |

## Project Structure

```
├── src/
│   ├── main.jsx            # React app (UI, hotkeys, transcription)
│   ├── styles.css          # All styles (dark/light themes)
│   └── whisper.worker.js   # Web Worker for Whisper ASR
├── lib/
│   └── transcript.js       # YouTube caption fetch + sentence builder
├── index.html              # Entry HTML
├── vite.config.js          # Vite config
└── package.json
```

## How It Works

### YouTube Mode
1. User pastes YouTube URL
2. `lib/transcript.js` fetches captions via `youtube-transcript` package
3. Captions normalized (handles ms/s timestamps, overlapping rows)
4. Fragmented captions grouped into sentences (max 110 chars)
5. Sentences displayed in sidebar with blur effect for upcoming ones

### Local File Mode
1. User uploads video/audio file
2. Web Audio API decodes + resamples to 16kHz mono
3. Audio sent to `whisper.worker.js` Web Worker
4. Worker loads `Xenova/whisper-tiny` model (preloaded on app start)
5. Transcription runs with 30s chunks, 5s stride
6. Progress updates posted back to UI
7. Result converted to sentences with timestamps

### Dictation Flow
1. Sentence played via `video.currentTime = start`
2. `watchEnd` pauses at sentence end
3. User types — each character checked against expected text
4. Correct chars turn green, wrong flash red
5. `Enter` advances when complete, `Ctrl+Enter` reveals next char

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Tab` | Replay current sentence |
| `Enter` | Next sentence (when correct) |
| `Backspace` | Delete last character |
| `Ctrl+Enter` | Show next character (hint) |

## Whisper Transcription

- Model: `Xenova/whisper-tiny` (quantized, ~75MB)
- Runtime: WebAssembly (WASM) via `@xenova/transformers`
- Chunking: 30s chunks with 5s stride
- Model preloaded on app start (~1-2s from cache)
- First load downloads from HuggingFace (~20s), cached in IndexedDB after

## Deployment

### Vercel
```bash
npm i -g vercel
vercel
```

`api/transcript.js` becomes a serverless function. Static assets served by Vercel CDN.

### Static (GitHub Pages, Netlify, etc.)
```bash
npm run build
# Upload dist/ folder
```

Note: YouTube caption fetching requires CORS proxy. Local file mode works everywhere.

## Environment

- Browser: Chrome 113+, Firefox 113+, Safari 16.4+
- Node.js: 18+ (for dev server)
- No backend required for local file mode
