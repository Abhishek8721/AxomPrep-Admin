function extractQuestion(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const questionLines = [];
  for (const line of lines) {
    if (/^(?:\(?[A-Da-d1-4]\)?[\).:\-\s]|(?:answer|ans|correct)\b)/i.test(line)) break;
    questionLines.push(line.replace(/^\d+[\).:\-\s]+/, '').trim());
  }

  const question = questionLines.join(' ').trim();
  return question || lines[0]?.replace(/^\d+[\).:\-\s]+/, '').trim() || '';
}

function formatRawText(question, options) {
  const lines = [String(question).trim()];
  ['A', 'B', 'C', 'D'].forEach((label, i) => {
    if (options[i]) lines.push(`${label}) ${options[i]}`);
  });
  return lines.join('\n');
}

function extractOptions(rawText) {
  const text = String(rawText || '');

  // Inline: A) foo B) bar C) baz D) qux
  const inlineAll = text.match(
    /(?:\(?[A-D]\)?[\).:\-]\s*)(.+?)(?=\s+\(?[A-D]\)?[\).:\-]\s*|\s*$)/gi
  );
  if (inlineAll && inlineAll.length >= 4) {
    const fromLabels = [...text.matchAll(/\(?[A-D]\)?[\).:\-]\s*([^\n]+?)(?=\s+\(?[A-D]\)?[\).:\-]|$)/gi)];
    if (fromLabels.length >= 4) {
      return fromLabels.slice(0, 4).map((m) => m[1].trim());
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const options = [];
  const optionLine =
    /^(?:\(?[A-Da-d]\)?|\(?[1-4]\)?)[\).:\-\s]+(.+)$/i;
  const optionLabelOnly = /^(?:\(?[A-Da-d1-4]\)?[\).:\-\s]*)$/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Skip question lines (before first option marker)
    if (!options.length && !optionLine.test(line) && !optionLabelOnly.test(line)) {
      continue;
    }

    if (optionLabelOnly.test(line) && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!/^(?:answer|ans|correct|\(?[A-Da-d1-4]\)?[\).:\-\s])/i.test(next)) {
        options.push(next);
        i += 1;
        continue;
      }
    }

    const m = line.match(optionLine);
    if (m && m[1].trim()) {
      options.push(m[1].trim());
    }
  }

  if (options.length >= 4) return options.slice(0, 4);

  const inline = text.match(/(?:^|\n)\s*\(?[A-D1-4]\)?[\).:\-]\s*([^\n]+)/gi);
  if (inline && inline.length >= 4) {
    return inline
      .slice(0, 4)
      .map((s) => s.replace(/^\s*\(?[A-D1-4]\)?[\).:\-]\s*/i, '').trim());
  }

  return options.length === 4 ? options : null;
}

function resolvePaperFields(input) {
  if (typeof input === 'string') {
    input = { rawText: input };
  }

  const rawText = String(input.rawText || '').trim();
  let question = String(input.question || '').trim();
  let options = null;

  if (Array.isArray(input.options) && input.options.length === 4) {
    options = input.options.map((o) => String(o).trim()).filter(Boolean);
    if (options.length !== 4) options = null;
  }

  if (!question) question = extractQuestion(rawText);
  if (!options) {
    const parsed = extractOptions(rawText);
    if (parsed) options = parsed;
  }

  if (question && options) {
    return {
      question,
      options,
      rawText: rawText || formatRawText(question, options),
    };
  }

  return { question, options, rawText };
}

function buildSearchQueries(rawText, options) {
  const question = extractQuestion(rawText);
  const queries = new Set();

  if (question) {
    queries.add(question);
    queries.add(`${question} answer`);
    if (options?.length === 4) {
      queries.add(`${question} ${options.join(' ')}`);
    }
  }

  return [...queries].slice(0, 3);
}

const MATHS_PATTERNS = [
  /\d+\s*[\+\-\*\/×÷%]\s*\d/,
  /\d+\s*%|\%\s*of/i,
  /find the value/i,
  /how many|how much|what is \d|what is the/i,
  /average|mean|median|mode|ratio|proportion|percentage/i,
  /profit|loss|discount|interest|principal|amount/i,
  /area|perimeter|volume|circumference|radius|diameter/i,
  /square root|sqrt|cube|\^2|\^3|²|³/,
  /lcm|hcf|gcd|factor|multiple|divisor/i,
  /equation|solve for|=\s*\?|\?\s*=/,
  /speed|distance|time|km\/h|m\/s|kmph/i,
  /remainder|divided by|\d+\s*\/\s*\d+/,
  /simple interest|compound interest|si\b|ci\b/i,
  /mixture|alligation|partnership/i,
];

const REASONING_PATTERNS = [
  /series|sequence|pattern|next term|missing term|complete the/i,
  /analogy|::/,
  /blood relation|mother|father|brother|sister|cousin|uncle|aunt|nephew|niece/i,
  /direction|north|south|east|west|facing|turns? (left|right)/i,
  /coding|decoding|if .* (is|are) coded/i,
  /syllogism|all .* are|some .* are|no .* are/i,
  /odd one out|different from the rest/i,
  /sitting|arrangement|puzzle|row of/i,
  /mirror|water image|figure|dice|cubes?/i,
  /calendar|clock|day.*after|day.*before|weekday/i,
  /comes next|find the missing|look at the/i,
  /number of triangles|count the/i,
  /letter series|alpha(?:bet)?(?:ical)? series/i,
];

function detectQuestionType(rawText, options) {
  const question = extractQuestion(rawText);
  const blob = `${question} ${(options || []).join(' ')}`.toLowerCase();

  const mathsScore = MATHS_PATTERNS.filter((p) => p.test(blob)).length;
  const reasoningScore = REASONING_PATTERNS.filter((p) => p.test(blob)).length;

  const numericOptions = (options || []).filter((o) =>
    /^[\d.,\s%₹\-+xX()]+$/.test(String(o).trim())
  ).length;

  if (reasoningScore >= 1) return 'reasoning';
  if (mathsScore >= 1 || numericOptions >= 3 || /%/.test(blob)) return 'maths';

  return 'factual';
}

module.exports = {
  extractQuestion,
  extractOptions,
  formatRawText,
  resolvePaperFields,
  buildSearchQueries,
  detectQuestionType,
};
