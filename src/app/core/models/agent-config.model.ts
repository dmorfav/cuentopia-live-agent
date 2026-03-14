export interface AgentConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  initialPromptTemplate: string;
  visionNudgeIntervalSeconds: number;
  visionNudgeText: string;
  voiceName: string;
}
