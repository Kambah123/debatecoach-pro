// DebateCoach Pro - TypeScript Type Definitions

export enum DebatePersona {
  LION = 'lion',
  SOCRATIC = 'socratic',
  CROSS_EXAMINER = 'cross_examiner',
  JUDGE = 'judge'
}

export interface PersonaConfig {
  name: string;
  description: string;
  interruption_interval_ms: [number, number];
  response_latency_ms: number;
  challenge_types: string[];
  voice_speed: number;
  pedagogical_focus: string;
  system_prompt: string;
}

export interface SpeakingMetrics {
  wpm: number;
  filler_word_count: number;
  filler_words: Record<string, number>;
  pause_patterns: Array<{
    start: number;
    duration: number;
  }>;
  pitch_variation: number;
  confidence_score: number;
}

export interface BiometricData {
  eye_contact_percentage: number;
  gesture_count: number;
  posture_score: number;
  attention_score: number;
}

export interface FallacyDetection {
  fallacy_type: string;
  description: string;
  transcript_excerpt: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high';
}

export interface ArgumentStructure {
  claim: string;
  evidence: string[];
  warrant: string;
  timestamp: number;
}

export interface TranscriptEntry {
  timestamp: number;
  speaker: 'user' | 'ai';
  text: string;
  was_interrupted: boolean;
}

export interface DebateSessionMetrics {
  session_id: string;
  duration_seconds: number;
  persona: string;
  avg_wpm: number;
  total_filler_words: number;
  filler_word_breakdown: Record<string, number>;
  user_interruptions: number;
  ai_interruptions: number;
  interruption_ratio: number;
  arguments_made: ArgumentStructure[];
  fallacies_detected: FallacyDetection[];
  argument_cohesion_score: number;
  evidence_quality_score: number;
  unsupported_claims: number;
  eye_contact_avg: number;
  posture_avg: number;
  recommendations: string[];
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export interface SessionInfo {
  session_id: string;
  persona: DebatePersona;
  config: PersonaConfig;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type DebateStatus = 'idle' | 'preparing' | 'active' | 'paused' | 'ended';
