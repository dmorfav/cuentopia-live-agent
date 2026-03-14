import { Observable } from 'rxjs';

export interface LiveContentChunk {
  text?: string;
  audioChunk?: string;
  visionCapture?: true;
  interrupted?: true;
}

export abstract class StorytellingPort {
  abstract connect(childName: string, topic: string, agentId: string): Observable<LiveContentChunk>;
  abstract sendAudio(base64PCM: string): void;
  abstract sendVideoFrame(base64JPEG: string): void;
  abstract sendText(text: string): void;
  abstract disconnect(): void;
}
