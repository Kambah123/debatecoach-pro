import { useState, useRef, useCallback, useEffect } from 'react';

// Audio configuration matching backend
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 480; // 30ms at 16kHz
const BUFFER_SIZE = 4096;

interface UseAudioCaptureOptions {
  onAudioData: (audioData: ArrayBuffer) => void;
  onVADChange?: (isSpeaking: boolean) => void;
  vadThreshold?: number;
  silenceThreshold?: number;
}

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  error: Error | null;
}

export function useAudioCapture(options: UseAudioCaptureOptions): UseAudioCaptureReturn {
  const { onAudioData, onVADChange, vadThreshold = 0.01, silenceThreshold = 0.005 } = options;

  const [isCapturing, setIsCapturing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // VAD state
  const speechFramesRef = useRef(0);
  const silenceFramesRef = useRef(0);
  const VAD_THRESHOLD_FRAMES = 3;
  const SILENCE_THRESHOLD_FRAMES = 15;

  // Convert Float32 to Int16 PCM
  const floatTo16BitPCM = useCallback((input: Float32Array): ArrayBuffer => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output.buffer;
  }, []);

  // Calculate RMS level
  const calculateRMS = useCallback((data: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }, []);

  // Process audio data
  const processAudio = useCallback((event: AudioProcessingEvent) => {
    const inputData = event.inputBuffer.getChannelData(0);

    // Calculate audio level for visualization
    const rms = calculateRMS(inputData);
    setAudioLevel(rms);

    // Simple VAD based on RMS
    if (rms > vadThreshold) {
      silenceFramesRef.current = 0;
      speechFramesRef.current++;

      if (speechFramesRef.current >= VAD_THRESHOLD_FRAMES && !isSpeaking) {
        setIsSpeaking(true);
        onVADChange?.(true);
      }
    } else {
      speechFramesRef.current = 0;
      silenceFramesRef.current++;

      if (silenceFramesRef.current >= SILENCE_THRESHOLD_FRAMES && isSpeaking) {
        setIsSpeaking(false);
        onVADChange?.(false);
      }
    }

    // Resample to 16kHz if needed and convert to PCM16
    const pcmData = floatTo16BitPCM(inputData);
    onAudioData(pcmData);
  }, [onAudioData, onVADChange, vadThreshold, isSpeaking, calculateRMS, floatTo16BitPCM]);

  // Start audio capture
  const startCapture = useCallback(async () => {
    try {
      setError(null);

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
      audioContextRef.current = audioContext;

      // Create analyser for visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // Create source node
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Create script processor for raw audio access
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processor.onaudioprocess = processAudio;
      processorNodeRef.current = processor;

      // Connect nodes
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(audioContext.destination);

      setIsCapturing(true);
    } catch (err) {
      console.error('Error starting audio capture:', err);
      setError(err as Error);
      setIsCapturing(false);
    }
  }, [processAudio]);

  // Stop audio capture
  const stopCapture = useCallback(() => {
    // Disconnect processor
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current = null;
    }

    // Disconnect source
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Reset state
    setIsCapturing(false);
    setIsSpeaking(false);
    setAudioLevel(0);
    speechFramesRef.current = 0;
    silenceFramesRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    isCapturing,
    isSpeaking,
    audioLevel,
    startCapture,
    stopCapture,
    error
  };
}
