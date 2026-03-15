import { Injectable, signal, computed, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { StorytellingPort } from '../../core/ports/storytelling.port';
import { MediaCapturePort } from '../../core/ports/media-capture.port';
import { SessionPort } from '../../core/ports/session.port';
import { SessionState } from '../../core/models/session-state.model';

@Injectable({ providedIn: 'root' })
export class LiveStoryFacade {
  private readonly storytellingPort = inject(StorytellingPort);
  private readonly mediaCapturePort = inject(MediaCapturePort);
  private readonly sessionPort = inject(SessionPort);

  private readonly _currentStory = signal<string>('');
  readonly currentStory = computed(() => this._currentStory());

  private readonly _sessionState = signal<SessionState>('idle');
  readonly sessionState = computed(() => this._sessionState());
  readonly isSessionActive = computed(() => this._sessionState() === 'active');

  private readonly _isCapturing = signal<boolean>(false);
  readonly isCapturing = computed(() => this._isCapturing());

  private readonly _hasStream = signal<boolean>(false);
  readonly hasStream = computed(() => this._hasStream());

  private readonly _errorMessage = signal<string>('');
  readonly errorMessage = computed(() => this._errorMessage());

  private readonly _waveformBars = signal<number[]>([4, 4, 4, 4, 4]);
  readonly waveformBars = computed(() => this._waveformBars());

  private readonly _isVisionScanning = signal<boolean>(false);
  readonly isVisionScanning = computed(() => this._isVisionScanning());

  readonly cameraStream$ = this.mediaCapturePort.getStream();

  private isModelSpeaking = false;
  private connectingTimeout: ReturnType<typeof setTimeout> | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private waveformFrameId: number | null = null;
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private hasReceivedFirstChunk = false;
  private sessionSubs = new Subscription();

  private currentAgentId = '';
  private currentTopic = '';
  private sessionStartTime = 0;

  startPreview(): void {
    if (this._hasStream()) return;
    this.mediaCapturePort.initPreview();
    this.mediaCapturePort.getStream().subscribe(() => this._hasStream.set(true));
  }

  async startStorytelling(
    childName: string,
    topic: string = 'El inicio de un gran viaje',
    agentId: string = 'narrator-default'
  ): Promise<void> {
    if (this._sessionState() !== 'idle') return;

    this.currentAgentId = agentId;
    this.currentTopic = topic;
    this.sessionStartTime = Date.now();

    this._sessionState.set('connecting');
    this._errorMessage.set('');
    this._currentStory.set('');
    this.hasReceivedFirstChunk = false;

    this.connectingTimeout = setTimeout(() => {
      if (this._sessionState() === 'connecting') {
        this._handleError(new Error('No se pudo conectar con el narrador. Comprueba tu conexión e inténtalo de nuevo.'));
      }
    }, 15000);

    this.sessionSubs.unsubscribe();
    this.sessionSubs = new Subscription();

    this.audioContext = new AudioContext({ sampleRate: 24000 });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 32;
    this.analyser.connect(this.audioContext.destination);

    this.sessionSubs.add(
      this.storytellingPort.connect(childName, topic, agentId).subscribe({
        next: (chunk) => {
          if (!this.hasReceivedFirstChunk) {
            this.hasReceivedFirstChunk = true;
            if (this.connectingTimeout !== null) {
              clearTimeout(this.connectingTimeout);
              this.connectingTimeout = null;
            }
            this._sessionState.set('active');
            this._startWaveformLoop();
            console.log('[CUE] ✅ Primer chunk recibido — sesión activa');
          }
          if (chunk.interrupted) {
            console.log('[CUE] ⚡ Interrupción — cortando audio, abriendo mic');
            this._stopAllSources();
            this.isModelSpeaking = false;
            return;
          }
          if (chunk.turnComplete) {
            console.log('[CUE] ✔️ Turno completo — mic abierto');
            this.isModelSpeaking = false;
            return;
          }
          if (chunk.visionCapture) {
            console.log('[CUE] 👁️ visionCapture recibido — activando halo');
            this._isVisionScanning.set(true);
            setTimeout(() => this._isVisionScanning.set(false), 1500);
          }
          if (chunk.text) this._currentStory.update(prev => prev + ' ' + chunk.text);
          if (chunk.audioChunk) {
            this.isModelSpeaking = true;
            this._playAudioChunk(chunk.audioChunk);
          }
        },
        error: (err) => this._handleError(err)
      })
    );

    this._startMultimodalCapture();
  }

  endStorytelling(): void {
    if (this.connectingTimeout !== null) {
      clearTimeout(this.connectingTimeout);
      this.connectingTimeout = null;
    }
    this._saveSession();
    this._sessionState.set('idle');
    this._isCapturing.set(false);
    this._stopWaveformLoop();
    this.sessionSubs.unsubscribe();
    this.sessionSubs = new Subscription();
    this.storytellingPort.disconnect();
    this.mediaCapturePort.stopCapture();
    this._hasStream.set(false);
    this._stopAllSources();
    this.isModelSpeaking = false;
    this.hasReceivedFirstChunk = false;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }
  }

  private _startMultimodalCapture(): void {
    this._isCapturing.set(true);

    this.sessionSubs.add(
      this.mediaCapturePort.startCapture().subscribe(frame => {
        const base64 = frame.base64Data.split(',')[1] ?? frame.base64Data;
        this.storytellingPort.sendVideoFrame(base64);
      })
    );

    this.sessionSubs.add(
      this.mediaCapturePort.getAudioStream().subscribe(pcmBase64 => {
        this.storytellingPort.sendAudio(pcmBase64);
      })
    );
  }

  private _stopAllSources(): void {
    const now = this.audioContext?.currentTime ?? 0;
    for (const source of this.activeSources) {
      try { source.stop(now); } catch { /* already stopped */ }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
  }

  private _playAudioChunk(base64PCM: string): void {
    if (!this.audioContext || !this.analyser) return;

    const binary = window.atob(base64PCM);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);

    const startTime = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) this.activeSources.splice(idx, 1);
    };
  }

  private _startWaveformLoop(): void {
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const MIN_PX = 4;
    const MAX_PX = 24;

    const tick = () => {
      this.analyser!.getByteFrequencyData(data);
      const step = Math.floor(data.length / 5);
      const bars = Array.from({ length: 5 }, (_, i) => {
        const value = data[i * step] ?? 0;
        return Math.round(MIN_PX + (value / 255) * (MAX_PX - MIN_PX));
      });
      this._waveformBars.set(bars);
      this.waveformFrameId = requestAnimationFrame(tick);
    };

    this.waveformFrameId = requestAnimationFrame(tick);
  }

  private _stopWaveformLoop(): void {
    if (this.waveformFrameId !== null) {
      cancelAnimationFrame(this.waveformFrameId);
      this.waveformFrameId = null;
    }
    this._waveformBars.set([4, 4, 4, 4, 4]);
  }

  private _saveSession(): void {
    if (!this.sessionStartTime || this._sessionState() === 'idle') return;
    const durationSeconds = Math.round((Date.now() - this.sessionStartTime) / 1000);
    this.sessionPort.save({
      agentId: this.currentAgentId,
      topic: this.currentTopic,
      storyText: this._currentStory(),
      durationSeconds,
    }).catch(err => console.error('Error guardando sesión:', err));
  }

  private _handleError(error: unknown): void {
    if (this.connectingTimeout !== null) {
      clearTimeout(this.connectingTimeout);
      this.connectingTimeout = null;
    }
    console.error('Live Story Facade Error:', error);
    const message = error instanceof Error ? error.message : 'Error de conexión';
    this._errorMessage.set(message);
    this._sessionState.set('error');
    this._isCapturing.set(false);
    this._stopWaveformLoop();
    this.sessionSubs.unsubscribe();
    this.sessionSubs = new Subscription();
    this.storytellingPort.disconnect();
    this.mediaCapturePort.stopCapture();
    this._stopAllSources();
    this.isModelSpeaking = false;
    this.hasReceivedFirstChunk = false;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }
  }
}
