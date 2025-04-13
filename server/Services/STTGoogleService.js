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
			// Enhanced speech detection settings
			model: 'latest_long',  // Better for conversational speech
			useEnhanced: true,
			maxAlternatives: 1,
			enableWordTimeOffsets: false,
			profanityFilter: false,  // Allow all speech to be transcribed
			enableWordConfidence: true,  // Get confidence scores for each word
			// Enhanced speech context hints
			speechContexts: [{
				phrases: [
					"what", "where", "when", "how", "why", "who",
					"is", "are", "the", "in", "at", "on",
					"can", "could", "would", "should",
					"tell", "explain", "describe",
					"capital", "city", "country", "state",
					"weather", "temperature", "forecast",
					"time", "date", "day", "month", "year"
				],
				boost: 15  // Reduced from 20 to avoid over-boosting
			}],
			// Improved streaming configuration
			streamingConfig: {
				interimResults: true,
				singleUtterance: false,  // Changed to false to handle continuous speech better
				endpointerAttributes: {
					endpointerSensitivity: 'HIGH',  // Changed from VERY_AGGRESSIVE to HIGH for better balance
					speechDurationMs: 400,  // Increased from 300 to better capture complete phrases
					timeoutMs: 1000,  // Added timeout for silence detection
					silenceThresholdMs: 800  // Added explicit silence threshold
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
		try {
			// Convert audio chunk to 16-bit PCM with safety checks
			const buffer = Buffer.from(chunk.buffer || chunk);
			
			// Check if buffer has enough data for at least one 16-bit sample
			if (buffer.length < 2) {
				console.log('⚠️  Audio chunk too small, skipping...');
				return Buffer.alloc(0);
			}

			// Ensure we only process complete 16-bit samples
			const sampleCount = Math.floor(buffer.length / 2);
			const pcmData = new Int16Array(sampleCount);
			
			for (let i = 0; i < sampleCount * 2; i += 2) {
				try {
					pcmData[i / 2] = buffer.readInt16LE(i);
				} catch (readError) {
					console.warn('⚠️  Error reading sample at position', i, 'skipping...');
					pcmData[i / 2] = 0;
				}
			}

			// Calculate audio level with improved accuracy and safety
			let sum = 0;
			let validSamples = 0;
			
			for (let i = 0; i < pcmData.length; i++) {
				const sample = pcmData[i];
				if (!isNaN(sample) && isFinite(sample)) {
					sum += Math.abs(sample);
					validSamples++;
				}
			}

			const average = validSamples > 0 ? sum / validSamples : 0;
			const normalizedLevel = average / 32768; // Normalize to 0-1 range

			// Enhanced silence detection with safety checks
			if (normalizedLevel < this.SILENCE_THRESHOLD) {
				if (!this.silenceStart) {
					this.silenceStart = Date.now();
				} else if (Date.now() - this.silenceStart > this.SILENCE_DURATION) {
					if (this.recognizeStream && !this.lastTranscriptWasFinal) {
						this.recognizeStream.end();
						this.startStream();  // Start a new stream for next utterance
					}
					this.silenceStart = null;
				}
			} else {
				this.silenceStart = null;
			}

			// Return the processed buffer only if we have valid data
			return buffer.length >= 2 ? buffer.subarray(0, sampleCount * 2) : Buffer.alloc(0);
		} catch (error) {
			console.warn('⚠️  Error processing audio chunk:', error.message);
			return Buffer.alloc(0);  // Return empty buffer on error
		}
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
			return;
		}

		try {
			// Ensure stream is ready before processing
			if (!this.recognizeStream || !this.isActive) {
				const started = this.startStream();
				if (!started) {
					setTimeout(() => this.send(data), 100);
					return;
				}
			}

			// Wait for stream to be writable
			if (!this.recognizeStream?.writable) {
				setTimeout(() => this.send(data), 100);
				return;
			}

			const processedAudio = this.processAudioChunk(data);
			
			// Skip empty or invalid audio chunks
			if (!processedAudio || processedAudio.length < 2) {
				return;
			}

			if (processedAudio.length > 0) {
				if (this.newStream && this.lastAudioInput.length !== 0) {
					const chunkTime = (processedAudio.length / 2) * (1 / this.sampleRate) * 1000;
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
				} catch (writeError) {
					this.bridgeStream();
					setTimeout(() => this.send(data), 100);
					return;
				}
			}
		} catch (error) {
			console.error('❌ Audio processing error:', error);
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
