// ─────────────────────────────────────────────────────────────────────────────
// WHISPER LOCAL — transcreve áudio no PRÓPRIO PC (Transformers.js, WASM/CPU).
// Sem nuvem, sem chave: o áudio NUNCA sai da máquina. Roda num WebWorker pra não
// travar a UI. Modelo `whisper-tiny` (multilíngue pt/en/es) baixa 1x e fica em cache.
// ─────────────────────────────────────────────────────────────────────────────
import { pipeline, env } from '@huggingface/transformers';

// Sem modelos locais empacotados — baixa do HuggingFace (cache do navegador) no 1º uso.
env.allowLocalModels = false;

type ASR = (audio: Float32Array, opts?: any) => Promise<{ text: string } | Array<{ text: string }>>;
let transcriber: ASR | null = null;

async function getTranscriber(onProgress?: (p: unknown) => void): Promise<ASR> {
  if (!transcriber) {
    // fp32 GLOBAL e device 'wasm' (CPU). As variantes quantizadas (q4/q8/int8/uint8) batem numa
    // REGRESSÃO do ONNX Runtime 1.25 que quebra a criação de sessão no WASM com
    // "TransposeDQWeightsForMatMulNBits Missing required scale" (onnxruntime#28306, transformers.js#1707).
    // fp32 é a única que carrega no CPU. Maior no disco, mas é o que funciona aqui.
    transcriber = (await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      dtype: 'fp32', device: 'wasm', progress_callback: onProgress,
    } as any)) as unknown as ASR;
  }
  return transcriber;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, language } = (e.data || {}) as { type: string; audio?: Float32Array; language?: string };
  try {
    if (type === 'load') {
      await getTranscriber((p) => self.postMessage({ type: 'progress', progress: p }));
      self.postMessage({ type: 'ready' });
      return;
    }
    if (type === 'transcribe' && audio) {
      const t = await getTranscriber((p) => self.postMessage({ type: 'progress', progress: p }));
      const out = await t(audio, { language: language || undefined, task: 'transcribe', chunk_length_s: 30 });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text) || '';
      self.postMessage({ type: 'result', text: text.trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err as Error)?.message || err) });
  }
};
