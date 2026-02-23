import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Mic, MicOff, Play, Square, Activity, AlertTriangle,
  MessageSquare, BarChart3, Settings, Volume2, VolumeX,
  Clock, Zap, Brain, Target, Award
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGeminiStream } from '@/hooks/useGeminiStream';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import {
  DebatePersona,
  SpeakingMetrics,
  FallacyDetection,
  SessionInfo,
  ConnectionStatus,
  DebateStatus
} from '@/types';
import { cn } from '@/lib/utils';

// Persona configurations for UI
const PERSONA_UI_CONFIG = {
  [DebatePersona.LION]: {
    name: 'The Lion',
    description: 'Aggressive - Tests resilience',
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    icon: Zap
  },
  [DebatePersona.SOCRATIC]: {
    name: 'The Socratic',
    description: 'Moderate - Targets logic',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    icon: Brain
  },
  [DebatePersona.CROSS_EXAMINER]: {
    name: 'Cross-Examiner',
    description: 'Rapid-fire - Punishes evasion',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    icon: Target
  },
  [DebatePersona.JUDGE]: {
    name: 'The Judge',
    description: 'Formal - Teaches etiquette',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    icon: Award
  }
};

interface DebateArenaProps {
  backendUrl: string;
}

export function DebateArena({ backendUrl }: DebateArenaProps) {
  // State
  const [selectedPersona, setSelectedPersona] = useState<DebatePersona>(DebatePersona.SOCRATIC);
  const [debateStatus, setDebateStatus] = useState<DebateStatus>('idle');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [speakingMetrics, setSpeakingMetrics] = useState<SpeakingMetrics | null>(null);
  const [fallacies, setFallacies] = useState<FallacyDetection[]>([]);
  const [transcript, setTranscript] = useState<Array<{ speaker: 'user' | 'ai'; text: string; timestamp: number }>>([]);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [interruptionCount, setInterruptionCount] = useState({ user: 0, ai: 0 });
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [finalAnalytics, setFinalAnalytics] = useState<any>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Gemini stream hook
  const {
    connectionStatus,
    isSpeaking: aiSpeaking,
    connect,
    disconnect,
    sendAudio,
    sendInterruption,
    sendTranscript,
    changePersona
  } = useGeminiStream({
    backendUrl,
    persona: selectedPersona,
    onSessionStarted: (info) => {
      setSessionInfo(info);
      setDebateStatus('active');
      startTimer();
    },
    onSpeakingMetrics: (metrics) => {
      setSpeakingMetrics(metrics);
    },
    onFallacyDetected: (fallacy) => {
      setFallacies(prev => [...prev, fallacy]);
    },
    onInterruption: (speaker) => {
      setInterruptionCount(prev => ({
        ...prev,
        [speaker]: prev[speaker as keyof typeof prev] + 1
      }));
    },
    onError: (error) => {
      console.error('Stream error:', error);
      setDebateStatus('idle');
    },
    onSessionEnded: (analytics) => {
      setFinalAnalytics(analytics);
      setShowAnalytics(true);
      setDebateStatus('ended');
      stopTimer();
    }
  });

  // Audio capture hook
  const {
    isCapturing,
    isSpeaking: userSpeaking,
    audioLevel,
    startCapture,
    stopCapture,
    error: audioError
  } = useAudioCapture({
    onAudioData: (audioData) => {
      if (debateStatus === 'active') {
        sendAudio(audioData);
      }
    },
    onVADChange: (isSpeaking) => {
      // VAD change handled internally
    }
  });

  // Timer functions
  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setSessionDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start debate
  const handleStartDebate = async () => {
    setDebateStatus('preparing');
    setTranscript([]);
    setFallacies([]);
    setSessionDuration(0);
    setInterruptionCount({ user: 0, ai: 0 });
    setFinalAnalytics(null);

    try {
      await connect();
      await startCapture();
    } catch (error) {
      console.error('Failed to start debate:', error);
      setDebateStatus('idle');
    }
  };

  // Stop debate
  const handleStopDebate = () => {
    stopCapture();
    disconnect();
    stopTimer();
    setDebateStatus('idle');
  };

  // Handle persona change
  const handlePersonaChange = (value: string) => {
    const newPersona = value as DebatePersona;
    setSelectedPersona(newPersona);
    if (debateStatus === 'active') {
      changePersona(newPersona);
    }
  };

  // Scroll to bottom of transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
      disconnect();
      stopTimer();
    };
  }, []);

  const personaConfig = PERSONA_UI_CONFIG[selectedPersona];
  const PersonaIcon = personaConfig.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              DebateCoach Pro
            </h1>
            <p className="text-slate-400 mt-1">Real-Time AI Sparring Partner</p>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant={connectionStatus === 'connected' ? 'default' : 'secondary'}
              className={cn(
                "px-3 py-1",
                connectionStatus === 'connected' && "bg-green-500/20 text-green-400",
                connectionStatus === 'connecting' && "bg-yellow-500/20 text-yellow-400",
                connectionStatus === 'error' && "bg-red-500/20 text-red-400"
              )}
            >
              <Activity className="w-3 h-3 mr-1" />
              {connectionStatus === 'connected' ? 'Live' : connectionStatus}
            </Badge>

            {debateStatus === 'active' && (
              <Badge variant="outline" className="px-3 py-1">
                <Clock className="w-3 h-3 mr-1" />
                {formatDuration(sessionDuration)}
              </Badge>
            )}
          </div>
        </div>

        {/* Error Alert */}
        {audioError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Microphone access error: {audioError.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Controls & Status */}
          <div className="space-y-6">
            {/* Persona Selection */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Opponent Persona
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  value={selectedPersona}
                  onValueChange={handlePersonaChange}
                  disabled={debateStatus === 'active'}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {Object.values(DebatePersona).map((persona) => {
                      const config = PERSONA_UI_CONFIG[persona];
                      const Icon = config.icon;
                      return (
                        <SelectItem
                          key={persona}
                          value={persona}
                          className="focus:bg-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={cn("w-4 h-4", config.color)} />
                            <span>{config.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                <div className={cn(
                  "mt-4 p-3 rounded-lg border",
                  personaConfig.bgColor,
                  personaConfig.borderColor
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    <PersonaIcon className={cn("w-5 h-5", personaConfig.color)} />
                    <span className={cn("font-semibold", personaConfig.color)}>
                      {personaConfig.name}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400">{personaConfig.description}</p>
                </div>
              </CardContent>
            </Card>

            {/* Control Panel */}
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mic className="w-4 h-4" />
                  Session Control
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {debateStatus === 'idle' || debateStatus === 'ended' ? (
                  <Button
                    onClick={handleStartDebate}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    size="lg"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start Debate
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopDebate}
                    variant="destructive"
                    className="w-full"
                    size="lg"
                  >
                    <Square className="w-4 h-4 mr-2" />
                    End Debate
                  </Button>
                )}

                {debateStatus === 'active' && (
                  <Button
                    onClick={sendInterruption}
                    variant="outline"
                    className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Interrupt AI
                  </Button>
                )}

                {/* Status Indicators */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Microphone</span>
                    <Badge variant={isCapturing ? 'default' : 'secondary'} className={isCapturing ? 'bg-green-500/20 text-green-400' : ''}>
                      {isCapturing ? 'Active' : 'Off'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">You Speaking</span>
                    <Badge variant={userSpeaking ? 'default' : 'secondary'} className={userSpeaking ? 'bg-blue-500/20 text-blue-400' : ''}>
                      {userSpeaking ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">AI Speaking</span>
                    <Badge variant={aiSpeaking ? 'default' : 'secondary'} className={aiSpeaking ? 'bg-purple-500/20 text-purple-400' : ''}>
                      {aiSpeaking ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                </div>

                {/* Audio Level */}
                {isCapturing && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Audio Level</span>
                      <span>{Math.round(audioLevel * 100)}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-100",
                          audioLevel > 0.3 ? "bg-green-500" : "bg-blue-500"
                        )}
                        style={{ width: `${Math.min(audioLevel * 100 * 3, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Interruption Stats */}
            {debateStatus === 'active' && (
              <Card className="bg-slate-900/50 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Interruptions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-400">{interruptionCount.user}</div>
                      <div className="text-xs text-slate-400">Your Interrupts</div>
                    </div>
                    <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-400">{interruptionCount.ai}</div>
                      <div className="text-xs text-slate-400">AI Interrupts</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Center & Right Columns */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="transcript" className="w-full">
              <TabsList className="bg-slate-800/50 border-slate-700">
                <TabsTrigger value="transcript" className="data-[state=active]:bg-slate-700">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Transcript
                </TabsTrigger>
                <TabsTrigger value="metrics" className="data-[state=active]:bg-slate-700">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Real-Time Metrics
                </TabsTrigger>
                <TabsTrigger value="fallacies" className="data-[state=active]:bg-slate-700">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Fallacies
                  {fallacies.length > 0 && (
                    <Badge variant="destructive" className="ml-2 text-xs">
                      {fallacies.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Transcript Tab */}
              <TabsContent value="transcript" className="mt-4">
                <Card className="bg-slate-900/50 border-slate-800 h-[500px]">
                  <CardContent className="p-4">
                    <ScrollArea className="h-full pr-4">
                      {transcript.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-500">
                          <div className="text-center">
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Transcript will appear here</p>
                            <p className="text-sm mt-1">Start a debate to begin</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {transcript.map((entry, index) => (
                            <div
                              key={index}
                              className={cn(
                                "p-3 rounded-lg",
                                entry.speaker === 'user'
                                  ? "bg-blue-500/10 border border-blue-500/20 ml-8"
                                  : "bg-purple-500/10 border border-purple-500/20 mr-8"
                              )}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    entry.speaker === 'user'
                                      ? "border-blue-500/30 text-blue-400"
                                      : "border-purple-500/30 text-purple-400"
                                  )}
                                >
                                  {entry.speaker === 'user' ? 'You' : 'AI'}
                                </Badge>
                                <span className="text-xs text-slate-500">
                                  {new Date(entry.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-sm text-slate-200">{entry.text}</p>
                            </div>
                          ))}
                          <div ref={transcriptEndRef} />
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Metrics Tab */}
              <TabsContent value="metrics" className="mt-4">
                <Card className="bg-slate-900/50 border-slate-800">
                  <CardContent className="p-6 space-y-6">
                    {speakingMetrics ? (
                      <>
                        {/* WPM */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300 flex items-center gap-2">
                              <Activity className="w-4 h-4" />
                              Speaking Pace (WPM)
                            </span>
                            <span className={cn(
                              "font-mono font-bold",
                              speakingMetrics.wpm > 180 ? "text-yellow-400" :
                              speakingMetrics.wpm < 100 ? "text-orange-400" : "text-green-400"
                            )}>
                              {Math.round(speakingMetrics.wpm)}
                            </span>
                          </div>
                          <Progress
                            value={Math.min((speakingMetrics.wpm / 200) * 100, 100)}
                            className="h-2"
                          />
                          <p className="text-xs text-slate-500">
                            Optimal: 120-160 WPM
                          </p>
                        </div>

                        <Separator className="bg-slate-800" />

                        {/* Confidence Score */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300 flex items-center gap-2">
                              <Award className="w-4 h-4" />
                              Confidence Score
                            </span>
                            <span className={cn(
                              "font-mono font-bold",
                              speakingMetrics.confidence_score > 70 ? "text-green-400" :
                              speakingMetrics.confidence_score > 40 ? "text-yellow-400" : "text-red-400"
                            )}>
                              {Math.round(speakingMetrics.confidence_score)}%
                            </span>
                          </div>
                          <Progress
                            value={speakingMetrics.confidence_score}
                            className="h-2"
                          />
                        </div>

                        <Separator className="bg-slate-800" />

                        {/* Filler Words */}
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-300 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4" />
                              Filler Words
                            </span>
                            <Badge variant={speakingMetrics.filler_word_count > 5 ? 'destructive' : 'default'}>
                              {speakingMetrics.filler_word_count} detected
                            </Badge>
                          </div>

                          {Object.entries(speakingMetrics.filler_words).filter(([_, count]) => count > 0).length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                              {Object.entries(speakingMetrics.filler_words)
                                .filter(([_, count]) => count > 0)
                                .map(([word, count]) => (
                                  <div
                                    key={word}
                                    className="flex justify-between items-center p-2 bg-slate-800/50 rounded"
                                  >
                                    <span className="text-slate-400 text-sm">"{word}"</span>
                                    <span className="text-slate-200 font-mono">{count}</span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <p className="text-sm text-green-400">No filler words detected! Great job!</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-slate-500">
                        <div className="text-center">
                          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>Metrics will appear during debate</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Fallacies Tab */}
              <TabsContent value="fallacies" className="mt-4">
                <Card className="bg-slate-900/50 border-slate-800">
                  <CardContent className="p-6">
                    {fallacies.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-slate-500">
                        <div className="text-center">
                          <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No logical fallacies detected</p>
                          <p className="text-sm mt-1">Keep up the good reasoning!</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {fallacies.map((fallacy, index) => (
                          <div
                            key={index}
                            className={cn(
                              "p-4 rounded-lg border",
                              fallacy.severity === 'high' ? "bg-red-500/10 border-red-500/30" :
                              fallacy.severity === 'medium' ? "bg-yellow-500/10 border-yellow-500/30" :
                              "bg-blue-500/10 border-blue-500/30"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <AlertTriangle className={cn(
                                "w-4 h-4",
                                fallacy.severity === 'high' ? "text-red-400" :
                                fallacy.severity === 'medium' ? "text-yellow-400" :
                                "text-blue-400"
                              )} />
                              <span className={cn(
                                "font-semibold",
                                fallacy.severity === 'high' ? "text-red-400" :
                                fallacy.severity === 'medium' ? "text-yellow-400" :
                                "text-blue-400"
                              )}>
                                {fallacy.fallacy_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {fallacy.severity}
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-300 mb-2">{fallacy.description}</p>
                            <div className="p-2 bg-slate-800/50 rounded text-xs text-slate-400 font-mono">
                              "{fallacy.transcript_excerpt}"
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Post-Debate Analytics Modal */}
        {showAnalytics && finalAnalytics && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <Card className="bg-slate-900 border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-auto">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <BarChart3 className="w-6 h-6" />
                  Debate Analysis Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-400">
                      {formatDuration(Math.round(finalAnalytics.duration_seconds))}
                    </div>
                    <div className="text-xs text-slate-400">Duration</div>
                  </div>
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-green-400">
                      {Math.round(finalAnalytics.avg_wpm)}
                    </div>
                    <div className="text-xs text-slate-400">Avg WPM</div>
                  </div>
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-purple-400">
                      {Math.round(finalAnalytics.argument_cohesion_score)}%
                    </div>
                    <div className="text-xs text-slate-400">Argument Quality</div>
                  </div>
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <div className="text-2xl font-bold text-orange-400">
                      {finalAnalytics.total_filler_words}
                    </div>
                    <div className="text-xs text-slate-400">Filler Words</div>
                  </div>
                </div>

                <Separator className="bg-slate-800" />

                {/* Recommendations */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Strategic Recommendations
                  </h3>
                  <div className="space-y-2">
                    {finalAnalytics.recommendations.map((rec: string, index: number) => (
                      <div key={index} className="p-3 bg-slate-800/50 rounded-lg text-sm text-slate-300">
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={() => setShowAnalytics(false)}
                  className="w-full"
                >
                  Close Report
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
