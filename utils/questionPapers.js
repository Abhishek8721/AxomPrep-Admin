const PAPERS = [
  { id: 'adre', label: 'ADRE', icon: '📋' },
  { id: 'ssc_gd', label: 'SSC GD', icon: '🛡️' },
  { id: 'assam_police', label: 'Assam Police', icon: '👮' },
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

function buildDocId(paper, id) {
  return `${paper}_${id}`;
}

function parseDocId(docId) {
  const idx = docId.lastIndexOf('_');
  if (idx === -1) return { paper: '', id: docId };
  return {
    paper: docId.slice(0, idx),
    id: docId.slice(idx + 1),
  };
}

function validateQuestionPaper(body) {
  const errors = [];
  const { id, paper, question, options, correctAnswer, explanation, difficulty } = body;

  if (!paper || !PAPERS.some((p) => p.id === paper)) {
    errors.push('Valid paper is required (adre, ssc_gd, assam_police)');
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
    paper: body.paper,
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
  PAPERS,
  DIFFICULTIES,
  buildDocId,
  parseDocId,
  validateQuestionPaper,
  toFirestorePayload,
  fromFirestoreDoc,
};
