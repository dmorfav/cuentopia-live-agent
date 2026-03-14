# Cuentopia — Multimodal Empathy for Therapeutic Storytelling

An AI-powered storytelling agent that sees, hears and emotionally responds to children in real time. Built for the **Gemini Live Agent Challenge**.

---

## What it does

Cuentopia uses the **Gemini Live API** (via `@google/genai` SDK) to establish a persistent multimodal session with the child's device. While narrating a story, the agent simultaneously:

- **Listens** to the child's voice via microphone (PCM 16kHz) — the child can interrupt and redirect the story at any time
- **Sees** the child's facial expressions via camera (JPEG frames streamed in real time)
- **Adapts** the narrative silently based on detected emotional cues

If the child looks bored → the plot takes a dramatic turn.
If the child looks scared → a comforting character appears immediately.
If the child smiles → the story accelerates and amplifies that joy.
If the child asks for something different → the agent pivots instantly.

The agent also asks the child's name at the start of every session. If the child doesn't answer, it proposes a funny nickname based on what it sees through the camera.

---

## Agent Architecture

Cuentopia uses a **multi-agent system** where each agent is a specialized narrator stored in Firestore. Agents are loaded dynamically at session start — no redeployment needed to add or modify a narrator.

| Agent ID | Persona | Specialization |
|---|---|---|
| `narrator-onboarding` | Cuentopia | Welcome flow: collects name + topic, then starts |
| `narrator-default` | Leo | General adaptive storytelling |
| `narrator-fears` | Valentín | Helping children overcome fears |
| `narrator-sleep` | Luna | Calm bedtime stories |
| `narrator-adventure` | Chispa | High-energy action stories |

Each agent in Firestore defines:
- `systemPrompt` — personality, visual reaction rules and narrative style
- `initialPromptTemplate` — how the session starts (`{topic}` placeholder)
- `visionNudgeText` — instruction sent with each periodic vision frame
- `visionNudgeIntervalSeconds` — how often the vision frame is sent
- `voiceName` — the Gemini voice used for audio synthesis

---

## Technical Architecture

```
Browser (Ionic/Angular)
  │
  ├── IonicMediaAdapter        captures camera frames (JPEG 320x240) + mic audio (PCM 16kHz)
  │
  ├── LiveStoryFacade          orchestrates session state via Angular Signals
  │                            schedules Web Audio API playback queue
  │                            cuts queued audio immediately on barge-in
  │
  └── FirebaseStorytellingAdapter
        │
        ├── getLiveConfig()    Firebase Function → reads agent config from Firestore
        │
        └── @google/genai SDK ──► Gemini Live API (gemini-2.5-flash-native-audio-latest)
              ai.live.connect()       │
              sendRealtimeInput()     ├── audio/pcm 24kHz response ──► Web Audio API playback
                                      ├── outputTranscription.text ──► saved to Firestore session
                                      └── interrupted signal ──► audio queue cleared instantly
```

**Hexagonal Architecture** — `core/` contains only pure TypeScript interfaces (ports). Angular, Firebase and Gemini details live exclusively in `infrastructure/`.

**Privacy by Design** — raw video frames and audio chunks are processed in-flight and never persisted. Only the text transcript of the model's narration is saved (for the parent review zone).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20 (Signals, Standalone Components) + Ionic 8 |
| Mobile | Capacitor 8 (Android/iOS ready) |
| AI | Gemini Live API via `@google/genai` SDK |
| Multimodal input | PCM 16kHz audio + JPEG video frames via `sendRealtimeInput` |
| Agent config | Firestore (`agents/` collection — hot-swappable) |
| Secrets | Firebase Functions v2 (`getLiveConfig`) |
| Hosting | Firebase Hosting |
| Session history | Firestore (`sessions/` collection — parent review zone) |

---

## Getting started

### Prerequisites
- Node.js 20+
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Functions and Hosting enabled
- A Google AI API key with access to `gemini-2.5-flash-native-audio-latest`

### Setup

```bash
# 1. Clone and install
git clone https://github.com/Cuentopia/cuentopia-live-agent
cd cuentopia-live-agent
npm install

# 2. Configure environment
cp .env.example .env
# Fill in FIREBASE_PROJECT_ID and FIREBASE_STORAGE_BUCKET

# 3. Add the Gemini API key as a Firebase Function secret
firebase functions:secrets:set GOOGLE_GENAI_API_KEY

# 4. Seed Firestore agents + upload theme images to Storage
node scripts/seed-firestore.js

# 5. Run locally
ionic serve
```

### Deploy

```bash
# Full deploy (frontend + functions + firestore rules + indexes)
npm run build && firebase deploy

# Android
npm run build:android   # generates android/, applies permissions via Trapeze
npx cap open android    # opens Android Studio
```

### Local development with emulators

```bash
firebase emulators:start
node scripts/seed-firestore.js --emulator
ionic serve
```

### Add a new agent

Create a document in Firestore under `agents/<your-agent-id>`:

```json
{
  "displayName": "Your Agent Name",
  "model": "models/gemini-2.5-flash-native-audio-latest",
  "voiceName": "Puck",
  "systemPrompt": "...",
  "initialPromptTemplate": "... {topic} ...",
  "visionNudgeText": "...",
  "visionNudgeIntervalSeconds": 12,
  "version": "1.0"
}
```

No redeployment needed. The agent is available immediately after the document is created.

---

## Parent Zone

A PIN-protected section (`/tabs/progress`) lets parents review their child's session history:
- Duration and topic of each session
- Full text transcript of the agent's narration
- Swipe to delete sessions

---

*Submitted to the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).*
