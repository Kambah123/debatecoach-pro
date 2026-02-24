"""
DebateCoach Pro - Real-Time AI Sparring Partner
Backend FastAPI Application with WebSocket Support
"""

import asyncio
import base64
import json
import logging
import os
import struct
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional, Set
import io

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
import webrtcvad

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# Configuration & Constants
# =============================================================================

class AudioConfig:
    """Audio processing configuration"""
    SAMPLE_RATE = 16000  # 16kHz as required
    CHANNELS = 1
    SAMPLE_WIDTH = 2  # 16-bit PCM
    FRAME_DURATION_MS = 30  # WebRTC VAD frame size
    FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)  # 480 samples
    BYTES_PER_FRAME = FRAME_SIZE * SAMPLE_WIDTH  # 960 bytes

    # Opus codec settings for network transmission
    OPUS_BITRATE = 24000  # 24kbps
    OPUS_APPLICATION = "audio"  # Low delay

class DebatePersona(Enum):
    """Debate opponent personas with distinct characteristics"""
    LION = "lion"              # Aggressive, frequent interruptions
    SOCRATIC = "socratic"      # Moderate, targets logical gaps
    CROSS_EXAMINER = "cross_examiner"  # Rapid-fire burst patterns
    JUDGE = "judge"            # Rare procedural interruptions

PERSONA_CONFIGS = {
    DebatePersona.LION: {
        "name": "The Lion",
        "description": "Aggressive debater that tests your resilience",
        "interruption_interval_ms": (10000, 15000),  # 10-15s
        "response_latency_ms": 200,
        "challenge_types": ["evidence", "strategic", "logical"],
        "voice_speed": 1.3,
        "pedagogical_focus": "resilience_under_pressure",
        "system_prompt": """You are an aggressive, challenging debate opponent. Your goal is to test the user's resilience and ability to think under pressure. Interrupt frequently, speak quickly, and challenge every weak point aggressively. Use phrases like "That's not convincing!", "Source?", "Weak argument!" Be relentless but stay within bounds of formal debate etiquette."""
    },
    DebatePersona.SOCRATIC: {
        "name": "The Socratic Inquisitor",
        "description": "Targets logical gaps with measured precision",
        "interruption_interval_ms": (30000, 45000),  # 30-45s
        "response_latency_ms": 500,
        "challenge_types": ["logical", "evidence"],
        "voice_speed": 1.0,
        "pedagogical_focus": "logical_reasoning",
        "system_prompt": """You are a Socratic debate opponent who targets logical gaps and unsupported assertions. Ask probing questions like "What evidence supports that claim?", "How does that follow from your premise?", "Are you assuming X implies Y?" Be measured and precise. Focus on helping the user identify weaknesses in their own reasoning."""
    },
    DebatePersona.CROSS_EXAMINER: {
        "name": "The Cross-Examiner",
        "description": "Rapid-fire questions that punish evasion",
        "interruption_interval_ms": (5000, 8000),  # 5-8s bursts
        "response_latency_ms": 150,
        "challenge_types": ["strategic", "evidence"],
        "voice_speed": 1.4,
        "pedagogical_focus": "direct_answer_discipline",
        "system_prompt": """You are a rapid-fire cross-examiner. Ask direct, pointed questions in quick succession. Punish evasion immediately. Use patterns like "Yes or no?", "Direct answer, please.", "You're avoiding the question." Be intense but professional. Your goal is to train the user to give direct, concise answers under pressure."""
    },
    DebatePersona.JUDGE: {
        "name": "The Presiding Judge",
        "description": "Formal procedural guidance with rare interruptions",
        "interruption_interval_ms": (60000, 120000),  # 1-2 minutes
        "response_latency_ms": 800,
        "challenge_types": ["procedural"],
        "voice_speed": 0.9,
        "pedagogical_focus": "debate_etiquette",
        "system_prompt": """You are a formal debate judge who rarely interrupts but provides procedural guidance when necessary. Speak formally and authoritatively. When you do interrupt, it's to correct etiquette violations or significant procedural errors. Use phrases like "Point of order.", "The speaker will address the question directly.", "Time management reminder." Focus on teaching proper debate etiquette."""
    }
}

# =============================================================================
# Pydantic Models
# =============================================================================

class ArgumentStructure(BaseModel):
    """Structured argument representation"""
    claim: str
    evidence: List[str]
    warrant: str
    timestamp: float

class FallacyDetection(BaseModel):
    """Detected logical fallacy"""
    fallacy_type: str
    description: str
    transcript_excerpt: str
    timestamp: float
    severity: str  # "low", "medium", "high"

class SpeakingMetrics(BaseModel):
    """Real-time speaking analysis"""
    wpm: float
    filler_word_count: int
    filler_words: Dict[str, int]
    pause_patterns: List[Dict[str, Any]]
    pitch_variation: float
    confidence_score: float

class BiometricData(BaseModel):
    """Video analysis biometric data"""
    eye_contact_percentage: float
    gesture_count: int
    posture_score: float
    attention_score: float

class DebateSessionMetrics(BaseModel):
    """Complete session analytics"""
    session_id: str
    duration_seconds: float
    persona: str

    # Speaking metrics
    avg_wpm: float
    total_filler_words: int
    filler_word_breakdown: Dict[str, int]

    # Interruption metrics
    user_interruptions: int
    ai_interruptions: int
    interruption_ratio: float

    # Argument quality
    arguments_made: List[ArgumentStructure]
    fallacies_detected: List[FallacyDetection]
    argument_cohesion_score: float  # 0-100

    # Evidence quality
    evidence_quality_score: float  # 0-100
    unsupported_claims: int

    # Biometrics
    eye_contact_avg: float
    posture_avg: float

    # Strategic recommendations
    recommendations: List[str]

class TranscriptEntry(BaseModel):
    """Timestamped transcript entry"""
    timestamp: float
    speaker: str  # "user" or "ai"
    text: str
    was_interrupted: bool = False

# =============================================================================
# Audio Processing
# =============================================================================

class AudioProcessor:
    """Handles PCM audio processing and VAD"""

    def __init__(self):
        self.vad = webrtcvad.Vad(2)  # Aggressiveness level 2 (0-3)
        self.sample_rate = AudioConfig.SAMPLE_RATE
        self.frame_duration = AudioConfig.FRAME_DURATION_MS
        self.frame_size = AudioConfig.FRAME_SIZE

    def is_speech(self, audio_frame: bytes) -> bool:
        """Check if audio frame contains speech using WebRTC VAD"""
        try:
            return self.vad.is_speech(audio_frame, self.sample_rate)
        except Exception as e:
            logger.warning(f"VAD error: {e}")
            return False

    def calculate_rms(self, audio_data: bytes) -> float:
        """Calculate RMS energy of audio frame"""
        try:
            samples = np.frombuffer(audio_data, dtype=np.int16)
            if len(samples) == 0:
                return 0.0
            return np.sqrt(np.mean(samples.astype(np.float32) ** 2))
        except Exception as e:
            logger.warning(f"RMS calculation error: {e}")
            return 0.0

    def detect_silence(self, audio_data: bytes, threshold: float = 500.0) -> bool:
        """Detect if audio is silence based on RMS threshold"""
        rms = self.calculate_rms(audio_data)
        return rms < threshold

# =============================================================================
# Speaking Analysis
# =============================================================================

class SpeakingAnalyzer:
    """Analyzes speaking patterns in real-time"""

    FILLER_WORDS = {"um", "uh", "like", "you know", "so", "actually", "basically", "literally"}

    def __init__(self):
        self.word_timestamps: deque = deque(maxlen=1000)
        self.filler_counts: Dict[str, int] = {word: 0 for word in self.FILLER_WORDS}
        self.total_words = 0
        self.speech_start_time: Optional[float] = None
        self.pause_starts: List[float] = []
        self.pauses: List[Dict[str, Any]] = []

    def process_transcript_chunk(self, text: str, timestamp: float):
        """Process a chunk of transcript for analysis"""
        words = text.lower().split()
        self.total_words += len(words)

        for word in words:
            clean_word = word.strip(".,!?;:")
            if clean_word in self.FILLER_WORDS:
                self.filler_counts[clean_word] += 1
            self.word_timestamps.append((timestamp, clean_word))

    def calculate_wpm(self, window_seconds: float = 60.0) -> float:
        """Calculate words per minute over recent window"""
        if not self.word_timestamps:
            return 0.0

        current_time = time.time()
        cutoff_time = current_time - window_seconds

        recent_words = sum(1 for ts, _ in self.word_timestamps if ts > cutoff_time)

        # Calculate actual time span
        recent_timestamps = [ts for ts, _ in self.word_timestamps if ts > cutoff_time]
        if not recent_timestamps:
            return 0.0

        time_span = max(recent_timestamps) - min(recent_timestamps)
        if time_span < 1.0:  # Less than 1 second
            return 0.0

        minutes = time_span / 60.0
        return recent_words / minutes if minutes > 0 else 0.0

    def get_metrics(self) -> SpeakingMetrics:
        """Get current speaking metrics"""
        total_fillers = sum(self.filler_counts.values())
        wpm = self.calculate_wpm()

        # Calculate confidence score based on multiple factors
        filler_ratio = total_fillers / max(self.total_words, 1)
        wpm_score = 1.0 - abs(wpm - 150) / 150  # Optimal around 150 WPM
        wpm_score = max(0.0, min(1.0, wpm_score))

        confidence = (1.0 - filler_ratio) * 0.4 + wpm_score * 0.6

        return SpeakingMetrics(
            wpm=wpm,
            filler_word_count=total_fillers,
            filler_words=self.filler_counts.copy(),
            pause_patterns=self.pauses[-10:],  # Last 10 pauses
            pitch_variation=0.0,  # Would require pitch detection
            confidence_score=confidence * 100
        )

# =============================================================================
# Argument Analysis
# =============================================================================

class ArgumentAnalyzer:
    """Analyzes argument structure and detects fallacies"""

    FALLACY_PATTERNS = {
        "ad_hominem": [
            "you're wrong because you",
            "you can't be right since you",
            "look at your",
            "you always",
            "you never"
        ],
        "straw_man": [
            "so you're saying",
            "what you really mean",
            "you're basically arguing",
            "your position is"
        ],
        "false_dichotomy": [
            "either or",
            "only two options",
            "black and white",
            "you're with us or against us"
        ],
        "slippery_slope": [
            "next thing you know",
            "lead to",
            "gateway to",
            "domino effect"
        ],
        "appeal_to_authority": [
            "experts say",
            "studies show",
            "research proves",
            "everyone knows"
        ]
    }

    def __init__(self):
        self.arguments: List[ArgumentStructure] = []
        self.fallacies: List[FallacyDetection] = []
        self.current_claim: Optional[str] = None
        self.current_evidence: List[str] = []

    def analyze_text(self, text: str, speaker: str, timestamp: float) -> Dict[str, Any]:
        """Analyze text for argument structure and fallacies"""
        text_lower = text.lower()
        results = {
            "fallacies": [],
            "argument_structure": None
        }

        # Detect fallacies
        for fallacy_type, patterns in self.FALLACY_PATTERNS.items():
            for pattern in patterns:
                if pattern in text_lower:
                    fallacy = FallacyDetection(
                        fallacy_type=fallacy_type,
                        description=f"Detected potential {fallacy_type.replace('_', ' ').title()}",
                        transcript_excerpt=text[:100] + "..." if len(text) > 100 else text,
                        timestamp=timestamp,
                        severity="medium"
                    )
                    self.fallacies.append(fallacy)
                    results["fallacies"].append(fallacy)
                    break

        # Simple claim detection (would be enhanced with NLP)
        claim_indicators = ["i believe", "i argue", "my position", "the fact is", "clearly"]
        evidence_indicators = ["because", "since", "given that", "as shown by", "evidence"]

        for indicator in claim_indicators:
            if indicator in text_lower:
                self.current_claim = text
                break

        for indicator in evidence_indicators:
            if indicator in text_lower and self.current_claim:
                self.current_evidence.append(text)
                break

        return results

    def get_argument_cohesion_score(self) -> float:
        """Calculate argument cohesion score (0-100)"""
        if not self.arguments:
            return 50.0  # Neutral baseline

        scores = []
        for arg in self.arguments:
            score = 0.0
            if arg.claim:
                score += 30
            if len(arg.evidence) >= 2:
                score += 40
            elif len(arg.evidence) == 1:
                score += 20
            if arg.warrant:
                score += 30
            scores.append(score)

        return sum(scores) / len(scores) if scores else 50.0

# =============================================================================
# Gemini Live API Integration
# =============================================================================

class GeminiStreamManager:
    """Manages bidirectional streaming with Gemini Live API"""

    def __init__(self, api_key: str, persona: DebatePersona):
        self.api_key = api_key
        self.persona = persona
        self.client = genai.Client(api_key=api_key)
        self.session = None
        self.is_active = False

        # Queues for audio pipeline
        self.audio_in_queue: asyncio.Queue = asyncio.Queue()  # From user
        self.audio_out_queue: asyncio.Queue = asyncio.Queue(maxsize=5)  # To user (backpressure)

        # Interruption handling
        self.interruption_event = asyncio.Event()
        self.current_response_task: Optional[asyncio.Task] = None

        # Metrics
        self.messages_sent = 0
        self.messages_received = 0
        self.interruptions_triggered = 0

    async def initialize(self):
        """Initialize Gemini Live API session"""
        config = PERSONA_CONFIGS[self.persona]

        try:
            # Configure the model with audio modality
            model = "gemini-2.0-flash-exp"

            # Create generation config with speech settings
            generation_config = types.GenerationConfig(
                temperature=0.7,
                max_output_tokens=1024,
            )

            # Configure speech settings based on persona
            speech_config = types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Charon" if self.persona == DebatePersona.JUDGE else "Puck"
                    )
                )
            )

            # Start the live session
            self.session = await self.client.aio.live.connect(
                model=model,
                config=types.LiveConnectConfig(
                    response_modalities=["AUDIO"],
                    speech_config=speech_config,
                    system_instruction=types.Content(
                        parts=[types.Part(text=config["system_prompt"])]
                    )
                )
            )

            self.is_active = True
            logger.info(f"Gemini Live session initialized for persona: {self.persona.value}")

        except Exception as e:
            logger.error(f"Failed to initialize Gemini session: {e}")
            raise

    async def send_audio(self, audio_data: bytes):
        """Send audio to Gemini Live API"""
        if not self.is_active or not self.session:
            return

        try:
            # Convert PCM bytes to proper format for Gemini
            # Gemini expects base64-encoded audio in proper format
            audio_b64 = base64.b64encode(audio_data).decode('utf-8')

            await self.session.send(
                input=types.LiveClientMessage(
                    realtime_input=types.LiveClientRealtimeInput(
                        media_chunks=[
                            types.Blob(
                                mime_type="audio/pcm;rate=16000",
                                data=audio_b64
                            )
                        ]
                    )
                )
            )
            self.messages_sent += 1

        except Exception as e:
            logger.error(f"Error sending audio to Gemini: {e}")

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        """Receive audio from Gemini Live API"""
        if not self.is_active or not self.session:
            return

        try:
            async for response in self.session.receive():
                if self.interruption_event.is_set():
                    logger.info("Interruption detected, stopping audio output")
                    break

                if response.data:
                    # Decode base64 audio data
                    audio_bytes = base64.b64decode(response.data)
                    yield audio_bytes
                    self.messages_received += 1

        except Exception as e:
            logger.error(f"Error receiving audio from Gemini: {e}")

    async def trigger_interruption(self):
        """Trigger interruption - stop current AI output"""
        self.interruption_event.set()
        self.interruptions_triggered += 1

        # Clear the output queue
        while not self.audio_out_queue.empty():
            try:
                self.audio_out_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Reset interruption event after brief delay
        await asyncio.sleep(0.1)
        self.interruption_event.clear()

        logger.info("Interruption handled, queues cleared")

    async def close(self):
        """Close Gemini session"""
        self.is_active = False
        if self.session:
            await self.session.close()
            logger.info("Gemini Live session closed")

# =============================================================================
# WebSocket Connection Manager
# =============================================================================

class DebateConnection:
    """Manages a single debate WebSocket connection"""

    def __init__(self, websocket: WebSocket, session_id: str, persona: DebatePersona, api_key: str):
        self.websocket = websocket
        self.session_id = session_id
        self.persona = persona
        self.api_key = api_key

        # Audio processing
        self.audio_processor = AudioProcessor()
        self.speaking_analyzer = SpeakingAnalyzer()
        self.argument_analyzer = ArgumentAnalyzer()

        # Gemini integration
        self.gemini: Optional[GeminiStreamManager] = None

        # Connection state
        self.is_active = False
        self.start_time: Optional[float] = None

        # Metrics
        self.transcript: List[TranscriptEntry] = []
        self.user_interruptions = 0
        self.ai_interruptions = 0

        # Tasks
        self.receive_task: Optional[asyncio.Task] = None
        self.send_task: Optional[asyncio.Task] = None
        self.interruption_monitor: Optional[asyncio.Task] = None

        # VAD state
        self.is_user_speaking = False
        self.speech_frames_count = 0
        self.silence_frames_count = 0
        self.VAD_THRESHOLD_FRAMES = 3  # Frames to confirm speech
        self.SILENCE_THRESHOLD_FRAMES = 10  # Frames to confirm silence

    async def initialize(self):
        """Initialize the debate connection"""
        self.gemini = GeminiStreamManager(self.api_key, self.persona)
        await self.gemini.initialize()
        self.is_active = True
        self.start_time = time.time()
        logger.info(f"Debate session {self.session_id} initialized with persona {self.persona.value}")

    async def handle_client_message(self, message: bytes):
        """Handle incoming message from client"""
        try:
            # Check message type (first byte indicates type)
            msg_type = message[0] if message else 0

            if msg_type == 0x01:  # Audio data
                audio_data = message[1:]
                await self._process_incoming_audio(audio_data)

            elif msg_type == 0x02:  # Interruption signal
                await self._handle_user_interruption()

            elif msg_type == 0x03:  # Text/transcript
                text = message[1:].decode('utf-8')
                await self._process_transcript(text)

            elif msg_type == 0x04:  # Control command
                await self._handle_control_command(message[1:])

        except Exception as e:
            logger.error(f"Error handling client message: {e}")

    async def _process_incoming_audio(self, audio_data: bytes):
        """Process incoming audio from user"""
        # Run VAD
        is_speech = self.audio_processor.is_speech(audio_data)

        if is_speech:
            self.silence_frames_count = 0
            self.speech_frames_count += 1

            if self.speech_frames_count >= self.VAD_THRESHOLD_FRAMES and not self.is_user_speaking:
                # User started speaking
                self.is_user_speaking = True
                logger.debug("User started speaking")

                # Trigger interruption of AI if speaking
                if self.gemini:
                    await self.gemini.trigger_interruption()
                    self.user_interruptions += 1

        else:
            self.speech_frames_count = 0
            self.silence_frames_count += 1

            if self.silence_frames_count >= self.SILENCE_THRESHOLD_FRAMES and self.is_user_speaking:
                # User stopped speaking
                self.is_user_speaking = False
                logger.debug("User stopped speaking")

        # Send to Gemini if active
        if self.gemini and self.gemini.is_active:
            await self.gemini.send_audio(audio_data)

    async def _handle_user_interruption(self):
        """Handle explicit interruption signal from user"""
        logger.info("User interruption signal received")
        self.user_interruptions += 1

        if self.gemini:
            await self.gemini.trigger_interruption()

        # Notify client
        await self._send_control_message({
            "type": "interruption_ack",
            "speaker": "user",
            "timestamp": time.time()
        })

    async def _process_transcript(self, text: str):
        """Process transcript text for analysis"""
        timestamp = time.time()

        # Add to transcript
        entry = TranscriptEntry(
            timestamp=timestamp,
            speaker="user",
            text=text,
            was_interrupted=False
        )
        self.transcript.append(entry)

        # Update speaking analysis
        self.speaking_analyzer.process_transcript_chunk(text, timestamp)

        # Analyze argument structure
        analysis = self.argument_analyzer.analyze_text(text, "user", timestamp)

        # Send analysis update to client
        await self._send_control_message({
            "type": "analysis_update",
            "speaking_metrics": self.speaking_analyzer.get_metrics().dict(),
            "fallacies_detected": [f.dict() for f in analysis.get("fallacies", [])]
        })

    async def _handle_control_command(self, data: bytes):
        """Handle control commands from client"""
        try:
            command = json.loads(data.decode('utf-8'))
            cmd_type = command.get('type')

            if cmd_type == 'change_persona':
                new_persona = DebatePersona(command.get('persona'))
                await self._change_persona(new_persona)

            elif cmd_type == 'get_metrics':
                await self._send_current_metrics()

            elif cmd_type == 'end_session':
                await self._end_session()

        except Exception as e:
            logger.error(f"Error handling control command: {e}")

    async def _change_persona(self, new_persona: DebatePersona):
        """Change debate persona mid-session"""
        logger.info(f"Changing persona from {self.persona.value} to {new_persona.value}")

        # Close current Gemini session
        if self.gemini:
            await self.gemini.close()

        # Create new session with new persona
        self.persona = new_persona
        self.gemini = GeminiStreamManager(self.api_key, new_persona)
        await self.gemini.initialize()

        # Notify client
        await self._send_control_message({
            "type": "persona_changed",
            "persona": new_persona.value,
            "config": PERSONA_CONFIGS[new_persona]
        })

    async def _send_current_metrics(self):
        """Send current session metrics to client"""
        metrics = {
            "type": "metrics_update",
            "session_duration": time.time() - self.start_time if self.start_time else 0,
            "speaking_metrics": self.speaking_analyzer.get_metrics().dict(),
            "user_interruptions": self.user_interruptions,
            "ai_interruptions": self.ai_interruptions,
            "argument_cohesion_score": self.argument_analyzer.get_argument_cohesion_score()
        }
        await self._send_control_message(metrics)

    async def _send_control_message(self, data: dict):
        """Send control message to client"""
        try:
            msg_bytes = json.dumps(data).encode('utf-8')
            # Control messages start with 0xFF
            await self.websocket.send_bytes(bytes([0xFF]) + msg_bytes)
        except Exception as e:
            logger.error(f"Error sending control message: {e}")

    async def _send_audio_to_client(self, audio_data: bytes):
        """Send audio data to client"""
        try:
            # Audio messages start with 0x01
            await self.websocket.send_bytes(bytes([0x01]) + audio_data)
        except Exception as e:
            logger.error(f"Error sending audio to client: {e}")

    async def _end_session(self):
        """End the debate session"""
        self.is_active = False
        logger.info(f"Ending debate session {self.session_id}")

    async def generate_final_analytics(self) -> DebateSessionMetrics:
        """Generate comprehensive post-debate analytics"""
        speaking_metrics = self.speaking_analyzer.get_metrics()

        # Calculate interruption ratio
        total_interruptions = self.user_interruptions + self.ai_interruptions
        interruption_ratio = (
            self.user_interruptions / total_interruptions
            if total_interruptions > 0 else 0.5
        )

        # Generate strategic recommendations
        recommendations = self._generate_recommendations(speaking_metrics)

        return DebateSessionMetrics(
            session_id=self.session_id,
            duration_seconds=time.time() - self.start_time if self.start_time else 0,
            persona=self.persona.value,
            avg_wpm=speaking_metrics.wpm,
            total_filler_words=speaking_metrics.filler_word_count,
            filler_word_breakdown=speaking_metrics.filler_words,
            user_interruptions=self.user_interruptions,
            ai_interruptions=self.ai_interruptions,
            interruption_ratio=interruption_ratio,
            arguments_made=self.argument_analyzer.arguments,
            fallacies_detected=self.argument_analyzer.fallacies,
            argument_cohesion_score=self.argument_analyzer.get_argument_cohesion_score(),
            evidence_quality_score=70.0,  # Placeholder
            unsupported_claims=sum(1 for a in self.argument_analyzer.arguments if not a.evidence),
            eye_contact_avg=75.0,  # Placeholder for video analysis
            posture_avg=80.0,  # Placeholder for video analysis
            recommendations=recommendations
        )

    def _generate_recommendations(self, metrics: SpeakingMetrics) -> List[str]:
        """Generate strategic recommendations based on performance"""
        recommendations = []

        # Filler word recommendations
        if metrics.filler_word_count > 10:
            top_filler = max(metrics.filler_words.items(), key=lambda x: x[1])
            recommendations.append(
                f"Reduce filler words. You used '{top_filler[0]}' {top_filler[1]} times. "
                "Practice pausing silently instead."
            )

        # Pace recommendations
        if metrics.wpm > 180:
            recommendations.append(
                f"Your speaking pace ({metrics.wpm:.0f} WPM) is quite fast. "
                "Slow down to improve clarity and give judges time to process."
            )
        elif metrics.wpm < 100:
            recommendations.append(
                f"Your speaking pace ({metrics.wpm:.0f} WPM) is slow. "
                "Practice speaking more confidently to maintain engagement."
            )

        # Interruption recommendations
        if self.user_interruptions > self.ai_interruptions * 2:
            recommendations.append(
                "You're interrupting frequently. Work on letting opponents finish "
                "before responding - it shows confidence in your position."
            )

        # Argument quality recommendations
        cohesion = self.argument_analyzer.get_argument_cohesion_score()
        if cohesion < 60:
            recommendations.append(
                "Strengthen your argument structure. Ensure each claim is supported "
                "by evidence and clear warrants. Use the claim-evidence-warrant format."
            )

        # Fallacy recommendations
        if self.argument_analyzer.fallacies:
            fallacy_types = set(f.fallacy_type for f in self.argument_analyzer.fallacies)
            recommendations.append(
                f"Watch for logical fallacies in your arguments. "
                f"Detected: {', '.join(f.replace('_', ' ').title() for f in fallacy_types)}. "
                "Review logical reasoning principles."
            )

        return recommendations if recommendations else ["Good overall performance. Keep practicing!"]

    async def close(self):
        """Clean up resources"""
        self.is_active = False

        if self.gemini:
            await self.gemini.close()

        # Cancel tasks
        for task in [self.receive_task, self.send_task, self.interruption_monitor]:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        logger.info(f"Debate connection {self.session_id} closed")

# =============================================================================
# FastAPI Application
# =============================================================================

# Global state
active_connections: Dict[str, DebateConnection] = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("DebateCoach Pro backend starting...")

    # Verify API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set - API will not function")
    else:
        logger.info("Gemini API key configured")

    yield

    # Cleanup
    logger.info("Shutting down, cleaning up connections...")
    for conn in active_connections.values():
        await conn.close()
    active_connections.clear()

app = FastAPI(
    title="DebateCoach Pro API",
    description="Real-Time AI Sparring Partner Backend",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# HTTP Endpoints
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "active_sessions": len(active_connections),
        "version": "1.0.0"
    }

@app.get("/personas")
async def list_personas():
    """List available debate personas"""
    return {
        "personas": [
            {
                "id": p.value,
                "name": config["name"],
                "description": config["description"],
                "interruption_interval_ms": config["interruption_interval_ms"],
                "response_latency_ms": config["response_latency_ms"],
                "pedagogical_focus": config["pedagogical_focus"]
            }
            for p, config in PERSONA_CONFIGS.items()
        ]
    }

@app.get("/sessions/{session_id}/analytics")
async def get_session_analytics(session_id: str):
    """Get analytics for a completed session"""
    if session_id not in active_connections:
        raise HTTPException(status_code=404, detail="Session not found")

    conn = active_connections[session_id]
    analytics = await conn.generate_final_analytics()
    return analytics.dict()

# =============================================================================
# WebSocket Endpoint
# =============================================================================

@app.websocket("/ws/debate")
async def debate_websocket(
    websocket: WebSocket,
    persona: str = Query(default="socratic"),
    session_id: Optional[str] = None
):
    """
    Main WebSocket endpoint for debate sessions

    Query Parameters:
    - persona: Debate persona (lion, socratic, cross_examiner, judge)
    - session_id: Optional session ID (generated if not provided)
    """
    await websocket.accept()

    # Validate persona
    try:
        persona_enum = DebatePersona(persona.lower())
    except ValueError:
        await websocket.close(code=4000, reason=f"Invalid persona: {persona}")
        return

    # Get API key
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        await websocket.close(code=4001, reason="Gemini API key not configured")
        return

    # Generate session ID
    session_id = session_id or str(uuid.uuid4())

    # Create connection
    conn = DebateConnection(websocket, session_id, persona_enum, api_key)

    try:
        await conn.initialize()
        active_connections[session_id] = conn

        # Send session info to client
        await conn._send_control_message({
            "type": "session_started",
            "session_id": session_id,
            "persona": persona_enum.value,
            "config": PERSONA_CONFIGS[persona_enum]
        })

        # Start background tasks
        conn.receive_task = asyncio.create_task(_receive_from_client(conn))
        conn.send_task = asyncio.create_task(_send_to_client(conn))

        # Wait for tasks
        await asyncio.gather(
            conn.receive_task,
            conn.send_task,
            return_exceptions=True
        )

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Error in debate session {session_id}: {e}")
        try:
            await conn._send_control_message({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        # Generate final analytics
        try:
            analytics = await conn.generate_final_analytics()
            await conn._send_control_message({
                "type": "session_ended",
                "analytics": analytics.dict()
            })
        except Exception as e:
            logger.error(f"Error sending final analytics: {e}")

        # Cleanup
        await conn.close()
        if session_id in active_connections:
            del active_connections[session_id]

async def _receive_from_client(conn: DebateConnection):
    """Background task: receive messages from client"""
    try:
        while conn.is_active:
            message = await conn.websocket.receive_bytes()
            await conn.handle_client_message(message)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"Error receiving from client: {e}")
    finally:
        conn.is_active = False

async def _send_to_client(conn: DebateConnection):
    """Background task: send audio from Gemini to client"""
    try:
        while conn.is_active and conn.gemini:
            # Receive audio from Gemini
            async for audio_chunk in conn.gemini.receive_audio():
                if not conn.is_active:
                    break
                await conn._send_audio_to_client(audio_chunk)

    except Exception as e:
        logger.error(f"Error sending to client: {e}")
    finally:
        conn.is_active = False

# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8080))

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=os.environ.get("DEBUG", "false").lower() == "true",
        log_level="info"
    )
