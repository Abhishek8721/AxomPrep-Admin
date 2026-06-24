/**
 * Returns the next sequential question number for a category or exam group.
 */
async function getNextQuestionId(col, groupField, groupValue) {
  const snapshot = await col.where(groupField, '==', groupValue).get();
  let max = 0;
  for (const doc of snapshot.docs) {
    const n = Number(doc.data().id);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** Next question number for question_papers (supports legacy `paper` field). */
async function getNextPaperQuestionId(col, examId) {
  let max = 0;
  for (const field of ['examId', 'paper']) {
    const snapshot = await col.where(field, '==', examId).get();
    for (const doc of snapshot.docs) {
      const n = Number(doc.data().id);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

function resolveQuestionId(body, fallbackId) {
  const raw = body.id;
  if (raw === undefined || raw === null || raw === '') {
    return fallbackId;
  }
  const n = Number(raw);
  if (Number.isNaN(n) || n < 1) {
    throw new Error('Numeric id must be a positive number');
  }
  return n;
}

module.exports = { getNextQuestionId, getNextPaperQuestionId, resolveQuestionId };
