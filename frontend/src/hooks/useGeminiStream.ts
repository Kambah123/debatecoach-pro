import { useState, useRef, useCallback, useEffect } from 'react';
import { DebatePersona, SpeakingMetrics, FallacyDetection, SessionInfo, ConnectionStatus } from '@/types';

// WebSocket message types (binary protocol)
const MSG_TYPE_AUDIO = 0x01;
const MSG_TYPE_INTERRUPTION = 0x02;
const MSG_TYPE_TRANSCRIPT = 0x03;
const MSG_TYPE_CONTROL = 0x04;
const MSG_TYPE_CONTROL_RESPONSE = 0xFF;

interface UseGeminiStreamOptions {
  backendUrl: string;
  persona: DebatePersona;
  onSessionStarted?: (info: SessionInfo) => void;
  onSpeakingMetrics?: (metrics: SpeakingMetrics) => void;
  onFallacyDetected?: (fallacy: FallacyDetection) => void;
  onInterruption?: (speaker: 'user' | 'ai') => void;
  onError?: (error: Error) => void;
  onSessionEnded?: (analytics: any) => void;
}

interface UseGeminiStreamReturn {
  connectionStatus: ConnectionStatus;
  isSpeaking: boolean;
  aiSpeaking: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (audioData: ArrayBuffer) => void;
  sendInterruption: () => void;
  sendTranscript: (text: string) => void;
  changePersona: (persona: DebatePersona) => void;
  getMetrics: () => void;
}

export function useGeminiStream(options: UseGeminiStreamOptions): UseGeminiStreamReturn {
  const {
    backendUrl,
    persona,
    onSessionStarted,
    onSpeakingMetrics,
    onFallacyDetected,
    onInterruption,
    onError,
    onSessionEnded
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  // Initialize AudioContext
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
    }
    return audioContextRef.current;
  }, []);

  // Play audio from queue
  const playNextAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    isPlayingRef.current = true;
    setAiSpeaking(true);

    try {
      const audioData = audioQueueRef.current.shift();
      if (!audioData) return;

      const ctx = initAudioContext();

      // Convert PCM16 to AudioBuffer
      const int16Array = new Int16Array(audioData);
      const float32Array = new Float32Array(int16Array.length);

      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 16000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      source.onended = () => {
        isPlayingRef.current = false;
        if (audioQueueRef.current.length === 0) {
          setAiSpeaking(false);
        } else {
          playNextAudio();
        }
      };

      source.start();
    } catch (error) {
      console.error('Error playing audio:', error);
      isPlayingRef.current = false;
      setAiSpeaking(false);
    }
  }, [initAudioContext]);

  // Queue audio for playback
  const queueAudio = useCallback((audioData: ArrayBuffer) => {
    audioQueueRef.current.push(audioData);
    playNextAudio();
  }, [playNextAudio]);

  // Clear audio queue (for interruptions)
  const clearAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
    if (audioContextRef.current) {
      audioContextRef.current.suspend();
      audioContextRef.current.resume();
    }
    isPlayingRef.current = false;
    setAiSpeaking(false);
  }, []);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    try {
      const wsUrl = `${backendUrl.replace(/^http/, 'ws')}/ws/debate?persona=${persona}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          handleBinaryMessage(event.data);
        } else {
          handleTextMessage(event.data);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
        onError?.(new Error('WebSocket connection error'));
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setConnectionStatus('disconnected');
        wsRef.current = null;
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect:', error);
      setConnectionStatus('error');
      onError?.(error as Error);
    }
  }, [backendUrl, persona, onError]);

  // Handle binary messages
  const handleBinaryMessage = useCallback((data: ArrayBuffer) => {
    const view = new DataView(data);
    const msgType = view.getUint8(0);
    const payload = data.slice(1);

    switch (msgType) {
      case MSG_TYPE_AUDIO:
        // AI audio response
        queueAudio(payload);
        break;

      case MSG_TYPE_CONTROL_RESPONSE:
        // Control message response
        try {
          const text = new TextDecoder().decode(payload);
          const message = JSON.parse(text);
          handleControlMessage(message);
        } catch (error) {
          console.error('Error parsing control message:', error);
        }
        break;

      default:
        console.warn('Unknown message type:', msgType);
    }
  }, [queueAudio]);

  // Handle text messages (fallback)
  const handleTextMessage = useCallback((data: string) => {
    try {
      const message = JSON.parse(data);
      handleControlMessage(message);
    } catch (error) {
      console.error('Error parsing text message:', error);
    }
  }, []);

  // Handle control messages
  const handleControlMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'session_started':
        sessionIdRef.current = message.session_id;
        onSessionStarted?.({
          session_id: message.session_id,
          persona: message.persona,
          config: message.config
        });
        break;

      case 'interruption_ack':
        clearAudioQueue();
        onInterruption?.(message.speaker);
        break;

      case 'analysis_update':
        if (message.speaking_metrics) {
          onSpeakingMetrics?.(message.speaking_metrics);
        }
        if (message.fallacies_detected) {
          message.fallacies_detected.forEach((fallacy: FallacyDetection) => {
            onFallacyDetected?.(fallacy);
          });
        }
        break;

      case 'metrics_update':
        if (message.speaking_metrics) {
          onSpeakingMetrics?.(message.speaking_metrics);
        }
        break;

      case 'persona_changed':
        // Persona change acknowledged
        break;

      case 'session_ended':
        onSessionEnded?.(message.analytics);
        break;

      case 'error':
        onError?.(new Error(message.message));
        break;

      default:
        console.log('Unknown control message:', message.type);
    }
  }, [onSessionStarted, onInterruption, onSpeakingMetrics, onFallacyDetected, onSessionEnded, onError, clearAudioQueue]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    clearAudioQueue();
    setConnectionStatus('disconnected');
  }, [clearAudioQueue]);

  // Send audio data
  const sendAudio = useCallback((audioData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = new Uint8Array(1 + audioData.byteLength);
      message[0] = MSG_TYPE_AUDIO;
      message.set(new Uint8Array(audioData), 1);
      wsRef.current.send(message);
    }
  }, []);

  // Send interruption signal
  const sendInterruption = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = new Uint8Array([MSG_TYPE_INTERRUPTION]);
      wsRef.current.send(message);
      clearAudioQueue();
    }
  }, [clearAudioQueue]);

  // Send transcript
  const sendTranscript = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(text);
      const message = new Uint8Array(1 + textBytes.length);
      message[0] = MSG_TYPE_TRANSCRIPT;
      message.set(textBytes, 1);
      wsRef.current.send(message);
    }
  }, []);

  // Change persona
  const changePersona = useCallback((newPersona: DebatePersona) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const command = {
        type: 'change_persona',
        persona: newPersona
      };
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(JSON.stringify(command));
      const message = new Uint8Array(1 + textBytes.length);
      message[0] = MSG_TYPE_CONTROL;
      message.set(textBytes, 1);
      wsRef.current.send(message);
    }
  }, []);

  // Get metrics
  const getMetrics = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const command = { type: 'get_metrics' };
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(JSON.stringify(command));
      const message = new Uint8Array(1 + textBytes.length);
      message[0] = MSG_TYPE_CONTROL;
      message.set(textBytes, 1);
      wsRef.current.send(message);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [disconnect]);

  return {
    connectionStatus,
    isSpeaking,
    aiSpeaking,
    connect,
    disconnect,
    sendAudio,
    sendInterruption,
    sendTranscript,
    changePersona,
    getMetrics
  };
}
