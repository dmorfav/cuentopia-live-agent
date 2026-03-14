import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, Subject } from 'rxjs';
import { StorytellingPort, LiveContentChunk } from '../../core/ports/storytelling.port';
import { AgentConfig } from '../../core/models/agent-config.model';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiMessage {
  error?: { code: number; message: string };
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: { parts: GeminiPart[] };
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  usageMetadata?: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class FirebaseStorytellingAdapter implements StorytellingPort {
  private readonly functions = inject(Functions);
  private socket: WebSocket | null = null;
  private chunkSubject = new Subject<LiveContentChunk>();
  private nudgeInterval: ReturnType<typeof setInterval> | null = null;
  private lastVideoFrame: string | null = null;

  private readonly getConfigFn = httpsCallable<{ agentId: string }, AgentConfig>(this.functions, 'getLiveConfig');

  connect(childName: string, topic: string, agentId: string): Observable<LiveContentChunk> {
    this.chunkSubject = new Subject<LiveContentChunk>();

    this.getConfigFn({ agentId }).then(result => {
      this._initWebSocket(result.data, childName, topic);
    }).catch(err => {
      console.error('Error getting config:', err);
      this.chunkSubject.error(err);
    });

    return this.chunkSubject.asObservable();
  }

  private _initWebSocket(config: AgentConfig, childName: string, topic: string): void {
    const url = `${config.baseUrl}?key=${config.apiKey}`;
    console.log('Connecting to Gemini Live API:', config.model);
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      console.log('Gemini Live API WebSocket Opened.');
      this._sendSetup(config);

      setTimeout(() => {
        const initialPrompt = config.initialPromptTemplate
          .replace('{childName}', childName)
          .replace('{topic}', topic);
        this.sendText(initialPrompt);
      }, 2000);

      this.nudgeInterval = setInterval(() => {
        this._sendVisionNudge(config.visionNudgeText);
      }, config.visionNudgeIntervalSeconds * 1000);
    };

    this.socket.onmessage = async (event: MessageEvent) => {
      try {
        const raw = event.data instanceof Blob ? await event.data.text() : event.data as string;
        const msg = JSON.parse(raw) as GeminiMessage;
        this._handleServerMessage(msg);
      } catch {
        this.chunkSubject.error(new Error('Error procesando mensaje del servidor'));
      }
    };

    this.socket.onerror = () => {
      this.chunkSubject.error(new Error('Error de conexión con el servidor'));
    };

    this.socket.onclose = (event: CloseEvent) => {
      console.warn('Gemini Live API Disconnected.', event.code, event.reason);
      this._clearNudge();
    };
  }

  private _sendSetup(config: AgentConfig): void {
    const setupMsg = {
      setup: {
        model: config.model,
        system_instruction: { parts: [{ text: config.systemPrompt }] },
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: {
            voice_config: { prebuilt_voice_config: { voice_name: config.voiceName } }
          }
        }
      }
    };
    this.socket?.send(JSON.stringify(setupMsg));
  }

  sendAudio(base64PCM: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      realtime_input: { media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: base64PCM }] }
    }));
  }

  sendVideoFrame(base64JPEG: string): void {
    this.lastVideoFrame = base64JPEG;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      realtime_input: { media_chunks: [{ mime_type: 'image/jpeg', data: base64JPEG }] }
    }));
  }

  private _sendVisionNudge(nudgeText: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
    if (this.lastVideoFrame) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: this.lastVideoFrame } });
    }
    parts.push({ text: nudgeText });
    this.socket.send(JSON.stringify({
      client_content: { turns: [{ role: 'user', parts }], turn_complete: true }
    }));
    this.chunkSubject.next({ visionCapture: true });
  }

  sendText(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      client_content: { turns: [{ role: 'user', parts: [{ text }] }], turn_complete: true }
    }));
  }

  disconnect(): void {
    this._clearNudge();
    this.socket?.close();
    this.socket = null;
    this.lastVideoFrame = null;
  }

  private _handleServerMessage(msg: GeminiMessage): void {
    if (msg.error) {
      console.error('Gemini Live API Server Error:', msg.error);
      return;
    }

    msg.serverContent?.modelTurn?.parts.forEach(part => {
      if (part.text) this.chunkSubject.next({ text: part.text });
      if (part.inlineData) this.chunkSubject.next({ audioChunk: part.inlineData.data });
    });
  }

  private _clearNudge(): void {
    if (this.nudgeInterval) {
      clearInterval(this.nudgeInterval);
      this.nudgeInterval = null;
    }
  }
}
