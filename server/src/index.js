const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const GoogleSTTService = require('../Services/STTGoogleService');
const LLMService = require('../Services/LLMOpenAIService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Add server-wide connection logging
console.log('🚀 WebSocket server started on port 3000');

wss.on('connection', (ws, req) => {
    console.log('🟢 New client connected');

    // Add connection error handler
    ws.on('error', (error) => {
        console.error('🔴 WebSocket error:', error.message);
    });

    let sttService = null;
    let llmService = null;
    let isTranscriptionPaused = false;
    let isLLMPaused = false;
    let pendingLLMRequests = 0;

    // Helper function to process text with LLM
    const processWithLLM = async (text, isVoiceInput = false) => {
        try {
            if (!text || !text.trim()) {
                console.log('❌ Empty text received, skipping LLM processing');
                return null;
            }

            if (!llmService) {
                console.log('🤖 Creating new LLM service for processing');
                llmService = new LLMService();
            }
            
            const llmResponse = await llmService.processText(text, isVoiceInput);
            return llmResponse;
        } catch (error) {
            console.error('❌ LLM processing error:', error.message);
            throw error;
        }
    };

    const initializeServices = () => {
        if (!sttService) {
            console.log('🎤 Creating new STT service');
            sttService = new GoogleSTTService();

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
                    
                    const transcriptId = Date.now().toString();
                    
                    ws.send(JSON.stringify({ 
                        type: 'transcript', 
                        data: data.text,
                        confidence: data.confidence,
                        isFinal: true,
                        transcriptId: transcriptId
                    }));

                    if (!isLLMPaused && data.text.trim()) {
                        try {
                            const llmResponse = await processWithLLM(data.text, true);  // Voice input
                            if (ws.readyState === WebSocket.OPEN && llmResponse) {
                                const response = {
                                    type: 'llm_response',
                                    data: llmResponse,
                                    transcriptId: transcriptId
                                };
                                console.log('✅ LLM response sent');
                                ws.send(JSON.stringify(response));
                            }
                        } catch (error) {
                            sendError(ws, 'Error processing with LLM: ' + error.message, transcriptId);
                        }
                    }
                }
            });

            sttService.on('error', (error) => {
                console.error('🚨 STT Error:', error);
                sendError(ws, 'Error processing audio: ' + error.message);
            });
        }
    };

    const sendError = (ws, message, transcriptId = null) => {
        if (ws.readyState === WebSocket.OPEN) {
            console.error('❌ Sending error to client:', message);
            ws.send(JSON.stringify({ 
                type: 'error', 
                data: { 
                    message: String(message),
                    timestamp: new Date().toISOString()
                },
                transcriptId
            }));
        }
    };

    // Handle raw messages before parsing
    ws.on('message', async (message) => {
        // Handle audio data (binary)
        if (message instanceof Buffer && message.length > 100) {
            if (!isTranscriptionPaused) {
                if (!sttService) {
                    initializeServices();
                }
                sttService.send(message);
            }
            return;
        }

        // Handle text messages
        try {
            const messageStr = message instanceof Buffer ? message.toString() : message.toString();
            const data = JSON.parse(messageStr);
            
            if (data.type === 'process_llm') {
                console.log('📝 Processing text:', data.data);
                
                if (isLLMPaused) {
                    console.log('⏸️ LLM processing is paused');
                    return;
                }

                if (!data.data?.trim()) {
                    console.log('⚠️ Empty text received');
                    return;
                }

                try {
                    const llmResponse = await processWithLLM(data.data, false);  // Text input
                    
                    if (!llmResponse) {
                        console.log('⚠️ No response from LLM');
                        return;
                    }

                    if (ws.readyState === WebSocket.OPEN) {
                        const response = {
                            type: 'llm_response',
                            data: llmResponse,
                            transcriptId: data.transcriptId
                        };
                        console.log('✅ LLM response details:', {
                            type: response.type,
                            transcriptId: response.transcriptId,
                            skip: llmResponse.skip,
                            hasQuestions: llmResponse.questions?.length > 0,
                            hasAnswers: llmResponse.answers?.length > 0,
                            hasSuggestions: llmResponse.suggestions?.length > 0,
                            rawResponse: llmResponse
                        });
                        ws.send(JSON.stringify(response));
                        console.log('✅ Response sent to client');
                    }
                } catch (error) {
                    console.error('❌ LLM processing error:', error.message);
                    sendError(ws, 'Error processing with LLM: ' + error.message, data.transcriptId);
                }
            } else if (data.type === 'pause_transcription') {
                console.log('🎤 Transcription ' + (data.pause ? 'paused' : 'resumed'));
                isTranscriptionPaused = data.pause;
                if (isTranscriptionPaused && sttService) {
                    sttService.stop();
                    sttService = null;
                }
            } else if (data.type === 'pause_llm') {
                console.log('🤖 LLM ' + (data.pause ? 'paused' : 'resumed'));
                isLLMPaused = data.pause;
            } else {
                console.log('⚠️ Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('❌ Message processing error:', error.message);
            sendError(ws, 'Error processing message: ' + error.message);
        }
    });

    ws.on('close', () => {
        console.log('🔴 Client disconnected');
        if (sttService) {
            sttService.stop();
            sttService = null;
        }
        llmService = null;
    });
});

server.listen(3000, () => {
    console.log('🚀 Server running on port 3000');
}); 