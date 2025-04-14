const axios = require('axios');
require('dotenv').config();
const SYSTEM_PROMPTS = require('../config/prompts');

class LLMService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        if (!this.apiKey) {
            throw new Error('OpenAI API key not found in environment variables');
        }

        this.client = axios.create({
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
        
        // Initialize message history
        this.messageHistory = {
            messages: [],
            maxMessages: 20
        };
    }

    addToHistory(text) {
        this.messageHistory.messages.push(text);
        if (this.messageHistory.messages.length > this.messageHistory.maxMessages) {
            this.messageHistory.messages.shift(); // Remove oldest message
        }
    }

    getContextualPrompt(text) {
        // Create a context string that includes history
        let contextPrompt = '';
        if (this.messageHistory.messages.length > 1) { // Check length > 1 since current text is already added
            // Get all messages except the last one (current text)
            const history = this.messageHistory.messages.slice(0, -1);
            contextPrompt = 'Previous conversation:\n' + 
                history.join('\n') +
                '\n\nCurrent message:\n';
        }
        return contextPrompt + text;
    }

    clearHistory() {
        this.messageHistory.messages = [];
    }

    async processText(text, isVoiceInput = false) {
        try {
            console.log('🔍 LLM Service - Starting text processing:', {
                textLength: text?.length,
                historyLength: this.messageHistory.messages.length,
                inputType: isVoiceInput ? 'voice' : 'text'
            });

            // Add to history
            this.addToHistory(text);

            // Get contextual prompt
            const contextualPrompt = this.getContextualPrompt(text);

            const messages = [
                {
                    role: 'system',
                    content: isVoiceInput ? SYSTEM_PROMPTS.VOICE : SYSTEM_PROMPTS.TEXT
                },
                {
                    role: 'user',
                    content: contextualPrompt
                }
            ];

            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-3.5-turbo',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 500
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            const parsedResponse = this.parseResponse(content, isVoiceInput);
            
            return parsedResponse;
        } catch (error) {
            console.error('❌ LLM Service - Error:', error.message);
            return {
                skip: false,
                questions: [],
                answers: [],
                suggestions: ['Error processing text with LLM: ' + error.message]
            };
        }
    }

    parseResponse(content, isVoiceInput = false) {
        try {
            console.log('🔍 Parsing LLM response:', content);
            
            // For voice input, check for skip response
            if (isVoiceInput) {
                try {
                    const jsonResponse = JSON.parse(content);
                    if (jsonResponse.skip === true) {
                        return {
                            skip: true,
                            questions: [],
                            answers: [],
                            suggestions: []
                        };
                    }
                } catch (e) {
                    // Not a skip response, continue with normal parsing
                }
            }

            // Split content into sections
            const sections = content.split('\n');
            const questions = [];
            const answers = [];
            const suggestions = [];

            let currentSection = null;
            let collectingDirectAnswer = false;
            let directAnswer = [];

            for (const line of sections) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Remove markdown formatting from the line
                const cleanLine = trimmed.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '');
                const lowerCleanLine = cleanLine.toLowerCase();

                // Check for section headers
                if (lowerCleanLine.includes('question')) {
                    currentSection = questions;
                    collectingDirectAnswer = false;
                } else if (lowerCleanLine.includes('answer')) {
                    currentSection = answers;
                    collectingDirectAnswer = false;
                } else if (lowerCleanLine.includes('suggestion')) {
                    currentSection = suggestions;
                    collectingDirectAnswer = false;
                } else if (currentSection && (cleanLine.startsWith('-') || cleanLine.startsWith('•'))) {
                    // Add item to current section, removing the bullet point and any markdown
                    const item = cleanLine.substring(1).trim();
                    if (item) {
                        currentSection.push(item);
                    }
                } else if (!currentSection && !collectingDirectAnswer && cleanLine.length > 0) {
                    // If we find text before any section header, treat it as a direct answer
                    collectingDirectAnswer = true;
                    directAnswer.push(cleanLine);
                } else if (collectingDirectAnswer) {
                    directAnswer.push(cleanLine);
                } else if (currentSection) {
                    // If we're in a section but the line doesn't start with a bullet,
                    // treat it as part of that section
                    currentSection.push(cleanLine);
                }
            }

            // If we collected a direct answer and no other answers, add it to answers
            if (directAnswer.length > 0 && answers.length === 0) {
                answers.push(directAnswer.join(' ').trim());
            }

            // Clean up empty lines and trim all entries
            const cleanArray = (arr) => arr.map(item => item.trim()).filter(item => item.length > 0);
            
            const cleanedQuestions = cleanArray(questions);
            const cleanedAnswers = cleanArray(answers);
            const cleanedSuggestions = cleanArray(suggestions);

            // Log the parsed sections
            console.log('✅ Parsed response sections:', {
                hasQuestions: cleanedQuestions.length > 0,
                hasAnswers: cleanedAnswers.length > 0,
                hasSuggestions: cleanedSuggestions.length > 0,
                directAnswerFound: directAnswer.length > 0,
                questions: cleanedQuestions,
                answers: cleanedAnswers,
                suggestions: cleanedSuggestions
            });

            return {
                skip: false,
                questions: cleanedQuestions,
                answers: cleanedAnswers,
                suggestions: cleanedSuggestions
            };
        } catch (error) {
            console.error('❌ LLM Service - Error parsing response:', error.message);
            return {
                skip: false,
                questions: [],
                answers: [],
                suggestions: ['Error parsing LLM response: ' + error.message]
            };
        }
    }
}

module.exports = LLMService;

