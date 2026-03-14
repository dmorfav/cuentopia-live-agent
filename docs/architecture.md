# Cuentopia Live Agent — Architecture

## Hexagonal Architecture Overview

```mermaid
graph TB
    subgraph PRESENTATION["🖥️ Presentation Layer (Ionic / Angular)"]
        direction LR
        LP["LivePage\nlive.page.ts"]
        EP["ExplorePage\nexplore.page.ts"]
        PP["ProgressPage\nprogress.page.ts"]
    end

    subgraph APPLICATION["⚙️ Application Layer"]
        LSF["LiveStoryFacade\n(Signals · Audio · Vision)"]
    end

    subgraph CORE["🔷 Core Layer — zero external deps"]
        direction LR
        subgraph PORTS["Ports (abstract classes)"]
            STP["StorytellingPort"]
            MCP["MediaCapturePort"]
            SP["SessionPort"]
        end
        subgraph MODELS["Models"]
            M1["LiveContentChunk\n+ visionCapture?"]
            M2["AgentConfig"]
            M3["EmotionState"]
            M4["SessionState"]
            M5["MediaFrame"]
        end
    end

    subgraph INFRA["🔌 Infrastructure Layer (Adapters)"]
        FSA["FirebaseStorytellingAdapter\nimplements StorytellingPort"]
        IMA["IonicMediaAdapter\nimplements MediaCapturePort"]
        FSEA["FirestoreSessionAdapter\nimplements SessionPort"]
        MMA["MockMediaCaptureAdapter\nimplements MediaCapturePort"]
    end

    subgraph DI["🔧 DI Wiring — main.ts only"]
        DI1["StorytellingPort → FirebaseStorytellingAdapter"]
        DI2["MediaCapturePort → IonicMediaAdapter"]
        DI3["SessionPort     → FirestoreSessionAdapter"]
    end

    subgraph EXTERNAL["☁️ External Systems"]
        GLA["Gemini Live API\nWebSocket · gemini-2.5-flash-native-audio-latest"]
        FF["Firebase Functions v2\ngetLiveConfig()"]
        FS["Firestore\nagents · storyThemes · sessions"]
        FAUTH["Firebase Auth\nAnonymous"]
    end

    %% Presentation → Application
    LP -->|"inject(LiveStoryFacade)"| LSF
    PP -->|"inject(SessionPort)"| SP
    EP -->|"Firestore SDK direct\n(storyThemes)"| FS

    %% Application → Ports
    LSF -->|uses| STP
    LSF -->|uses| MCP
    LSF -->|uses| SP

    %% Ports → Adapters (DI at runtime)
    STP -.->|"provided as"| FSA
    MCP -.->|"provided as"| IMA
    MCP -.->|"alt: dev/test"| MMA
    SP  -.->|"provided as"| FSEA

    %% Adapters → External
    FSA -->|"getLiveConfig() HTTPS call"| FF
    FSA -->|"BidiGenerateContent\nWS frames + audio"| GLA
    FSEA -->|"sessions collection"| FS
    FSEA -->|"anonymous uid"| FAUTH
    FF  -->|"reads agent config"| FS

    %% DI note
    DI1 & DI2 & DI3 -.->|declared in| DI

    %% Styles
    classDef pres    fill:#1e3a5f,stroke:#4a9eff,color:#e2f0ff
    classDef app     fill:#1a3a2a,stroke:#4ade80,color:#dcfce7
    classDef core    fill:#2d1b4e,stroke:#a78bfa,color:#ede9fe
    classDef infra   fill:#3a2000,stroke:#f59e0b,color:#fef3c7
    classDef ext     fill:#1a1a2e,stroke:#6366f1,color:#e0e7ff
    classDef di      fill:#1c1c1c,stroke:#6b7280,color:#d1d5db

    class LP,EP,PP pres
    class LSF app
    class STP,MCP,SP,M1,M2,M3,M4,M5 core
    class FSA,IMA,FSEA,MMA infra
    class GLA,FF,FS,FAUTH ext
    class DI1,DI2,DI3 di
```

---

## Real-time Data Flow

```mermaid
sequenceDiagram
    actor Child
    participant LivePage
    participant LiveStoryFacade
    participant IonicMediaAdapter
    participant FirebaseStorytellingAdapter
    participant FirebaseFunctions
    participant GeminiLiveAPI

    Child->>LivePage: tap "Empezar"
    LivePage->>LiveStoryFacade: startStorytelling(name, topic, agentId)
    LiveStoryFacade->>FirebaseStorytellingAdapter: connect(name, topic, agentId)
    FirebaseStorytellingAdapter->>FirebaseFunctions: getLiveConfig(agentId)
    FirebaseFunctions-->>FirebaseStorytellingAdapter: { apiKey, model, systemPrompt, ... }
    FirebaseStorytellingAdapter->>GeminiLiveAPI: WebSocket open + setup message
    FirebaseStorytellingAdapter->>GeminiLiveAPI: sendText(initialPrompt)

    loop Every 1 s
        IonicMediaAdapter->>LiveStoryFacade: MediaFrame (JPEG 320×240)
        LiveStoryFacade->>FirebaseStorytellingAdapter: sendVideoFrame(base64JPEG)
        FirebaseStorytellingAdapter->>GeminiLiveAPI: realtime_input { image/jpeg }
    end

    loop Continuous
        IonicMediaAdapter->>LiveStoryFacade: PCM 16 kHz chunk
        LiveStoryFacade->>FirebaseStorytellingAdapter: sendAudio(base64PCM)
        FirebaseStorytellingAdapter->>GeminiLiveAPI: realtime_input { audio/pcm }
    end

    loop Every 12–20 s (per agent config)
        FirebaseStorytellingAdapter->>GeminiLiveAPI: client_content { image + visionNudgeText }
        FirebaseStorytellingAdapter-->>LiveStoryFacade: LiveContentChunk { visionCapture: true }
        LiveStoryFacade-->>LivePage: isVisionScanning = true (1.5 s halo)
    end

    GeminiLiveAPI-->>FirebaseStorytellingAdapter: serverContent { audio PCM 24 kHz + text }
    FirebaseStorytellingAdapter-->>LiveStoryFacade: LiveContentChunk { audioChunk, text }
    LiveStoryFacade-->>LivePage: plays audio via Web Audio API + updates currentStory
    LivePage-->>Child: narration audio + waveform animation
```

---

## Firestore Collections

```mermaid
erDiagram
    AGENTS {
        string id PK
        string displayName
        string model
        string voiceName
        string systemPrompt
        string initialPromptTemplate
        string visionNudgeText
        number visionNudgeIntervalSeconds
        string version
    }

    STORY_THEMES {
        string id PK
        string agentId FK
        string title
        string subtitle
        string icon
        boolean enabled
        number order
    }

    SESSIONS {
        string id PK
        string userId
        string agentId FK
        string topic
        string storyText
        number durationSeconds
        timestamp startedAt
    }

    AGENTS ||--o{ STORY_THEMES : "narrated by"
    AGENTS ||--o{ SESSIONS : "used in"
```

---

## Agent Roster

| Agent ID | Persona | Voice | Nudge interval |
|---|---|---|---|
| `narrator-onboarding` | Cuentopia (welcome flow) | Puck | 15 s |
| `narrator-default` | Leo, el Cuentista | Puck | 12 s |
| `narrator-fears` | Valentín, el Guardián | Kore | 10 s |
| `narrator-sleep` | Luna, Tejedora de Sueños | Aoede | 20 s |
| `narrator-adventure` | Chispa, la Exploradora | Fenrir | 10 s |
