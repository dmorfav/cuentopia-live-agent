export interface SessionRecord {
  agentId: string;
  topic: string;
  storyText: string;
  durationSeconds: number;
}

export abstract class SessionPort {
  abstract save(session: SessionRecord): Promise<void>;
  abstract getRecent(limit: number): Promise<(SessionRecord & { id: string; startedAt: Date })[]>;
  abstract delete(id: string): Promise<void>;
}
