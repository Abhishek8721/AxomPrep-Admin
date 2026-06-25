const pdf = require('pdf-parse');

const EXTRACT_PROMPT = `You extract multiple-choice questions from Indian government exam PDF text.

IMPORTANT: Each question in the PDF is printed in FOUR languages (typically Assamese, Bengali, Hindi, and English). Extract ONLY the English-medium version of each question and its four English options.

Rules:
- Skip cover pages, instructions, headers, footers, and answer-key pages unless questions are on the same page.
- Each question must have exactly 4 options (A, B, C, D) in English only.
- Preserve question numbering from the PDF when visible.
- Do not include Assamese, Bengali, or Hindi text.
- If a question has no clear English version, skip it.
- Escape special characters properly in JSON strings (quotes, newlines).
- Keep option text concise — no extra commentary.

Return JSON only:
{
  "questions": [
    {
      "number": 1,
      "question": "English question text",
      "options": ["option A", "option B", "option C", "option D"]
    }
  ]
}`;

function getAzureConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

  if (!apiKey || !endpoint) {
    throw new Error('Azure OpenAI is not configured');
  }

  const base = endpoint.replace(/\/$/, '');
  return {
    apiKey,
    url: `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
  };
}

function salvageQuestionsJson(text) {
  const questions = [];
  const arrayStart = text.indexOf('"questions"');
  if (arrayStart === -1) {
    throw new Error('AI returned invalid JSON — try a smaller PDF section or re-upload');
  }

  const bracketStart = text.indexOf('[', arrayStart);
  if (bracketStart === -1) {
    throw new Error('AI returned invalid JSON — try a smaller PDF section or re-upload');
  }

  let i = bracketStart + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i += 1;
    if (i >= text.length || text[i] === ']') break;
    if (text[i] !== '{') break;

    let depth = 0;
    let inString = false;
    let escape = false;
    const objStart = i;

    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(objStart, i + 1);
          try {
            const obj = JSON.parse(slice);
            if (obj?.question && Array.isArray(obj.options)) questions.push(obj);
          } catch {
            // skip malformed object
          }
          i += 1;
          break;
        }
      }
    }
  }

  if (!questions.length) {
    throw new Error('AI returned invalid JSON — response may have been cut off. Try again or use a shorter PDF.');
  }

  return { questions };
}

function parseAiJson(content) {
  const trimmed = String(content).trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON');
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return salvageQuestionsJson(jsonMatch[0]);
  }
}

async function callAzure(messages, { temperature = 0.1, maxTokens = 8000 } = {}) {
  const { apiKey, url } = getAzureConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error?.message || body.message || `Azure OpenAI error (${res.status})`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from AI');

  const finishReason = body.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    const parsed = parseAiJson(content);
    if (Array.isArray(parsed.questions) && parsed.questions.length) {
      return parsed;
    }
    throw new Error('AI response was too long and got cut off — retrying with smaller sections');
  }

  return parseAiJson(content);
}

async function extractTextFromPdf(buffer) {
  const data = await pdf(buffer);
  return String(data.text || '').trim();
}

function chunkPdfText(text, maxLen = 5000) {
  if (text.length <= maxLen) return [text];

  const parts = text.split(/(?=\n\s*\d+[\.\)])/);
  const chunks = [];
  let current = '';

  for (const part of parts) {
    if (!part.trim()) continue;
    if (current.length + part.length > maxLen && current) {
      chunks.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function splitChunkInHalf(text) {
  if (text.length < 1500) return [text];
  const mid = Math.floor(text.length / 2);
  const splitAt = text.lastIndexOf('\n', mid);
  const at = splitAt > 500 ? splitAt : mid;
  return [text.slice(0, at).trim(), text.slice(at).trim()].filter(Boolean);
}

function formatRawText(question, options) {
  const lines = [String(question).trim()];
  ['A', 'B', 'C', 'D'].forEach((label, i) => {
    lines.push(`${label}) ${options[i]}`);
  });
  return lines.join('\n');
}

function normalizeExtracted(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    if (!item?.question || !Array.isArray(item.options) || item.options.length !== 4) continue;
    const options = item.options.map((o) => String(o).trim());
    if (options.some((o) => !o)) continue;

    const key = `${item.question.slice(0, 80)}|${options.join('|')}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      number: Number(item.number) || out.length + 1,
      question: String(item.question).trim(),
      options,
      rawText: formatRawText(item.question, options),
    });
  }

  return out.sort((a, b) => a.number - b.number);
}

async function extractEnglishMcqsFromChunk(chunkText, chunkIndex, depth = 0) {
  try {
    const result = await callAzure(
      [
        { role: 'system', content: EXTRACT_PROMPT },
        {
          role: 'user',
          content: `Extract all English-medium MCQs from this PDF text section (part ${chunkIndex + 1}). Return valid complete JSON only.\n\n${chunkText}`,
        },
      ],
      { temperature: 0.1, maxTokens: 8000 }
    );

    return Array.isArray(result.questions) ? result.questions : [];
  } catch (err) {
    const canSplit = depth < 3 && chunkText.length > 1500;
    if (!canSplit) throw err;

    const halves = splitChunkInHalf(chunkText);
    if (halves.length < 2) throw err;

    const results = [];
    for (let h = 0; h < halves.length; h += 1) {
      const items = await extractEnglishMcqsFromChunk(halves[h], chunkIndex, depth + 1);
      results.push(...items);
    }
    return results;
  }
}

async function extractEnglishMcqsFromPdf(buffer) {
  const fullText = await extractTextFromPdf(buffer);
  if (!fullText) {
    throw new Error('No text could be extracted from this PDF. It may be scanned/image-only.');
  }

  const chunks = chunkPdfText(fullText);
  const all = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const items = await extractEnglishMcqsFromChunk(chunks[i], i);
    all.push(...items);
  }

  const questions = normalizeExtracted(all);
  if (!questions.length) {
    throw new Error('No English MCQs found in the PDF. Check that the file has selectable text.');
  }

  return { questions, pageCount: chunks.length, charCount: fullText.length };
}

module.exports = {
  extractTextFromPdf,
  extractEnglishMcqsFromPdf,
  formatRawText,
};
