const CATEGORIES = [
  { id: 'assam_gk', label: 'Assam GK', icon: '📚' },
  { id: 'english', label: 'English', icon: '🔤' },
  { id: 'reasoning', label: 'Reasoning', icon: '🧠' },
  { id: 'maths', label: 'Maths', icon: '➗' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

function buildDocId(category, id) {
  return `${category}_${id}`;
}

function parseDocId(docId) {
  const idx = docId.lastIndexOf('_');
  if (idx === -1) return { category: '', id: docId };
  return {
    category: docId.slice(0, idx),
    id: docId.slice(idx + 1),
  };
}

function validateQuestion(body) {
  const errors = [];
  const { id, category, question, options, correctAnswer, explanation, difficulty } = body;

  if (!category || !CATEGORIES.some((c) => c.id === category)) {
    errors.push('Valid category is required');
  }
  if (id === undefined || id === null || Number.isNaN(Number(id))) {
    errors.push('Numeric id is required');
  }
  if (!question || !String(question).trim()) {
    errors.push('Question text is required');
  }
  if (!Array.isArray(options) || options.length !== 4) {
    errors.push('Exactly 4 options are required');
  } else if (options.some((o) => !String(o).trim())) {
    errors.push('All options must be non-empty');
  }
  const ca = Number(correctAnswer);
  if (Number.isNaN(ca) || ca < 0 || ca > 3) {
    errors.push('correctAnswer must be 0–3');
  }
  if (!explanation || !String(explanation).trim()) {
    errors.push('Explanation is required');
  }
  if (!difficulty || !DIFFICULTIES.includes(difficulty)) {
    errors.push('Difficulty must be Easy, Medium, or Hard');
  }

  return errors;
}

function toFirestorePayload(body) {
  return {
    id: Number(body.id),
    category: body.category,
    question: String(body.question).trim(),
    options: body.options.map((o) => String(o).trim()),
    correctAnswer: Number(body.correctAnswer),
    explanation: String(body.explanation).trim(),
    difficulty: body.difficulty,
    active: body.active !== false,
    updatedAt: new Date().toISOString(),
  };
}

function fromFirestoreDoc(doc) {
  const data = doc.data();
  return {
    docId: doc.id,
    ...data,
    id: data.id ?? Number(parseDocId(doc.id).id),
  };
}

module.exports = {
  CATEGORIES,
  DIFFICULTIES,
  buildDocId,
  parseDocId,
  validateQuestion,
  toFirestorePayload,
  fromFirestoreDoc,
};
