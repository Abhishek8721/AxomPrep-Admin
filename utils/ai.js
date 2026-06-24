const { CATEGORIES, DIFFICULTIES } = require('./questions');
const { extractOptions, detectQuestionType } = require('./questionParse');
const { searchForAnswer } = require('./webSearch');

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

function resolveCategory(category) {
  const id = String(category || '').trim();
  if (!id || !CATEGORY_IDS.includes(id)) {
    throw new Error(`Valid category is required (${CATEGORY_IDS.join(', ')})`);
  }
  return id;
}

function categoryToQuestionType(category) {
  if (category === 'maths') return 'maths';
  if (category === 'reasoning') return 'reasoning';
  return 'factual';
}

function getAzureConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

  if (!apiKey || !endpoint) {
    throw new Error('Azure OpenAI is not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT.');
  }

  const base = endpoint.replace(/\/$/, '');
  const url = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  return { apiKey, url };
}

const VERIFY_FACTUAL_PROMPT = `You are a strict MCQ fact-checker for AxomPrep (Assam competitive exams).

The user pasted a factual MCQ (GK, history, literature, English, etc.). The marked answer may be WRONG.

You will receive WEB SEARCH RESULTS from the internet. Use them as primary evidence.

Rules:
- Do NOT trust any marked answer in the paste.
- Prefer Wikipedia and authoritative sources over random quiz sites.
- Parse exactly four options from the paste in order A, B, C, D.

Return JSON only:
{
  "options": ["option A", "option B", "option C", "option D"],
  "correctAnswer": 0,
  "sourceAnswerWrong": false,
  "confidence": "high",
  "category": "assam_gk",
  "verificationNote": "One sentence citing the web source",
  "explanation": "1-2 sentences why that option is correct"
}

correctAnswer is 0-based (A=0). category must be one of: ${CATEGORY_IDS.join(', ')}.`;

const VERIFY_MATHS_PROMPT = `You are an expert mathematics solver for Indian competitive exams (APSC, SSC, banking, police).

The user pasted a MATHS MCQ. Web search is NOT useful here — you must SOLVE the problem yourself.

Rules:
- Do NOT trust any marked answer in the paste.
- Solve step by step with correct arithmetic/algebra.
- Double-check your calculation before choosing an option.
- Match your final numeric/logical result to one of the four options exactly.
- Parse exactly four options from the paste in order A, B, C, D.
- explanation MUST be a clear step-by-step solution (Step 1, Step 2, …) ending with the answer.

Return JSON only:
{
  "options": ["option A", "option B", "option C", "option D"],
  "correctAnswer": 0,
  "sourceAnswerWrong": false,
  "confidence": "high",
  "category": "maths",
  "verificationNote": "Brief note e.g. Solved: 25% of 480 = 120",
  "explanation": "Step 1: ...\\nStep 2: ...\\nTherefore, the answer is ..."
}

correctAnswer is 0-based. category must be "maths". confidence "low" only if the question is ambiguous or unreadable.`;

const VERIFY_REASONING_PROMPT = `You are an expert logical/reasoning solver for Indian competitive exams.

The user pasted a REASONING MCQ (series, analogy, blood relation, direction, coding-decoding, puzzles, etc.). Web search is NOT useful — you must SOLVE it by logic.

Rules:
- Do NOT trust any marked answer in the paste.
- Identify the pattern, rule, or logical chain first.
- Apply it step by step to reach the answer.
- Parse exactly four options from the paste in order A, B, C, D.
- explanation MUST show the reasoning steps (Step 1: identify pattern … Step 2: apply … Therefore …).

Return JSON only:
{
  "options": ["option A", "option B", "option C", "option D"],
  "correctAnswer": 0,
  "sourceAnswerWrong": false,
  "confidence": "high",
  "category": "reasoning",
  "verificationNote": "Brief note e.g. Pattern: +3 each term → 17",
  "explanation": "Step 1: ...\\nStep 2: ...\\nTherefore, the answer is ..."
}

correctAnswer is 0-based. category must be "reasoning".`;

const GENERATE_FACTUAL_PROMPT = `You are an MCQ editor for AxomPrep. The correct answer is already verified via web search. Do NOT change it.

Rephrase the question and options originally. Pick difficulty.

Categories: ${CATEGORY_IDS.join(', ')}
Difficulties: ${DIFFICULTIES.join(', ')}

Return JSON only:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": 0,
  "explanation": "string",
  "category": "assam_gk",
  "difficulty": "Medium",
  "verificationNote": "string"
}`;

const GENERATE_MATHS_PROMPT = `You are an MCQ editor for AxomPrep. The maths answer is already solved and verified. Do NOT change the correct option or its value.

Rephrase the question using different numbers ONLY if you can keep the same type of problem and the same correct option value. Otherwise keep the same numbers and rephrase wording only.

The explanation MUST preserve the full step-by-step working from the verified solution (you may rephrase steps but keep all logic and calculations).

category must be "maths". Difficulties: ${DIFFICULTIES.join(', ')}

Return JSON only:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": 0,
  "explanation": "Step 1: ...\\nStep 2: ...",
  "category": "maths",
  "difficulty": "Medium",
  "verificationNote": "string"
}`;

const GENERATE_REASONING_PROMPT = `You are an MCQ editor for AxomPrep. The reasoning answer is already solved and verified. Do NOT change the correct option.

Rephrase the question and options originally while keeping the same logical pattern. The explanation MUST keep the step-by-step reasoning from the verified solution.

category must be "reasoning". Difficulties: ${DIFFICULTIES.join(', ')}

Return JSON only:
{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": 0,
  "explanation": "Step 1: ...\\nStep 2: ...",
  "category": "reasoning",
  "difficulty": "Medium",
  "verificationNote": "string"
}`;

function parseAiJson(content) {
  const trimmed = content.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON');
  }
  return JSON.parse(jsonMatch[0]);
}

async function callAzure(messages, { temperature = 0.1, maxTokens = 1200 } = {}) {
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
    const msg = body.error?.message || body.message || `Azure OpenAI error (${res.status})`;
    throw new Error(msg);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from AI');
  }

  return parseAiJson(content);
}

function detectSourceAnswerIndex(rawText, options) {
  const text = String(rawText || '');
  const answerLine = text.match(
    /(?:^|\n)\s*(?:answer(?:\s*is)?|ans(?:wer)?|correct)[:\s]+([A-D]|\d|[\w\s]+)/i
  );
  if (!answerLine) return -1;

  const ans = answerLine[1].trim();
  const letterMap = { a: 0, b: 1, c: 2, d: 3 };
  if (letterMap[ans.toLowerCase()] !== undefined) return letterMap[ans.toLowerCase()];

  const normAns = ans.toLowerCase();
  return options.findIndex(
    (o) => o.toLowerCase().includes(normAns) || normAns.includes(o.toLowerCase())
  );
}

function alignAnswerWithExplanation(verified) {
  const expl = String(verified.explanation || '');
  if (!expl || !Array.isArray(verified.options)) return verified;

  const conclusionMatch = expl.match(
    /(?:therefore,?\s*(?:the\s*)?answer\s*(?:is|:)?|answer\s*(?:is|:))\s*([^\n.]+)/i
  );
  if (!conclusionMatch) return verified;

  const mentioned = conclusionMatch[1].replace(/[()option]/gi, '').trim().toLowerCase();
  const letterMap = { a: 0, b: 1, c: 2, d: 3 };
  if (letterMap[mentioned] !== undefined) {
    verified.correctAnswer = letterMap[mentioned];
    return verified;
  }

  for (let i = 0; i < verified.options.length; i += 1) {
    const opt = String(verified.options[i]).trim().toLowerCase();
    if (!opt) continue;
    if (mentioned === opt || mentioned.includes(opt) || opt.includes(mentioned)) {
      verified.correctAnswer = i;
      return verified;
    }
  }

  return verified;
}

function buildVerifiedResult(rawText, verified, meta) {
  alignAnswerWithExplanation(verified);
  const options = verified.options.map((o) => String(o).trim());
  const correctAnswer = Number(verified.correctAnswer);
  const sourceIdx = detectSourceAnswerIndex(rawText, options);

  return {
    options,
    correctAnswer,
    sourceAnswerIndex: sourceIdx,
    sourceAnswerWrong:
      sourceIdx >= 0 ? sourceIdx !== correctAnswer : Boolean(verified.sourceAnswerWrong),
    verificationNote: verified.verificationNote || '',
    explanation: verified.explanation || '',
    category: verified.category,
    confidence: verified.confidence || 'medium',
    ...meta,
  };
}

function validateGenerated(data, verified) {
  const errors = [];

  if (!data.question || !String(data.question).trim()) {
    errors.push('Missing question');
  }
  if (!Array.isArray(data.options) || data.options.length !== 4) {
    errors.push('Must have exactly 4 options');
  } else if (data.options.some((o) => !String(o).trim())) {
    errors.push('All options must be non-empty');
  }
  const ca = Number(data.correctAnswer);
  if (Number.isNaN(ca) || ca < 0 || ca > 3) {
    errors.push('correctAnswer must be 0–3');
  }
  if (!data.explanation || !String(data.explanation).trim()) {
    errors.push('Missing explanation');
  }
  if (!CATEGORY_IDS.includes(data.category)) {
    errors.push('Invalid category');
  }
  if (!DIFFICULTIES.includes(data.difficulty)) {
    errors.push('Invalid difficulty');
  }

  if (errors.length) {
    throw new Error(`AI response invalid: ${errors.join(', ')}`);
  }

  const sourceIdx = verified.sourceAnswerIndex;
  const sourceWrong =
    verified.sourceAnswerWrong !== undefined
      ? verified.sourceAnswerWrong
      : sourceIdx >= 0
        ? sourceIdx !== ca
        : Boolean(data.sourceAnswerWrong);

  return {
    question: String(data.question).trim(),
    options: data.options.map((o) => String(o).trim()),
    correctAnswer: ca,
    explanation: String(data.explanation).trim(),
    category: data.category,
    difficulty: data.difficulty,
    answerVerified: verified.confidence !== 'low',
    sourceAnswerWrong: Boolean(sourceWrong),
    verificationNote:
      verified.verificationNote ||
      (data.verificationNote ? String(data.verificationNote).trim() : ''),
    verifiedBy: verified.source || 'web',
    questionType: verified.questionType || 'factual',
    searchQueries: verified.searchQueries || [],
  };
}

async function verifyByWebSearch(rawText, parsedOptions, category) {
  const { queries, results, promptText } = await searchForAnswer(rawText, parsedOptions);

  const verified = await callAzure(
    [
      { role: 'system', content: VERIFY_FACTUAL_PROMPT },
      {
        role: 'user',
        content: `SELECTED CATEGORY (must use in response): ${category}\n\nPASTED MCQ:\n${rawText}\n\nWEB SEARCH QUERIES: ${queries.join(' | ')}\n\nWEB SEARCH RESULTS:\n${promptText}`,
      },
    ],
    { temperature: 0.1, maxTokens: 1000 }
  );

  if (!Array.isArray(verified.options) || verified.options.length !== 4) {
    throw new Error('Could not parse four options from pasted text');
  }

  verified.category = category;

  return buildVerifiedResult(rawText, verified, {
    source: results.length ? 'web' : 'ai',
    questionType: 'factual',
    searchQueries: queries,
  });
}

async function verifyBySolving(rawText, questionType, category) {
  const prompt = questionType === 'maths' ? VERIFY_MATHS_PROMPT : VERIFY_REASONING_PROMPT;

  const verified = await callAzure(
    [
      { role: 'system', content: prompt },
      { role: 'user', content: `SELECTED CATEGORY: ${category}\n\nPASTED MCQ:\n${rawText}` },
    ],
    { temperature: 0.05, maxTokens: 1500 }
  );

  if (!Array.isArray(verified.options) || verified.options.length !== 4) {
    throw new Error('Could not parse four options from pasted text');
  }

  verified.category = category;

  return buildVerifiedResult(rawText, verified, {
    source: 'solve',
    questionType,
    searchQueries: [],
  });
}

async function verifyAnswer(rawText, category) {
  const parsedOptions = extractOptions(rawText);
  const questionType = categoryToQuestionType(category);

  if (questionType === 'maths' || questionType === 'reasoning') {
    return verifyBySolving(rawText, questionType, category);
  }

  return verifyByWebSearch(rawText, parsedOptions, category);
}

function getGeneratePrompt(questionType) {
  if (questionType === 'maths') return GENERATE_MATHS_PROMPT;
  if (questionType === 'reasoning') return GENERATE_REASONING_PROMPT;
  return GENERATE_FACTUAL_PROMPT;
}

/** Randomly reorder options and update correctAnswer to the new slot. */
function shuffleOptions(options, correctAnswer) {
  const indexed = options.map((text, index) => ({ text, index }));
  for (let i = indexed.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  const shuffled = indexed.map((item) => item.text);
  const newCorrectAnswer = indexed.findIndex((item) => item.index === correctAnswer);
  return { options: shuffled, correctAnswer: newCorrectAnswer };
}

function alignGeneratedAnswer(generated, verified) {
  const correctLabel = verified.options[verified.correctAnswer];
  const genCorrectText = generated.options?.[Number(generated.correctAnswer)] || '';
  const verifiedNorm = correctLabel.toLowerCase();
  const genNorm = genCorrectText.toLowerCase();

  if (
    !genNorm.includes(verifiedNorm.split(' ')[0]) &&
    !verifiedNorm.includes(genNorm.split(' ')[0])
  ) {
    const fixIdx = generated.options.findIndex(
      (o) =>
        o.toLowerCase().includes(verifiedNorm) ||
        verifiedNorm.includes(o.toLowerCase()) ||
        o.toLowerCase() === verifiedNorm
    );
    if (fixIdx >= 0) {
      generated.correctAnswer = fixIdx;
    } else {
      generated.correctAnswer = verified.correctAnswer;
      generated.options = [...verified.options];
    }
  }

  if (verified.explanation) {
    generated.explanation = verified.explanation;
  }

  generated.category = verified.category;
}

async function generateQuestionFromPaste(rawText, category) {
  const text = String(rawText || '').trim();
  if (!text) {
    throw new Error('Paste the question text and options first');
  }

  const selectedCategory = resolveCategory(category);
  const verified = await verifyAnswer(text, selectedCategory);
  verified.category = selectedCategory;
  const correctLabel = verified.options[verified.correctAnswer];
  const generatePrompt = getGeneratePrompt(verified.questionType);

  const verifiedMethod =
    verified.questionType === 'factual'
      ? 'web search'
      : `step-by-step ${verified.questionType} solution`;

  const generated = await callAzure(
    [
      { role: 'system', content: generatePrompt },
      {
        role: 'user',
        content: `PASTED QUESTION:\n${text}\n\nVERIFIED BY: ${verifiedMethod}\nVERIFIED CORRECT OPTION: "${correctLabel}"\nVERIFIED INDEX IN SOURCE OPTIONS: ${verified.correctAnswer}\nSOURCE OPTIONS: ${JSON.stringify(verified.options)}\nVERIFIED EXPLANATION (keep this working in the final explanation):\n${verified.explanation || verified.verificationNote}`,
      },
    ],
    {
      temperature: verified.questionType === 'factual' ? 0.5 : 0.3,
      maxTokens: verified.questionType === 'factual' ? 1400 : 1800,
    }
  );

  alignGeneratedAnswer(generated, verified);
  generated.category = selectedCategory;

  const shuffled = shuffleOptions(generated.options, Number(generated.correctAnswer));
  generated.options = shuffled.options;
  generated.correctAnswer = shuffled.correctAnswer;

  return validateGenerated(generated, verified);
}

module.exports = { generateQuestionFromPaste, detectQuestionType: (text) => detectQuestionType(text, extractOptions(text)) };
