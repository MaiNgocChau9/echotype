import { pipeline, env } from '@xenova/transformers'

env.allowLocalModels = false

class PipelineFactory {
  static task = null
  static model = null
  static quantized = null
  static instance = null

  constructor(tokenizer, model, quantized) {
    this.tokenizer = tokenizer
    this.model = model
    this.quantized = quantized
  }

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, {
        quantized: this.quantized,
        progress_callback,
        revision: this.model.includes('/whisper-medium') ? 'no_attentions' : 'main',
      })
    }
    return this.instance
  }
}

class ASRPipelineFactory extends PipelineFactory {
  static task = 'automatic-speech-recognition'
  static model = null
  static quantized = null
}

self.addEventListener('message', async (event) => {
  const { audio, model, quantized, preload } = event.data
  console.log('[whisper-worker] received:', { audioLength: audio?.length, model, quantized, preload })

  try {
    const isDistilWhisper = model?.startsWith('distil-whisper/')
    let modelName = model || 'Xenova/whisper-tiny'
    if (!isDistilWhisper) modelName += '.en'
    console.log('[whisper-worker] using model:', modelName)

    const p = ASRPipelineFactory
    const alreadyLoaded = p.instance !== null && p.model === modelName
    console.log('[whisper-worker] already loaded?', alreadyLoaded)
    if (p.model !== modelName || p.quantized !== quantized) {
      p.model = modelName
      p.quantized = quantized ?? true
      if (p.instance !== null) {
        (await p.getInstance()).dispose()
        p.instance = null
      }
    }

    console.log('[whisper-worker] loading model...')
    const t0 = Date.now()
    const transcriber = await p.getInstance((data) => {
      if (data.status === 'progress' && data.total > 0) {
        self.postMessage({ status: 'progress', file: data.file, progress: data.loaded / data.total, phase: 'load' })
      } else if (data.status === 'initiate') {
        self.postMessage({ status: 'initiate', file: data.file, name: data.name })
      } else if (data.status === 'done') {
        self.postMessage({ status: 'done', file: data.file })
      }
    })
    const loadTime = Date.now() - t0
    console.log('[whisper-worker] model ready in', loadTime, 'ms')

    if (preload) {
      console.log('[whisper-worker] model preloaded, ready')
      self.postMessage({ status: 'progress', progress: 1, phase: 'load' })
      return
    }

    if (alreadyLoaded) {
      console.log('[whisper-worker] model already cached, skipping load phase')
    } else {
      console.log('[whisper-worker] model loaded, starting transcription...')
    }
    self.postMessage({ status: 'progress', progress: 0, phase: 'transcribe' })

    const audioDuration = audio.length / 16000
    const time_precision =
      transcriber.processor.feature_extractor.config.chunk_length /
      transcriber.model.config.max_source_positions
    console.log('[whisper-worker] audio:', audioDuration.toFixed(1) + 's, time_precision:', time_precision.toFixed(3))

    let chunks_to_process = [{ tokens: [], finalised: false }]
    let lastProgress = 0

    function chunk_callback(chunk) {
      const last = chunks_to_process[chunks_to_process.length - 1]
      Object.assign(last, chunk)
      last.finalised = true
      if (!chunk.is_last) {
        chunks_to_process.push({ tokens: [], finalised: false })
      }
    }

    function callback_function(item) {
      const last = chunks_to_process[chunks_to_process.length - 1]
      last.tokens = [...(item[0]?.output_token_ids || [])]
      const data = transcriber.tokenizer._decode_asr(chunks_to_process, {
        time_precision,
        return_timestamps: true,
        force_full_sequences: false,
      })
      const chunks = data[1]?.chunks || []
      const lastChunk = chunks[chunks.length - 1]
      const end = lastChunk?.timestamp?.[1] ?? lastChunk?.end
      if (end != null && end > 0 && audioDuration) {
        lastProgress = Math.max(lastProgress, Math.min(0.99, end / audioDuration))
      }
      self.postMessage({ status: 'progress', progress: lastProgress, phase: 'transcribe' })
    }

    console.log('[whisper-worker] starting transcription...')
    const t1 = Date.now()
    const output = await transcriber(audio, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: 30,
      stride_length_s: 5,
      language: null,
      task: 'transcribe',
      return_timestamps: true,
      force_full_sequences: false,
      callback_function,
      chunk_callback,
    })
    console.log('[whisper-worker] transcription done in', Date.now() - t1, 'ms, chunks:', output?.chunks?.length)

    if (!output?.chunks?.length) {
      console.log('[whisper-worker] no chunks detected')
      self.postMessage({ status: 'error', data: { message: 'No speech detected in this file.' } })
      return
    }

    console.log('[whisper-worker] sending complete message')
    self.postMessage({
      status: 'complete',
      task: 'automatic-speech-recognition',
      data: { text: output.text, chunks: output.chunks },
    })
  } catch (err) {
    self.postMessage({ status: 'error', data: { message: err?.message || 'Could not transcribe this file.' } })
  }
})
