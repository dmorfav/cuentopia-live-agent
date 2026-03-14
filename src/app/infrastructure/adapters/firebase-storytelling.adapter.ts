import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, Subject } from 'rxjs';
import { GoogleGenAI, Session, LiveServerMessage, Modality } from '@google/genai';
import { StorytellingPort, LiveContentChunk } from '../../core/ports/storytelling.port';
import { AgentConfig } from '../../core/models/agent-config.model';

@Injectable({ providedIn: 'root' })
export class FirebaseStorytellingAdapter implements StorytellingPort {
  private readonly functions = inject(Functions);
  private session: Session | null = null;
  private chunkSubject = new Subject<LiveContentChunk>();
  private lastVideoFrame: string | null = null;
  private frameCount = 0;

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
    this.session?.sendRealtimeInput({
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
    this.session?.close();
    this.session = null;
    this.lastVideoFrame = null;
    this.frameCount = 0;
  }

  private _handleMessage(msg: LiveServerMessage): void {
    if (msg.serverContent?.interrupted) {
      this.chunkSubject.next({ interrupted: true });
      return;
    }
    msg.serverContent?.modelTurn?.parts?.forEach(part => {
      if (part.text) this.chunkSubject.next({ text: part.text });
      if (part.inlineData?.data) this.chunkSubject.next({ audioChunk: part.inlineData.data });
    });
  }

}
