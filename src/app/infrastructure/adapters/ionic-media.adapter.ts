import { Injectable } from '@angular/core';
import { Observable, Subject, ReplaySubject } from 'rxjs';
import { MediaCapturePort } from '../../core/ports/media-capture.port';
import { MediaFrame } from '../../core/models/story-context.model';

@Injectable({
  providedIn: 'root'
})
export class IonicMediaAdapter implements MediaCapturePort {
  private mediaStream: MediaStream | null = null;
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private frameSubject = new Subject<MediaFrame>();
  private streamSubject = new ReplaySubject<MediaStream>(1);

  // Audio Processing (PCM 16kHz)
  private audioContext: AudioContext | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioSubject = new Subject<string>(); // Base64 PCM chunks

  private videoElement: HTMLVideoElement = document.createElement('video');
  private canvasElement: HTMLCanvasElement = document.createElement('canvas');

  initPreview(): void {
    this._initStream();
  }

  startCapture(): Observable<MediaFrame> {
    this._initStream().then(() => this._startFrameAndAudioCapture());
    return this.frameSubject.asObservable();
  }

  getStream(): Observable<MediaStream> {
    return this.streamSubject.asObservable();
  }

  getAudioStream(): Observable<string> {
    return this.audioSubject.asObservable();
  }

  stopCapture(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    if (this.audioProcessor) {
        this.audioProcessor.disconnect();
        this.audioSource?.disconnect();
        if (this.audioContext && this.audioContext.state !== 'closed') {
          this.audioContext.close();
        }
        this.audioProcessor = null;
        this.audioSource = null;
        this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  private async _initStream(): Promise<void> {
    if (this.mediaStream) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 15, facingMode: 'user' },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        }
      });

      this.videoElement.srcObject = this.mediaStream;
      this.videoElement.muted = true;
      this.videoElement.play();
      this.streamSubject.next(this.mediaStream);
    } catch (error) {
      this.frameSubject.error(error);
    }
  }

  private _startFrameAndAudioCapture(): void {
    if (!this.mediaStream) return;

    console.log('[CUE] 📷 Iniciando captura de frames y audio');
    this._setupAudioCapture(this.mediaStream);

    this.captureInterval = setInterval(() => {
      this._extractFrame();
    }, 500);
  }

  private _setupAudioCapture(stream: MediaStream) {
    const AudioContextClass = window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: 16000 });
    this.audioSource = this.audioContext.createMediaStreamSource(stream);

    this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    const NOISE_GATE_THRESHOLD = 0.001;

    let audioChunkCount = 0;
    this.audioProcessor.onaudioprocess = (e) => {
        e.outputBuffer.getChannelData(0).fill(0);

        const inputData = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);

        audioChunkCount++;
        if (audioChunkCount % 50 === 0) {
          console.log(`[CUE] 🎙️ Audio capturando — chunk #${audioChunkCount}, RMS: ${rms.toFixed(4)}, voz: ${rms >= NOISE_GATE_THRESHOLD ? 'SÍ' : 'silencio'}`);
        }

        if (rms < NOISE_GATE_THRESHOLD) {
            const silence = new Int16Array(inputData.length);
            this.audioSubject.next(this._arrayBufferToBase64(silence.buffer));
            return;
        }

        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        this.audioSubject.next(this._arrayBufferToBase64(pcm16.buffer));
    };

    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(this.audioContext.destination);

    this.audioSource.connect(this.audioProcessor);
    this.audioProcessor.connect(silentGain);
  }

  private frameExtractCount = 0;
  private _extractFrame() {
    if (!this.mediaStream || !this.videoElement.videoWidth) return;
    const context = this.canvasElement.getContext('2d');
    if (!context) return;

    this.canvasElement.width = 320;
    this.canvasElement.height = 240;
    context.drawImage(this.videoElement, 0, 0, 320, 240);
    const base64Data = this.canvasElement.toDataURL('image/jpeg', 0.7);

    this.frameExtractCount++;
    if (this.frameExtractCount % 20 === 0) {
      console.log(`[CUE] 🖼️ Frame #${this.frameExtractCount} — ${base64Data.length} chars`);
    }

    this.frameSubject.next({
      base64Data,
      format: 'jpeg',
      timestamp: Date.now()
    });
  }

  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}
