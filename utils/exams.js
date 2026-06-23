const EXAM_TYPES = [
  { id: 'ADRE', label: 'ADRE', icon: '📋' },
  { id: 'SSC GD', label: 'SSC GD', icon: '🛡️' },
  { id: 'Assam Police', label: 'Assam Police', icon: '👮' },
];

const ID_PATTERN = /^[a-z0-9_]+$/;

function validateExam(body) {
  const errors = [];
  const { id, title, examType, description, duration } = body;

  if (!id || !ID_PATTERN.test(String(id))) {
    errors.push('Exam ID is required (lowercase letters, numbers, underscores — e.g. adre_grade3_2024)');
  }
  if (!title || !String(title).trim()) {
    errors.push('Title is required (e.g. ADRE Grade 3 2024)');
  }
  if (!examType || !EXAM_TYPES.some((t) => t.id === examType)) {
    errors.push('Valid exam type is required');
  }
  if (!description || !String(description).trim()) {
    errors.push('Description is required');
  }
  if (!duration || !String(duration).trim()) {
    errors.push('Duration is required (e.g. 60 min)');
  }
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    const year = Number(body.year);
    if (Number.isNaN(year) || year < 1990 || year > 2100) {
      errors.push('Year must be a valid year');
    }
  }

  return errors;
}

function toFirestorePayload(body) {
  const payload = {
    id: String(body.id).trim(),
    title: String(body.title).trim(),
    examType: body.examType,
    description: String(body.description).trim(),
    duration: String(body.duration).trim(),
    icon: String(body.icon || '📋').trim(),
    active: body.active !== false,
    sortOrder: Number(body.sortOrder) || 0,
    updatedAt: new Date().toISOString(),
  };
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    payload.year = Number(body.year);
  }
  return payload;
}

function fromFirestoreDoc(doc) {
  const data = doc.data();
  return {
    docId: doc.id,
    ...data,
    id: data.id ?? doc.id,
  };
}

module.exports = {
  EXAM_TYPES,
  ID_PATTERN,
  validateExam,
  toFirestorePayload,
  fromFirestoreDoc,
};
