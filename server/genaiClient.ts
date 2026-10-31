import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined = undefined;

export function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        },
        retryOptions: {
          attempts: 2,
          initialDelay: 0.35,
          maxDelay: 1.2
        }
      }
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}
