# DebateCoach Pro - Real-Time AI Sparring Partner

A production-ready debate training platform using FastAPI, React, and Google Gemini Live API with true bidirectional interruption mechanics (<300ms latency), deployed on Google Cloud Run.

![DebateCoach Pro](docs/architecture-diagram.png)

## Overview

DebateCoach Pro is an AI-powered debate training platform that provides real-time sparring with configurable AI opponents. It features:

- **Bidirectional Interruption**: Both user and AI can interrupt each other with <300ms latency
- **4 Debate Personas**: Lion (aggressive), Socratic (logical), Cross-Examiner (rapid-fire), Judge (procedural)
- **Real-Time Analysis**: Speaking metrics, filler word detection, argument structure analysis
- **Post-Debate Analytics**: Comprehensive performance reports with strategic recommendations

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEBATECOACH PRO                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐         WebSocket (Binary)         ┌─────────────┐│
│  │   React Frontend    │◄──────────────────────────────────►│ FastAPI     ││
│  │   - WebRTC Audio    │                                    │ Backend     ││
│  │   - Real-time UI    │                                    │             ││
│  │   - Metrics Viz     │                                    │ - Queue Mgmt││
│  └─────────────────────┘                                    │ - VAD       ││
│           ▲                                                 │ - Analysis  ││
│           │                                                 └──────┬──────┘│
│           │                                                        │       │
│    ┌──────┴──────┐                                          ┌──────▼──────┐│
│    │  WebRTC     │                                          │ Gemini Live ││
│    │  Audio Cap  │                                          │ API         ││
│    └─────────────┘                                          └─────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

### Backend
- **Framework**: FastAPI with native WebSocket support
- **Language**: Python 3.11+
- **AI**: Google Gemini Live API (gemini-2.0-flash-exp)
- **Audio**: WebRTC VAD, PCM 16-bit 16kHz, Opus codec
- **Deployment**: Google Cloud Run

### Frontend
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **UI**: Tailwind CSS, shadcn/ui
- **Audio**: WebRTC Audio API
- **Deployment**: Google Cloud Run / Firebase Hosting

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker & Docker Compose (optional)
- Google Cloud SDK (for deployment)
- Gemini API Key

### Local Development

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/debatecoach-pro.git
cd debatecoach-pro
```

2. **Set up environment variables**
```bash
export GEMINI_API_KEY="your-gemini-api-key"
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
```

3. **Run with Docker Compose**
```bash
docker-compose up --build
```

4. **Access the application**
- Frontend: http://localhost:3000
- Backend: http://localhost:8080
- Health Check: http://localhost:8080/health

### Manual Setup

#### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Deployment

### Google Cloud Run

1. **Authenticate with GCP**
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

2. **Run deployment script**
```bash
./deploy.sh YOUR_PROJECT_ID
```

This will deploy:
- Backend service with WebSocket support
- Frontend service with nginx
- Configure CORS and session affinity

### Manual Cloud Run Deployment

#### Backend
```bash
cd backend
gcloud builds submit --tag gcr.io/PROJECT_ID/debatecoach-backend
gcloud run deploy debatecoach-backend \
    --image gcr.io/PROJECT_ID/debatecoach-backend \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --memory 2Gi \
    --cpu 2 \
    --max-instances 10 \
    --session-affinity \
    --set-env-vars "GEMINI_API_KEY=your-key"
```

#### Frontend
```bash
cd frontend
gcloud builds submit --tag gcr.io/PROJECT_ID/debatecoach-frontend
gcloud run deploy debatecoach-frontend \
    --image gcr.io/PROJECT_ID/debatecoach-frontend \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated
```

## Features

### Debate Personas

| Persona | Interruption | Focus | Style |
|---------|--------------|-------|-------|
| **Lion** | 10-15s | Resilience | Aggressive, fast |
| **Socratic** | 30-45s | Logic | Measured, probing |
| **Cross-Examiner** | 5-8s bursts | Directness | Rapid-fire |
| **Judge** | 1-2min | Etiquette | Formal, procedural |

### Real-Time Metrics

- **Speaking Pace**: Words per minute (WPM)
- **Filler Words**: Count and breakdown (um, uh, like, etc.)
- **Confidence Score**: Multi-factor algorithm
- **Interruption Tracking**: User vs AI ratio

### Argument Analysis

- **Claim-Evidence-Warrant**: Structure visualization
- **Fallacy Detection**: Ad hominem, straw man, false dichotomy, etc.
- **Evidence Quality**: Assessment of supporting claims
- **Strategic Recommendations**: Personalized improvement tips

## API Reference

### WebSocket Endpoint
```
ws://localhost:8080/ws/debate?persona=socratic
```

Query Parameters:
- `persona`: lion, socratic, cross_examiner, judge
- `session_id`: Optional session identifier

### Binary Protocol

| Message Type | Byte | Description |
|--------------|------|-------------|
| Audio Data | 0x01 | PCM 16-bit audio frames |
| Interruption | 0x02 | Interruption signal |
| Transcript | 0x03 | Text transcript |
| Control | 0x04 | Control commands |
| Control Response | 0xFF | Server responses |

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/personas` | GET | List available personas |
| `/sessions/{id}/analytics` | GET | Session analytics |

## Configuration

### Environment Variables

#### Backend
```env
PORT=8080
GEMINI_API_KEY=your-api-key
GOOGLE_CLOUD_PROJECT=your-project
LOG_LEVEL=INFO
DEBUG=false
```

#### Frontend
```env
VITE_BACKEND_URL=http://localhost:8080
```

## Performance Targets

| Metric | Target |
|--------|--------|
| End-to-end latency | <300ms |
| Interruption response | <200ms |
| Audio streaming | PCM 16-bit 16kHz |
| WebSocket overhead | 2-14 bytes (binary) |

## Security

- API keys stored in Google Secret Manager
- CORS configured for production domains
- No audio storage without explicit consent
- FERPA/COPPA compliant for educational use

## Project Structure

```
.
├── backend/             # FastAPI Backend
├── frontend/            # React Frontend
├── docs/                # Documentation & Assets
├── .env.example         # Environment Template
├── .gitignore           # Git Ignored Files
├── deploy.sh            # Deployment Script
├── docker-compose.yml   # Docker Orchestration
├── LICENSE              # MIT License
└── README.md            # Project Overview
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Google Gemini Live API for real-time AI capabilities
- WebRTC for audio processing
- FastAPI for high-performance WebSocket support
- shadcn/ui for beautiful React components

## Support

For issues and feature requests, please use GitHub Issues.

---

**Built for the Google Gemini API Competition**
