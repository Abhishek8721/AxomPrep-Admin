const pdf = require('pdf-parse');

const EXTRACT_PROMPT = `You extract multiple-choice questions from Indian government exam PDF text.

IMPORTANT: Each question in the PDF is printed in FOUR languages (typically Assamese, Bengali, Hindi, and English). Extract ONLY the English-medium version of each question and its four English options.

Rules:
- Skip cover pages, instructions, headers, footers, and answer-key pages unless questions are on the same page.
- Each question must have exactly 4 options (A, B, C, D) in English only.
- Preserve question numbering from the PDF when visible.
- Do not include Assamese, Bengali, or Hindi text.
- If a question has no clear English version, skip it.
- rawText must be a copy-paste friendly block: question line, then A) B) C) D) options.

Return JSON only:
{
  "questions": [
    {
      "number": 1,
      "question": "English question text",
      "options": ["option A", "option B", "option C", "option D"],
      "rawText": "Full English MCQ as plain text with A-D options"
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

function parseAiJson(content) {
  const jsonMatch = String(content).trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function callAzure(messages, { temperature = 0.1, maxTokens = 4000 } = {}) {
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
  return parseAiJson(content);
}

async function extractTextFromPdf(buffer) {
  const data = await pdf(buffer);
  return String(data.text || '').trim();
}

function chunkPdfText(text, maxLen = 12000) {
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
      rawText: item.rawText?.trim() || formatRawText(item.question, options),
    });
  }

  return out.sort((a, b) => a.number - b.number);
}

async function extractEnglishMcqsFromChunk(chunkText, chunkIndex) {
  const result = await callAzure(
    [
      { role: 'system', content: EXTRACT_PROMPT },
      {
        role: 'user',
        content: `Extract all English-medium MCQs from this PDF text section (part ${chunkIndex + 1}):\n\n${chunkText}`,
      },
    ],
    { temperature: 0.1, maxTokens: 4000 }
  );

  return Array.isArray(result.questions) ? result.questions : [];
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
