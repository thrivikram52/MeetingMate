import { useState, useEffect, useRef } from 'react';
import { Button } from "./components/ui/button";
import { 
  Mic, 
  MicOff, 
  Send, 
  Pause, 
  Play, 
  Brain, 
  HelpCircle, 
  CheckCircle2, 
  Lightbulb,
  MessageCircle,
  Download 
} from 'lucide-react';

// Voice Wave Component
const VoiceWave = ({ audioLevel, isPaused }) => {
  const bars = 20; // Number of bars in the wave
  
  return (
    <div className="flex items-center justify-center gap-1 h-8">
      {[...Array(bars)].map((_, i) => {
        // When paused, all bars should be at minimum height
        const height = isPaused ? 4 : Math.max(4, Math.min(32, audioLevel * 100 * (1 + Math.sin(i / bars * Math.PI))));
        return (
          <div
            key={i}
            className={`w-1 rounded-full transition-all duration-50 ${isPaused ? 'bg-gray-300' : 'bg-blue-500'}`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
};

// Conversation Block Component
const ConversationBlock = ({ transcript, confidence, aiResponse, isLatest, isVoiceInput = true, timestamp }) => {
  return (
    <div className={`p-4 rounded-lg mb-4 ${isLatest ? 'bg-blue-50' : 'bg-gray-50'}`}>
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isVoiceInput ? (
              <Mic className="w-4 h-4 text-blue-500" />
            ) : (
              <MessageCircle className="w-4 h-4 text-blue-500" />
            )}
            <span className="font-medium">You {isVoiceInput ? 'said' : 'typed'}:</span>
          </div>
          <span className="text-sm text-gray-500">{timestamp}</span>
        </div>
        <p className="mt-1 text-gray-700">{transcript}</p>
        {confidence && (
          <p className="text-xs text-gray-500 mt-1">
            Confidence: {(confidence * 100).toFixed(1)}%
          </p>
        )}
      </div>
      
      {aiResponse && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-500" />
            <span className="font-medium">AI Response:</span>
          </div>
          
          {aiResponse.questions?.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-4 h-4 text-orange-500" />
                <p className="font-medium text-sm text-gray-600">Questions to Consider:</p>
              </div>
              <ul className="list-none space-y-2">
                {aiResponse.questions.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-orange-500 mt-1">•</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {aiResponse.answers?.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <p className="font-medium text-sm text-gray-600">Key Insights:</p>
              </div>
              <ul className="list-none space-y-2">
                {aiResponse.answers.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-green-500 mt-1">•</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {aiResponse.suggestions?.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                <p className="font-medium text-sm text-gray-600">Suggestions:</p>
              </div>
              <ul className="list-none space-y-2">
                {aiResponse.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-yellow-500 mt-1">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscriptionPaused, setIsTranscriptionPaused] = useState(false);
  const [isLLMPaused, setIsLLMPaused] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [conversations, setConversations] = useState([]);
  const [error, setError] = useState(null);
  const [currentAudioLevel, setCurrentAudioLevel] = useState(0);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const conversationsEndRef = useRef(null);

  // Add recording state ref at component level
  const isRecordingRef = useRef(false);

  const scrollToBottom = () => {
    conversationsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversations]);

  useEffect(() => {
    const connectWebSocket = () => {
      console.log('Attempting to connect to WebSocket...');
      wsRef.current = new WebSocket('ws://localhost:3000');

      // Enable ping-pong handling
      wsRef.current.onopen = () => {
        console.log('WebSocket connection established successfully');
        setError(null); // Clear any previous connection errors
        
        // Set up automatic pong responses
        wsRef.current.addEventListener('ping', () => {
          console.log('Received ping from server');
          if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.pong();
            console.log('Sent pong to server');
          }
        });
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Unable to connect to server. Please ensure the server is running on port 3000.');
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        setError('Connection to server lost. Attempting to reconnect...');
        
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current.onmessage = (event) => {
        try {
          // Check if the data is a binary message (audio data)
          if (event.data instanceof Blob) {
            return; // Skip processing binary messages
          }

          const data = JSON.parse(event.data);
          console.log('Received WebSocket message:', data);
          
          if (data.type === 'transcript' && data.isFinal) {
            console.log('Processing final transcript:', data.data);
            const newConversation = {
              transcript: data.data,
              confidence: data.confidence,
              aiResponse: null,
              isVoiceInput: true,
              timestamp: new Date().toLocaleTimeString('en-IN', { 
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true 
              })
            };
            setConversations(prev => [...prev, newConversation]);

            if (!isLLMPaused) {
              const llmRequest = {
                type: 'process_llm',
                data: data.data
              };
              wsRef.current?.send(JSON.stringify(llmRequest));
            }
          } else if (data.type === 'llm_response') {
            setConversations(prev => {
              const updated = [...prev];
              if (updated.length > 0) {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  aiResponse: data.data
                };
              }
              return updated;
            });
          } else if (data.type === 'error') {
            console.error('Server error:', data);
            // Only show UI error for non-audio processing errors
            if (!data.message?.toLowerCase().includes('processing audio')) {
              setError(data.message || 'An error occurred');
              // Clear non-critical errors after 5 seconds
              setTimeout(() => setError(null), 5000);
            }
          }
        } catch (e) {
          console.error('Error handling WebSocket message:', e);
          // Don't show parse errors to the user
          if (!e.message.includes('JSON')) {
            setError('Error handling server message: ' + e.message);
          }
        }
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Add effect to notify server when transcription pause state changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Sending transcription pause state:', isTranscriptionPaused);
      wsRef.current.send(JSON.stringify({
        type: 'pause_transcription',
        pause: isTranscriptionPaused
      }));
      
      // If paused, disconnect audio nodes
      if (isTranscriptionPaused) {
        setCurrentAudioLevel(0);
        // Disconnect audio nodes but keep them in memory
        if (sourceNodeRef.current) {
          sourceNodeRef.current.disconnect();
        }
        if (processorRef.current) {
          processorRef.current.disconnect();
        }
        // Stop the current STT stream to ensure clean state
        wsRef.current.send(JSON.stringify({
          type: 'stop_stream'
        }));
      } else {
        // When resuming, reconnect existing audio nodes if they exist
        if (sourceNodeRef.current && processorRef.current && audioContextRef.current) {
          sourceNodeRef.current.connect(processorRef.current);
          processorRef.current.connect(audioContextRef.current.destination);
          // Send message to reinitialize the stream
          wsRef.current.send(JSON.stringify({
            type: 'start_stream'
          }));
        }
      }
    }
  }, [isTranscriptionPaused]);

  const startRecording = async () => {
    try {
      setError(null);
      setCurrentAudioLevel(0);

      // First check if WebSocket is connected
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket connection is not open');
      }

      // Clean up any existing audio context and stream
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }

      // Get microphone permission first
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Store the stream
      streamRef.current = stream;

      // Create and initialize audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
        channelCount: 1,
        latencyHint: 'interactive'
      });
      
      // Resume the audio context (needed for Safari)
      await audioContext.resume();
      audioContextRef.current = audioContext;

      // Create audio nodes
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      // Set up audio processor
      processor.onaudioprocess = (e) => {
        // If not recording or transcription is paused, just update UI and return
        if (!isRecordingRef.current || isTranscriptionPaused) {
          setCurrentAudioLevel(0);
          return;  // Early return to prevent any audio processing
        }

        try {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Calculate audio level
          const audioLevel = Math.sqrt(inputData.reduce((acc, val) => acc + val * val, 0) / inputData.length);
          setCurrentAudioLevel(audioLevel);
          
          // Skip silent audio
          if (audioLevel < 0.005) {
            return;
          }

          // Check WebSocket connection
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, skipping audio processing');
            return;
          }

          // Process audio data
          const pcmBuffer = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            pcmBuffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }

          // Create WAV header
          const wavHeader = new ArrayBuffer(44);
          const view = new DataView(wavHeader);
          
          // Write WAV header
          writeString(view, 0, 'RIFF');
          view.setUint32(4, 36 + pcmBuffer.length * 2, true);
          writeString(view, 8, 'WAVE');
          writeString(view, 12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, 16000, true);
          view.setUint32(28, 32000, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          writeString(view, 36, 'data');
          view.setUint32(40, pcmBuffer.length * 2, true);

          // Combine buffers and send
          const combinedBuffer = new Uint8Array(wavHeader.byteLength + pcmBuffer.buffer.byteLength);
          combinedBuffer.set(new Uint8Array(wavHeader), 0);
          combinedBuffer.set(new Uint8Array(pcmBuffer.buffer), wavHeader.byteLength);
          
          wsRef.current.send(combinedBuffer);

        } catch (err) {
          console.error('Audio processing error:', err);
          // Don't show audio processing errors in UI
          // Just log to console for debugging
        }
      };

      // Connect audio nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      // Update recording state
      isRecordingRef.current = true;
      setIsRecording(true);

      // Notify server of recording state
      wsRef.current.send(JSON.stringify({
        type: 'recording_state',
        isRecording: true
      }));

      // Also send initial transcription pause state
      wsRef.current.send(JSON.stringify({
        type: 'pause_transcription',
        pause: isTranscriptionPaused
      }));

      console.log('Recording started successfully');

    } catch (error) {
      console.error('Error starting recording:', error);
      setError(`Error starting recording: ${error.message}`);
      
      // Clean up any partial setup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // Reset recording states
      isRecordingRef.current = false;
      setIsRecording(false);
      
      // Notify server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'recording_state',
          isRecording: false
        }));
      }
    }
  };

  const stopRecording = () => {
    // Update recording states first
    isRecordingRef.current = false;
    setIsRecording(false);
    
    // Disconnect audio nodes
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Reset other states
    setIsTranscriptionPaused(false);
    setIsLLMPaused(false);
    setCurrentAudioLevel(0);
    
    // Notify server last
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'recording_state',
        isRecording: false
      }));
    }
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;

    const text = textInput.trim();
    console.log('Submitting text input:', text);
    setTextInput('');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Add a new conversation block for the text input
      const newConversation = {
        transcript: text,
        aiResponse: { questions: [], answers: [], suggestions: [] },
        isVoiceInput: false,
        timestamp: new Date().toLocaleTimeString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true 
        })
      };
      console.log('Adding new conversation:', newConversation);
      setConversations(prev => [...prev, newConversation]);

      // Send text input
      const textMessage = {
        type: 'text_input',
        data: text
      };
      console.log('Sending text input:', textMessage);
      wsRef.current.send(JSON.stringify(textMessage));

      // If LLM is not paused, request LLM processing
      if (!isLLMPaused) {
        console.log('Sending for LLM processing:', text);
        setTimeout(() => {
          const llmRequest = {
            type: 'process_llm',
            data: text
          };
          console.log('Sending LLM request:', llmRequest);
          wsRef.current.send(JSON.stringify(llmRequest));
        }, 100); // Small delay to ensure transcript is processed first
      } else {
        console.log('LLM processing is paused, skipping LLM request');
      }
    } else {
      console.error('WebSocket is not connected');
      setError('WebSocket connection is not open');
    }
  };

  // Helper function to write strings to DataView
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const exportTranscriptionsOnly = () => {
    const transcriptData = conversations.map(conv => ({
      timestamp: conv.timestamp,
      type: conv.isVoiceInput ? 'voice' : 'text',
      transcript: conv.transcript
    }));

    const blob = new Blob([JSON.stringify(transcriptData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcriptions-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportFullConversation = () => {
    const fullData = conversations.map(conv => ({
      timestamp: conv.timestamp,
      type: conv.isVoiceInput ? 'voice' : 'text',
      transcript: conv.transcript,
      confidence: conv.confidence,
      aiResponse: conv.aiResponse
    }));

    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `full-conversation-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Add a health check for the audio context
  useEffect(() => {
    let healthCheckInterval;
    
    if (isRecording) {
      healthCheckInterval = setInterval(() => {
        if (audioContextRef.current?.state !== 'running') {
          console.warn('AudioContext is not running, state:', audioContextRef.current?.state);
          setError('Audio processing stopped. Please restart recording.');
          stopRecording();
        }
      }, 5000);
    }
    
    return () => {
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
      }
    };
  }, [isRecording]);

  // Add cleanup on unmount
  useEffect(() => {
    return () => {
      // Ensure we stop recording and notify server when component unmounts
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex justify-between items-center mb-8 bg-white p-4 rounded-lg shadow-sm sticky top-0 z-10">
          <h1 className="text-2xl font-bold">MeetingMate</h1>
          <div className="flex gap-4 items-center">
            {conversations.length > 0 && (
              <>
                <Button
                  onClick={exportTranscriptionsOnly}
                  variant="outline"
                  className="bg-green-50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export Transcripts
                </Button>
                <Button
                  onClick={exportFullConversation}
                  variant="outline"
                  className="bg-blue-50"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export Full Data
                </Button>
              </>
            )}
            {isRecording && (
              <>
                <VoiceWave 
                  audioLevel={currentAudioLevel} 
                  isPaused={isTranscriptionPaused}
                />
                <Button
                  onClick={() => setIsTranscriptionPaused(!isTranscriptionPaused)}
                  variant="outline"
                  className={isTranscriptionPaused ? "bg-yellow-50" : ""}
                >
                  {isTranscriptionPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                  {isTranscriptionPaused ? "Resume Transcription" : "Pause Transcription"}
                </Button>
                <Button
                  onClick={() => setIsLLMPaused(!isLLMPaused)}
                  variant="outline"
                  className={isLLMPaused ? "bg-yellow-50" : ""}
                >
                  <Brain className="mr-2 h-4 w-4" />
                  {isLLMPaused ? "Resume LLM" : "Pause LLM"}
                </Button>
              </>
            )}
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              variant={isRecording ? "destructive" : "default"}
            >
              {isRecording ? <MicOff className="mr-2" /> : <Mic className="mr-2" />}
              {isRecording ? "Stop Recording" : "Start Recording"}
            </Button>
          </div>
        </header>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Status Bar */}
        {isRecording && (
          <div className="bg-white p-2 rounded-lg shadow-sm mb-4 flex justify-center gap-8">
            <span className={`flex items-center ${isTranscriptionPaused ? 'text-yellow-600' : 'text-green-600'}`}>
              <Mic className="mr-2 h-4 w-4" />
              {isTranscriptionPaused ? 'Transcription Paused' : 'Transcription Active'}
            </span>
            <span className={`flex items-center ${isLLMPaused ? 'text-yellow-600' : 'text-green-600'}`}>
              <Brain className="mr-2 h-4 w-4" />
              {isLLMPaused ? 'LLM Processing Paused' : 'LLM Processing Active'}
            </span>
          </div>
        )}

        {/* Conversation Flow */}
        <div className="space-y-6 mb-24">
          {conversations.map((conv, index) => (
            <ConversationBlock
              key={index}
              transcript={conv.transcript}
              confidence={conv.confidence}
              aiResponse={conv.aiResponse}
              isLatest={index === conversations.length - 1}
              isVoiceInput={conv.isVoiceInput}
              timestamp={conv.timestamp}
            />
          ))}
          <div ref={conversationsEndRef} />
        </div>

        {/* Text Input */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
          <form onSubmit={handleTextSubmit} className="container mx-auto flex gap-4">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button type="submit">
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App; 