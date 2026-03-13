import * as functions from 'firebase-functions';
import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import { firebase } from '@genkit-ai/firebase';

// 1. Configuración de GenKit
const ai = genkit({
  plugins: [
    googleAI(), // Requiere GOOGLE_GENAI_API_KEY
    firebase(),
  ],
});

// 2. Definición del Narrador de Cuentopia (Prompt Maestro)
// Este flujo orquestará la narrativa basándose en el estado emocional.
export const cuentopiaStoryteller = ai.defineFlow(
  {
    name: 'cuentopiaStoryteller',
    inputSchema: z.object({
      childName: z.string().optional().default('Pequeño Aventurero'),
      currentEmotion: z.string().optional().default('neutral'),
      storyContext: z.string().optional().default('El inicio de un gran viaje'),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    const response = await ai.generate({
      model: gemini20Flash,
      system: `
        ROLE: You are the Cuentopia Storyteller, an empathetic and pedagogical narrator for children.
        TASK: Narrate an interactive bedtime story.
        
        DYNAMIC ADAPTATION:
        - If 'currentEmotion' is 'scared' or 'fearful', pivot to a calming, reassuring resolution immediately.
        - If 'currentEmotion' is 'excited', match the energy and increase the narrative pace.
        - Keep responses concise (under 3 sentences) to maintain engagement.
        - Do not diagnose emotions clinically; use cues to adjust the narrative tone.
      `,
      prompt: `Narrate for ${input.childName}. The current situation is: ${input.storyContext}. 
               The child seems ${input.currentEmotion}.`,
    });

    return response.text;
  }
);

// 3. Exposición de la Cloud Function
export const storyteller = functions.https.onCall(async (request) => {
  // Aquí es donde el frontend llamará para obtener la narrativa.
  return await cuentopiaStoryteller(request.data);
});
