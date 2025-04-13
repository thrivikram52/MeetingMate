const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const GoogleSTTService = require('../Services/STTGoogleService');
const LLMService = require('../Services/LLMOpenAIService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('🟢 New client connected');
    let sttService = null;
    let llmService = null;
    let isTranscriptionPaused = false;
    let isLLMPaused = false;
    let pendingLLMRequests = 0;

    const initializeServices = () => {
        console.log('📡 Initializing services...');
        if (!sttService) {
            console.log('🎤 Creating new STT service');
            sttService = new GoogleSTTService();
            
            sttService.on('endOfSpeech', () => {
                console.log('🎤 End of speech detected');
                // Optional: You can add additional handling here
            });

            sttService.on('partial', (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.log('🗣️  Partial transcript:', data.text);
                    ws.send(JSON.stringify({ 
                        type: 'transcript', 
                        data: data.text,
                        isFinal: false 
                    }));
                }
            });

            sttService.on('final', async (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    console.log('📝 Final transcript:', data.text);
                    ws.send(JSON.stringify({ 
                        type: 'transcript', 
                        data: data.text,
                        confidence: data.confidence,
                        isFinal: true 
                    }));
                    
                    if (!isLLMPaused && llmService && data.text.trim()) {
                        console.log('🤖 Processing with LLM...');
                        pendingLLMRequests++;
                        try {
                            const llmResponse = await llmService.processText(data.text);
                            pendingLLMRequests--;
                            
                            if (ws.readyState === WebSocket.OPEN) {
                                console.log('✨ Sending LLM response to client:', llmResponse);
                                ws.send(JSON.stringify({ 
                                    type: 'llm_response', 
                                    data: llmResponse
                                }));
                            }
                        } catch (error) {
                            pendingLLMRequests--;
                            console.error('❌ LLM processing error:', error);
                            
                            // Check if it's a rate limit error
                            if (error.response?.status === 429) {
                                console.log('⏳ Rate limit hit, waiting before retry...');
                                setTimeout(async () => {
                                    try {
                                        const llmResponse = await llmService.processText(data.text);
                                        if (ws.readyState === WebSocket.OPEN) {
                                            console.log('✨ Sending LLM response after retry:', llmResponse);
                                            ws.send(JSON.stringify({ 
                                                type: 'llm_response', 
                                                data: llmResponse
                                            }));
                                        }
                                    } catch (retryError) {
                                        console.error('❌ LLM retry failed:', retryError);
                                        sendError(ws, 'Failed to process text with LLM after retry');
                                    }
                                }, 2000);
                            } else {
                                // For other errors, send a more detailed error message
                                const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
                                console.error('❌ LLM error details:', errorMessage);
                                sendError(ws, `Error processing text with LLM: ${errorMessage}`);
                            }
                        }
                    } else {
                        console.log('⏸️  LLM processing skipped (paused)');
                    }
                }
            });

            sttService.on('error', (error) => {
                console.error('🚨 STT Error:', error);
                if (error.code === 11) {
                    console.log('⏱️  Audio stream timeout, restarting...');
                    sendError(ws, 'Audio stream timeout. Restarting...');
                } else {
                    console.error('❌ Audio processing error:', error.message || error);
                    sendError(ws, 'Error processing audio');
                }
            });
        }

        if (!llmService) {
            console.log('🤖 Creating new LLM service');
            llmService = new LLMService();
        }
    };

    const sendError = (ws, message) => {
        if (ws.readyState === WebSocket.OPEN) {
            console.error('❌ Sending error to client:', message);
            ws.send(JSON.stringify({ 
                type: 'error', 
                data: { 
                    message: String(message),
                    timestamp: new Date().toISOString()
                }
            }));
        }
    };

    const cleanupServices = () => {
        console.log('🧹 Cleaning up services...');
        if (pendingLLMRequests > 0) {
            console.log('⏳ Waiting for', pendingLLMRequests, 'pending LLM requests...');
            setTimeout(() => {
                if (sttService) {
                    console.log('⏹️  Stopping STT service');
                    sttService.stop();
                    sttService = null;
                }
                llmService = null;
                isTranscriptionPaused = false;
                isLLMPaused = false;
                console.log('✅ Cleanup complete');
            }, 1000);
        } else {
            if (sttService) {
                console.log('⏹️  Stopping STT service');
                sttService.stop();
                sttService = null;
            }
            llmService = null;
            isTranscriptionPaused = false;
            isLLMPaused = false;
            console.log('✅ Cleanup complete');
        }
    };

    ws.on('message', async (message) => {
        if (message instanceof Buffer) {
            // Process audio data without logging packet details
            if (!isTranscriptionPaused) {
                if (!sttService) {
                    initializeServices();
                }
                sttService.send(message);
            }
            return;
        }

        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'pause_transcription':
                    isTranscriptionPaused = Boolean(data.pause);
                    console.log('Transcription pause state:', isTranscriptionPaused);
                    if (isTranscriptionPaused && sttService) {
                        console.log('Stopping STT service due to pause');
                        sttService.stop();
                        sttService = null;
                    }
                    break;

                case 'stop_stream':
                    if (sttService) {
                        console.log('Stopping STT stream on client request');
                        sttService.stop();
                        sttService = null;
                    }
                    break;

                case 'start_stream':
                    if (!isTranscriptionPaused && !sttService) {
                        console.log('Starting new STT stream on client request');
                        initializeServices();
                    }
                    break;

                case 'pause_llm':
                    isLLMPaused = Boolean(data.pause);
                    break;

                default:
                    console.warn('⚠️  Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
            sendError(ws, 'Invalid message format');
        }
    });

    ws.on('close', () => {
        console.log('🔴 Client disconnected');
        cleanupServices();
    });

    ws.on('error', (error) => {
        console.error('🚨 WebSocket error:', error);
        cleanupServices();
    });

    // Initialize services immediately upon connection
    initializeServices();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
}); 