import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, Subject } from 'rxjs';
import { GoogleGenAI, Session, LiveServerMessage, Modality, ActivityHandling } from '@google/genai';
import { StorytellingPort, LiveContentChunk } from '../../core/ports/storytelling.port';
import { AgentConfig } from '../../core/models/agent-config.model';

@Injectable({ providedIn: 'root' })
export class FirebaseStorytellingAdapter implements StorytellingPort {
  private readonly functions = inject(Functions);
  private session: Session | null = null;
  private chunkSubject = new Subject<LiveContentChunk>();
  private lastVideoFrame: string | null = null;
  private frameCount = 0;
  private nudgeTimer: ReturnType<typeof setInterval> | null = null;
  private isModelTurn = false;
  private isSpeaking = false;
  private sessionReady = false;
  private activityEndTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeCooldownUntil = 0;

  private readonly getConfigFn = httpsCallable<{ agentId: string }, AgentConfig>(this.functions, 'getLiveConfig');

  connect(childName: string, topic: string, agentId: string): Observable<LiveContentChunk> {
    this.chunkSubject = new Subject<LiveContentChunk>();

    this.getConfigFn({ agentId }).then(result => {
      this._initSession(result.data, childName, topic);
    }).catch(err => {
      this.chunkSubject.error(err);
    });

    return this.chunkSubject.asObservable();
  }

  private async _initSession(config: AgentConfig, childName: string, topic: string): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });

    this.session = await ai.live.connect({
      model: config.model,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } }
        },
        systemInstruction: { parts: [{ text: config.systemPrompt }] },
        thinkingConfig: { thinkingBudget: 0 },
        outputAudioTranscription: {},
        realtimeInputConfig: {
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          automaticActivityDetection: { disabled: true },
        },
      },
      callbacks: {
        onopen: () => {
          console.log('[CUE] 🟢 WebSocket abierto — enviando prompt inicial en 2s');
          const initialPrompt = config.initialPromptTemplate
            .replace('{childName}', childName)
            .replace('{topic}', topic);

          setTimeout(() => {
            console.log('[CUE] 📝 Enviando prompt inicial:', initialPrompt.slice(0, 80));
            this.sendText(initialPrompt);
            this.sessionReady = true;

            if (config.visionNudgeIntervalSeconds > 0) {
              this.nudgeTimer = setInterval(() => {
                const now = Date.now();
                if (
                  this.lastVideoFrame &&
                  this.session &&
                  !this.isModelTurn &&
                  now > this.nudgeCooldownUntil
                ) {
                  console.log('[CUE] 👁️ Vision nudge enviado con frame');
                  this.session.sendClientContent({
                    turns: [{
                      role: 'user',
                      parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: this.lastVideoFrame } },
                        { text: config.visionNudgeText },
                      ],
                    }],
                    turnComplete: true,
                  });
                }
              }, config.visionNudgeIntervalSeconds * 1000);
            }
          }, 2000);
        },
        onmessage: (msg: LiveServerMessage) => {
          if (msg.setupComplete) console.log('[CUE] ⚙️ setupComplete recibido');
          this._handleMessage(msg);
        },
        onerror: (e: ErrorEvent) => {
          console.error('[CUE] ❌ Error WebSocket:', e.message);
          this.chunkSubject.error(new Error(e.message));
        },
        onclose: () => {
          console.warn('[CUE] 🔴 WebSocket cerrado');
        },
      },
    });
  }

  sendAudio(base64PCM: string): void {
    if (!this.session || !this.sessionReady) return;

    // IonicMediaAdapter sends zeros (silence) when RMS < threshold.
    // A zero-filled Int16Array encodes to base64 starting with many 'A' chars.
    const silent = base64PCM.startsWith('AAAAAAAAAAAAAAAA');

    if (silent) {
      if (this.isSpeaking) {
        // Debounce activityEnd to avoid false cuts on natural speech pauses.
        if (!this.activityEndTimer) {
          this.activityEndTimer = setTimeout(() => {
            this.activityEndTimer = null;
            if (this.isSpeaking) {
              this.isSpeaking = false;
              this.session?.sendRealtimeInput({ activityEnd: {} });
              console.log('[CUE] 🔇 Fin de voz detectado');
            }
          }, 350);
        }
      }
      return;
    }

    // Voice detected — cancel any pending activityEnd debounce.
    if (this.activityEndTimer) {
      clearTimeout(this.activityEndTimer);
      this.activityEndTimer = null;
    }

    if (!this.isSpeaking) {
      this.isSpeaking = true;
      this.session.sendRealtimeInput({ activityStart: {} });
      console.log('[CUE] 🎙️ Inicio de voz detectado');
    }

    this.session.sendRealtimeInput({
      audio: { mimeType: 'audio/pcm;rate=16000', data: base64PCM },
    });
  }

  sendVideoFrame(base64JPEG: string): void {
    this.lastVideoFrame = base64JPEG;
    this.session?.sendRealtimeInput({
      media: { mimeType: 'image/jpeg', data: base64JPEG },
    });
    if (++this.frameCount % 10 === 0) {
      this.chunkSubject.next({ visionCapture: true });
    }
  }

  sendText(text: string): void {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }

  disconnect(): void {
    if (this.nudgeTimer !== null) {
      clearInterval(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    if (this.activityEndTimer !== null) {
      clearTimeout(this.activityEndTimer);
      this.activityEndTimer = null;
    }
    this.session?.close();
    this.session = null;
    this.lastVideoFrame = null;
    this.frameCount = 0;
    this.isModelTurn = false;
    this.isSpeaking = false;
    this.sessionReady = false;
    this.nudgeCooldownUntil = 0;
  }

  private _handleMessage(msg: LiveServerMessage): void {
    if (!msg.serverContent) return;

    if (msg.serverContent.interrupted) {
      console.log('[CUE] ⚡ Modelo interrumpido por el usuario');
      this.isModelTurn = false;
      this.chunkSubject.next({ interrupted: true });
      return;
    }

    if (msg.serverContent.outputTranscription?.text) {
      this.chunkSubject.next({ text: msg.serverContent.outputTranscription.text });
    }

    const parts = msg.serverContent.modelTurn?.parts ?? [];
    parts.forEach(part => {
      if (part.inlineData?.data) {
        this.isModelTurn = true;
        console.log('[CUE] 🎵 Audio chunk recibido — bytes base64:', part.inlineData.data.length);
        this.chunkSubject.next({ audioChunk: part.inlineData.data });
      }
    });

    if (msg.serverContent.turnComplete) {
      console.log('[CUE] ✔️ Turno del modelo completo — mic abierto');
      this.isModelTurn = false;
      // Cooldown: give time for local audio playback to finish before next nudge.
      this.nudgeCooldownUntil = Date.now() + 3000;
      this.chunkSubject.next({ turnComplete: true });
    }
  }

}
