/*
 * See https://github.com/googleapis/nodejs-speech/blob/master/samples/infiniteStreaming.js
 */
const { EventEmitter } = require("events");
const path = require('path');
const speech = require('@google-cloud/speech').v1p1beta1;

class GoogleSpeechProvider extends EventEmitter {
	constructor() {
		super();
		console.log('🎤 Initializing Google Speech Provider');

		this.config = {
			encoding: "LINEAR16",
			sampleRateHertz: 16000,
			audioChannelCount: 1,
			enableAutomaticPunctuation: true,
			languageCode: "en-US",
			// Improve speech detection settings
			model: 'command_and_search',
			useEnhanced: true,
			maxAlternatives: 1,
			enableWordTimeOffsets: false,
			// Speech context hints
			speechContexts: [{
				phrases: ["what", "where", "when", "how", "why", "who", "is", "are", "the"],
				boost: 20
			}],
			// Streaming configuration
			streamingConfig: {
				interimResults: true,
				singleUtterance: true,
				endpointerAttributes: {
					endpointerSensitivity: 'VERY_AGGRESSIVE',
					speechDurationMs: 300
				}
			}
		};

		console.log('⚙️  Speech-to-Text configuration:', this.config);

		this.speechClient = new speech.SpeechClient({
			keyFilename: path.join(__dirname, '../credentials/google-credentials.json')
		});
		console.log('✅ Google Speech client initialized');

		this.request = {
			config: this.config,
			interimResults: true
		};

		this.recognizeStream = null;
		this.isActive = true;
		this.audioInput = [];
		this.lastAudioInput = [];
		this.resultEndTime = 0;
		this.isFinalEndTime = 0;
		this.finalRequestEndTime = 0;
		this.newStream = true;
		this.bridgingOffset = 0;
		this.lastTranscriptWasFinal = false;
		this.restartCounter = 0;
		this.silenceStart = null;
		this.SILENCE_THRESHOLD = 0.005;
		this.SILENCE_DURATION = 800;

		this.bufferSize = 4096;
		this.sampleRate = 16000;
		this.currentPartialTranscript = '';  // Track current partial transcript
	}

	processAudioChunk(chunk) {
		// Convert audio chunk to 16-bit PCM
		const buffer = Buffer.from(chunk.buffer || chunk);
		const pcmData = new Int16Array(buffer.length / 2);
		
		for (let i = 0; i < buffer.length; i += 2) {
			pcmData[i / 2] = buffer.readInt16LE(i);
		}

		// Calculate audio level with improved accuracy
		let sum = 0;
		for (let i = 0; i < pcmData.length; i++) {
			sum += Math.abs(pcmData[i]);
		}
		const average = sum / pcmData.length;
		const normalizedLevel = average / 32768; // Normalize to 0-1 range

		// Enhanced silence detection
		if (normalizedLevel < this.SILENCE_THRESHOLD) {
			if (!this.silenceStart) {
				this.silenceStart = Date.now();
			} else if (Date.now() - this.silenceStart > this.SILENCE_DURATION) {
				// Force end of current recognition when silence is detected
				if (this.recognizeStream && !this.lastTranscriptWasFinal) {
					console.log('🔇 Silence detected, forcing end of recognition');
					this.recognizeStream.end();
					this.startStream();  // Start a new stream for next utterance
				}
				this.silenceStart = null;
			}
		} else {
			this.silenceStart = null;
		}

		return buffer;
	}

	startStream() {
		try {
			console.log('🔄 Starting new STT stream...');
			if (this.recognizeStream) {
				console.log('⏹️  Stopping existing stream before starting new one');
				try {
					this.recognizeStream.end();
					this.recognizeStream.removeAllListeners();
				} catch (cleanupError) {
					console.warn('⚠️  Non-critical cleanup error:', cleanupError);
				}
				this.recognizeStream = null;
			}

			// Reset state
			this.audioInput = [];
			this.lastAudioInput = [];
			this.resultEndTime = 0;
			this.isFinalEndTime = 0;
			this.finalRequestEndTime = 0;
			this.newStream = true;
			this.bridgingOffset = 0;
			this.lastTranscriptWasFinal = false;
			this.isActive = true;
			this.currentPartialTranscript = '';  // Track current partial transcript

			console.log('🟢 STT service activated');

			// Create new stream with proper error handling
			this.recognizeStream = this.speechClient
				.streamingRecognize(this.request)
				.on('error', (error) => {
					if (error.code === 11) {
						console.log('⏱️  Stream timeout, bridging...');
						this.restartCounter++;
						this.newStream = true;
						this.bridgeStream();
					} else {
						console.error('🚨 Stream error:', error);
						// Don't emit error for initial setup issues
						if (this.restartCounter > 0) {
							this.emit('error', {
								code: error.code || 0,
								details: error.details || null,
								message: error.message || 'Unknown error'
							});
						}
						this.bridgeStream();
					}
				})
				.on('data', (data) => {
					if (data.error) {
						console.error('🚨 Data error:', data.error);
						return;
					}

					if (!data.results?.[0]) return;
					
					const result = data.results[0];
					if (!result.alternatives?.[0]) return;

					const transcript = result.alternatives[0].transcript;
					if (!transcript) return;

					if (result.isFinal) {
						console.log('\n📝 Final transcript:', transcript);
						this.lastTranscriptWasFinal = true;
						this.resultEndTime = result.resultEndTime?.seconds || 0;
						this.currentPartialTranscript = '';  // Reset partial transcript
						this.emit("final", { 
							text: transcript, 
							confidence: result.alternatives[0].confidence 
						});
					} else {
						// Always show complete partial transcript
						this.currentPartialTranscript = transcript;
						console.log('\n🗣️  Partial transcript:', this.currentPartialTranscript);
						this.lastTranscriptWasFinal = false;
						this.emit("partial", { 
							text: transcript 
						});
					}
				});

			// Wait a bit for the stream to be ready
			return new Promise((resolve) => {
				setTimeout(() => {
					console.log('✅ Stream setup complete');
					resolve(true);
				}, 100);
			});
		} catch (error) {
			console.error('❌ Failed to start stream:', error);
			// Don't emit error for initial setup issues
			if (this.restartCounter > 0) {
				this.emit('error', {
					code: 0,
					message: 'Failed to start stream',
					details: error.message
				});
			}
			return false;
		}
	}

	bridgeStream() {
		if (this.lastAudioInput.length > 0) {
			console.log('🌉 Bridging audio gap...');
			const bridgingAudio = this.lastAudioInput;
			this.lastAudioInput = [];
			this.audioInput = [];
			
			this.startStream();
			
			bridgingAudio.forEach(chunk => {
				this.send(chunk);
			});
			
			console.log('✅ Bridge complete');
		} else {
			this.startStream();
		}
	}

	send(data) {
		if (!data || data.length === 0) {
			console.log('⏭️  Empty audio data received');
			return;
		}

		try {
			// Ensure stream is ready before processing
			if (!this.recognizeStream || !this.isActive) {
				console.log('🔄 Starting new stream...');
				const started = this.startStream();
				if (!started) {
					console.log('⏳ Waiting for stream to initialize...');
					setTimeout(() => this.send(data), 100);  // Retry after 100ms
					return;
				}
			}

			// Wait for stream to be writable
			if (!this.recognizeStream?.writable) {
				console.log('⏳ Stream not ready, waiting...');
				setTimeout(() => this.send(data), 100);  // Retry after 100ms
				return;
			}

			const processedAudio = this.processAudioChunk(data);
			
			// Only log every 10th packet to reduce noise
			if (Math.random() < 0.1) {
				console.log('🎵 Audio packet processed:', {
					originalSize: data.length,
					processedSize: processedAudio.length,
					sizeKB: (processedAudio.length / 1024).toFixed(2) + ' KB',
					timestamp: new Date().toISOString()
				});
			}

			if (processedAudio.length > 0) {
				if (this.newStream && this.lastAudioInput.length !== 0) {
					const chunkTime = (processedAudio.length / 2) * (1 / this.sampleRate) * 1000;
					if (Math.random() < 0.1) {  // Only log occasionally
						console.log('⏱️  Audio chunk duration:', chunkTime.toFixed(2) + 'ms');
					}
					
					if (chunkTime !== 0) {
						if (this.bridgingOffset < 0) {
							this.bridgingOffset = 0;
						}
						if (this.bridgingOffset > chunkTime) {
							this.bridgingOffset = chunkTime;
						}
					}
					this.newStream = false;
				}

				this.audioInput.push(processedAudio);
				
				try {
					this.recognizeStream.write(processedAudio);
					if (Math.random() < 0.1) {  // Only log occasionally
						console.log('✅ Audio chunk processed successfully');
					}
				} catch (writeError) {
					console.log('⚠️  Stream write failed, bridging...');
					this.bridgeStream();
					setTimeout(() => this.send(data), 100);  // Retry the failed chunk
					return;
				}
			}
		} catch (error) {
			console.error('❌ Audio processing error:', error);
			// Don't emit error for initial setup issues
			if (this.restartCounter > 0) {
				this.emit('error', {
					code: 0,
					message: 'Failed to process audio',
					details: error.message
				});
			}
			this.bridgeStream();
		}
	}

	stop() {
		console.log('⏹️  Stopping STT service...');
		this.isActive = false;
		if (this.recognizeStream) {
			try {
				this.recognizeStream.end();
				this.recognizeStream.removeAllListeners();
				console.log('✅ Stream stopped and cleaned up');
			} catch (error) {
				console.warn('⚠️  Error during stream cleanup:', error);
			}
			this.recognizeStream = null;
		}
		this.audioInput = [];
		this.lastAudioInput = [];
		this.resultEndTime = 0;
		this.isFinalEndTime = 0;
		this.finalRequestEndTime = 0;
		this.newStream = true;
		this.bridgingOffset = 0;
		this.lastTranscriptWasFinal = false;
		this.restartCounter = 0;
		console.log('🔴 STT service stopped');
	}
}

module.exports = GoogleSpeechProvider; 
