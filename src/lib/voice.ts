// Browser Grok Voice client for Grok Remote.
// Mic → PCM16 24kHz → server proxy → xAI Realtime; audio deltas play back.

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface VoiceStatusApi {
  ok: boolean;
  enabled?: boolean;
  wsPath?: string;
  model?: string;
  voice?: string;
  source?: string | null;
  expiresAt?: string | null;
  hint?: string;
}

export interface VoiceSessionOptions {
  agentId: string | null;
  voice?: string;
  model?: string;
  onState?: (state: VoiceState, detail?: string) => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, final: boolean) => void;
  onTool?: (info: { name: string; status: string; result?: unknown }) => void;
  onError?: (message: string) => void;
}

const SAMPLE_RATE = 24000;

function float32ToBase64PCM16(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    pcm16[i] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64PCM16ToFloat32(b64: string): Float32Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) out[i] = pcm16[i]! / 32768;
  return out;
}

export async function fetchVoiceStatus(): Promise<VoiceStatusApi> {
  const r = await fetch('/api/voice/status');
  return (await r.json()) as VoiceStatusApi;
}

export class VoiceSession {
  private ws: WebSocket | null = null;
  private media: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playTime = 0;
  private state: VoiceState = 'idle';
  private agentId: string | null;
  private opts: VoiceSessionOptions;
  private userPartial = '';
  private asstPartial = '';

  constructor(opts: VoiceSessionOptions) {
    this.opts = opts;
    this.agentId = opts.agentId;
  }

  getState(): VoiceState { return this.state; }

  private setState(s: VoiceState, detail?: string) {
    this.state = s;
    this.opts.onState?.(s, detail);
  }

  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') return;
    this.setState('connecting');

    try {
      this.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState('error', 'mic denied');
      this.opts.onError?.(`Microphone permission denied: ${msg}`);
      throw err;
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams();
    if (this.agentId) params.set('agentId', this.agentId);
    if (this.opts.voice) params.set('voice', this.opts.voice);
    if (this.opts.model) params.set('model', this.opts.model);
    const url = `${proto}://${location.host}/api/voice/ws?${params.toString()}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const t = setTimeout(() => reject(new Error('voice connect timeout')), 15000);

      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error('voice websocket error'));
      };
      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onclose = () => {
        this.teardownAudio();
        if (this.state !== 'idle') this.setState('idle', 'closed');
      };
    });

    this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    this.source = this.audioCtx.createMediaStreamSource(this.media!);
    // ScriptProcessor is deprecated but widely supported; fine for MVP.
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Keep mic open for server VAD + barge-in while assistant speaks
      const input = e.inputBuffer.getChannelData(0);
      // Resample if context rate != 24k
      const pcm = this.resampleTo24k(input, this.audioCtx!.sampleRate);
      const b64 = float32ToBase64PCM16(pcm);
      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: b64,
      }));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.playTime = this.audioCtx.currentTime;
    this.setState('listening');
  }

  setFocus(agentId: string | null) {
    this.agentId = agentId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'grok_remote.set_focus', agentId }));
    }
  }

  stop() {
    try {
      this.ws?.send(JSON.stringify({ type: 'grok_remote.stop' }));
    } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.teardownAudio();
    this.setState('idle');
  }

  private teardownAudio() {
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.media?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void this.audioCtx?.close(); } catch { /* ignore */ }
    this.processor = null;
    this.source = null;
    this.media = null;
    this.audioCtx = null;
  }

  private resampleTo24k(input: Float32Array, fromRate: number): Float32Array {
    if (fromRate === SAMPLE_RATE) return input;
    const ratio = fromRate / SAMPLE_RATE;
    const newLen = Math.floor(input.length / ratio);
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = src - i0;
      out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
    }
    return out;
  }

  private playPcmBase64(b64: string) {
    if (!this.audioCtx) return;
    const samples = base64PCM16ToFloat32(b64);
    if (!samples.length) return;
    const buf = this.audioCtx.createBuffer(1, samples.length, SAMPLE_RATE);
    buf.copyToChannel(samples, 0);
    const src = this.audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.audioCtx.destination);
    const now = this.audioCtx.currentTime;
    if (this.playTime < now) this.playTime = now + 0.02;
    src.start(this.playTime);
    this.playTime += buf.duration;
  }

  private onMessage(ev: MessageEvent) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(event['type'] || '');

    if (type === 'grok_remote.error') {
      const msg = String(event['message'] || event['error'] || 'voice error');
      this.setState('error', msg);
      this.opts.onError?.(msg);
      return;
    }
    if (type === 'grok_remote.xai_open') {
      this.setState('listening', 'xai open');
      return;
    }
    if (type === 'grok_remote.tool') {
      this.opts.onTool?.({
        name: String(event['name'] || ''),
        status: String(event['status'] || ''),
        result: event['result'],
      });
      return;
    }

    // Audio deltas (xAI naming variants)
    if (
      type === 'response.output_audio.delta'
      || type === 'response.audio.delta'
    ) {
      const delta = event['delta'] ?? event['audio'];
      if (typeof delta === 'string') {
        this.setState('speaking');
        this.playPcmBase64(delta);
      }
      return;
    }

    if (type === 'response.done' || type === 'response.output_audio.done' || type === 'output_audio_buffer.stopped') {
      // Small delay then back to listening
      setTimeout(() => {
        if (this.state === 'speaking') this.setState('listening');
      }, 150);
      return;
    }

    // Transcripts
    if (type === 'conversation.item.input_audio_transcription.delta') {
      const d = String(event['delta'] || '');
      this.userPartial += d;
      this.opts.onTranscript?.('user', this.userPartial, false);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const t = String(event['transcript'] || this.userPartial);
      this.userPartial = '';
      if (t) this.opts.onTranscript?.('user', t, true);
      return;
    }
    if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
      const d = String(event['delta'] || '');
      this.asstPartial += d;
      this.opts.onTranscript?.('assistant', this.asstPartial, false);
      return;
    }
    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      const t = String(event['transcript'] || this.asstPartial);
      this.asstPartial = '';
      if (t) this.opts.onTranscript?.('assistant', t, true);
      return;
    }

    if (type === 'input_audio_buffer.speech_started') {
      this.setState('listening', 'speech');
      return;
    }
    if (type === 'error') {
      const msg = String((event['error'] as { message?: string })?.message || event['message'] || 'realtime error');
      this.opts.onError?.(msg);
    }
  }
}
