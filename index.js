/* Minimal backend server for translation endpoint
   - Listens on port 4000
   - Exposes POST /api/translate { text, target }
   - Uses OPENAI_API_KEY env var to call OpenAI Chat Completions and returns { translated }

   Note: This is a simple helper for development. For production, secure your key and add rate-limiting, error handling, and logging.
*/

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY  = "AIzaSyDSsb4M93pBObCIZe7MSs81fQqBiC8CCJQ"
// --- Environment Setup ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 4000;

if (!GEMINI_API_KEY) {
  console.warn('Warning: GEMINI_API_KEY not set. /api/chat will not work.');
}
if (!OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY not set. /api/translate and /api/remedy will not work.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Increase URL-encoded form limit
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- Helper Functions ---
function errorResponse(res, status, error, details) {
  return res.status(status).json(details ? { error, details } : { error });
}

function missingField(res, field) {
  return errorResponse(res, 400, `Missing ${field} in request body`);
}

// --- Endpoints --- 

// Translation endpoint (OpenAI)
app.post('/api/translate', async (req, res) => {
  const { text, target } = req.body || {};
  if (!OPENAI_API_KEY) return errorResponse(res, 400, 'Missing OPENAI_API_KEY in server environment');
  if (!text) return missingField(res, 'text');
  try {
    const system = target === 'ml'
      ? 'You are a professional translator. Translate the user-provided text to Malayalam, preserving meaning, formatting, and lists when possible.'
      : `You are a professional translator. Translate the user-provided text to ${target} preserving meaning and formatting.`;
    const body = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text }
      ],
      max_tokens: 1000,
      temperature: 0.2,
    };
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('OpenAI error', resp.status, errText);
      return errorResponse(res, 502, 'Translation provider error', errText);
    }
    const data = await resp.json();
    const translated = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || null;
    return res.json({ translated });
  } catch (err) {
    console.error('Translate failed', err);
    return errorResponse(res, 500, 'Internal server error');
  }
});
const ai = new GoogleGenAI({apiKey: GEMINI_API_KEY});
app.post("api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

   const response = await ai.models.generateContent({
    model: "gemini-1.5-pro",
    contents:  message,
   });
    const reply = response.text;

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to get response." });
  }
});

// Generate remedy for a disease in requested language
// Remedy endpoint (OpenAI)
// Remedy endpoint (Gemini)
/**
 * Express route handler for /api/remedy.
 * * It identifies or provides remedies and prevention steps for crop diseases.
 * It supports both text-only input (diseaseName) and multimodal input (image for identification).
 * * @param {object} req - Express request object.
 * @param {object} req.body - Request body containing:
 * - diseaseName (string): The known name of the disease (optional if imageBase64 is present).
 * - imageBase64 (string): Base64 encoded image data (optional if diseaseName is present).
 * - lang (string): Language code ('ml' for Malayalam, default is English).
 * @param {object} res - Express response object.
 */
app.post('/api/remedy', async (req, res) => {
  console.log('Received /api/remedy request:', req.body);
  // 1. Destructure all necessary fields, including the new imageBase64
  const { diseaseName, imageBase64, lang } = req.body || {};

  // Assuming helper functions and GEMINI_API_KEY exist in scope
  if (!GEMINI_API_KEY) {
    return errorResponse(res, 400, 'Missing GEMINI_API_KEY in server environment');
  }

  // 2. Updated Validation: Require at least a disease name OR an image
  if (!diseaseName && !imageBase64) {
    return missingField(res, 'diseaseName or imageBase64');
  }

  try {
    const isMalayalam = lang === 'ml';

    // 3. Define the System Instruction (Stays outside 'contents' for standard usage)
    const systemPrompt = isMalayalam
      ? 'You are an expert agricultural advisor who replies ONLY in Malayalam. Provide concise, practical remedies and prevention steps for crop diseases relevant to Indian farmers.'
      : 'You are an expert agricultural advisor. Provide concise, practical remedies and prevention steps for crop diseases relevant to Indian farmers.';

    // 4. Construct the dynamic User Prompt based on inputs
    let userPrompt;
    
    if (imageBase64) {
      // Prompt for image identification and remedy
      userPrompt = isMalayalam
        ? `ചിത്രത്തിൽ കാണിച്ചിരിക്കുന്ന കൃഷിയിലെ രോഗം ഏതാണെന്ന് തിരിച്ചറിഞ്ഞ്, അതിനുള്ള ചികിത്സയും പ്രതിവിധികളും മലയാളത്തിൽ സംക്ഷിപ്തമായി നൽകുക.`
        : `Identify the crop disease shown in the attached image. Then, provide a concise remedy and prevention steps for this identified disease. Assume the farmer is in India.`;
      
      // If a disease name is also provided, use it as a hint for the model
      if (diseaseName) {
        userPrompt += isMalayalam 
          ? ` (സൂചന: രോഗം ${diseaseName} ആയിരിക്കാം.)`
          : ` (Hint: The suspected disease is ${diseaseName}.)`;
      }

    } else {
      // Original prompt for known disease name
      userPrompt = isMalayalam
        ? `ദയവായി ${diseaseName} നുള്ള ചികിത്സയും പ്രതിവിധികളും മലയാളത്തിൽ സംക്ഷിപ്തമായി നൽകുക.`
        : `Provide a concise remedy and prevention steps for: ${diseaseName}. Assume the farmer is in India.`;
    }

    // 5. Build the multimodal 'parts' array
    const userParts = [];

    // If image exists, prepend it to the parts array
    if (imageBase64) {
      // NOTE: We assume 'image/jpeg' here, but it's best practice to determine the actual MIME type.
      userParts.push({
        inlineData: {
          mimeType: 'image/jpeg', 
          data: imageBase64,
        },
      });
    }

    // Always add the generated text prompt as the last part
    userParts.push({ text: userPrompt });


    // 6. Generate content with Gemini, using the systemInstruction configuration
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      // Pass the system prompt via systemInstruction for better control
      systemInstruction: { parts: [{ text: systemPrompt }] },
      
      // Use the dynamically generated contents array for the user message
      contents: [
        { role: 'user', parts: userParts },
      ],
    });

    // 7. Extract text safely
    const remedy =
      response.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      response.text ||
      (isMalayalam ? 'പരിഹാരം കണ്ടെത്താനായില്ല.' : 'No remedy found.');

    res.json({ remedy });
  } catch (err) {
    console.error('Remedy generation (Gemini) failed', err);
    return errorResponse(res, 500, 'Internal server error');
  }
});


// --- Start Server ---
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
