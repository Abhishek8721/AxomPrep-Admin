const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

function buildDocId(examId, id) {
  return `${examId}_${id}`;
}

function parseDocId(docId) {
  const match = docId.match(/^(.+)_(\d+)$/);
  if (!match) return { examId: docId, id: '' };
  return { examId: match[1], id: match[2] };
}

function validateQuestionPaper(body, knownExamIds = []) {
  const errors = [];
  const { id, examId, paper, question, options, correctAnswer, explanation, difficulty } = body;
  const resolvedExamId = examId || paper;

  if (!resolvedExamId || !String(resolvedExamId).trim()) {
    errors.push('Exam is required');
  } else if (knownExamIds.length && !knownExamIds.includes(resolvedExamId)) {
    errors.push('Selected exam does not exist — create it in the Exams tab first');
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
  const examId = body.examId || body.paper;
  return {
    id: Number(body.id),
    examId,
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
  const parsed = parseDocId(doc.id);
  return {
    docId: doc.id,
    ...data,
    examId: data.examId ?? data.paper ?? parsed.examId,
    id: data.id ?? Number(parsed.id),
  };
}

module.exports = {
  DIFFICULTIES,
  buildDocId,
  parseDocId,
  validateQuestionPaper,
  toFirestorePayload,
  fromFirestoreDoc,
};
