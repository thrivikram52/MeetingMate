const axios = require('axios');
require('dotenv').config();

const SYSTEM_PROMPT = `You are an intelligent meeting assistant that helps analyze conversations in real-time. Your role is to provide:
1. Key insights or direct answers when needed
2. Follow-up questions for clarification when appropriate
3. Actionable suggestions when relevant

Keep responses concise and focused on the most important points.

Please format your response as a JSON object with the following structure:
{
    "questions": ["question1", "question2"],
    "answers": ["answer1", "answer2"],
    "suggestions": ["suggestion1", "suggestion2"]
}`;

class LLMOpenAIService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        if (!this.apiKey) {
            throw new Error('OpenAI API key is required');
        }

        this.headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    }

    async processText(text) {
        if (!text?.trim()) {
            return {
                questions: [],
                answers: [],
                suggestions: []
            };
        }

        const messages = [
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": text
            }
        ];

        const data = {
            model: "gpt-4-turbo-preview",
            messages: messages,
            max_tokens: 500,
            temperature: 0.7
        };

        try {
            const response = await axios.post(this.baseUrl, data, { headers: this.headers });
            const llmResponse = response.data.choices[0].message.content;
            
            try {
                const parsedResponse = JSON.parse(llmResponse);
                return {
                    questions: Array.isArray(parsedResponse.questions) ? parsedResponse.questions : [],
                    answers: Array.isArray(parsedResponse.answers) ? parsedResponse.answers : [],
                    suggestions: Array.isArray(parsedResponse.suggestions) ? parsedResponse.suggestions : []
                };
            } catch (parseError) {
                console.error('Failed to parse LLM response:', parseError);
                return {
                    questions: [],
                    answers: ["I encountered an error processing that. Could you rephrase or provide more context?"],
                    suggestions: []
                };
            }
        } catch (error) {
            console.error('OpenAI API error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = LLMOpenAIService;
