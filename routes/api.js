const express = require('express');
const {
  getDb,
  getCollectionName,
  getQuestionPaperCollectionName,
  getExamsCollectionName,
} = require('../config/firebase');
const {
  CATEGORIES,
  DIFFICULTIES,
  buildDocId,
  validateQuestion,
  toFirestorePayload,
  fromFirestoreDoc,
} = require('../utils/questions');
const {
  EXAM_TYPES,
  validateExam,
  toFirestorePayload: toExamPayload,
  fromFirestoreDoc: fromExamDoc,
} = require('../utils/exams');
const {
  buildDocId: buildPaperDocId,
  validateQuestionPaper,
  toFirestorePayload: toPaperPayload,
  fromFirestoreDoc: fromPaperDoc,
} = require('../utils/questionPapers');
const { requireAuth } = require('../middleware/auth');
const { generateQuestionFromPaste } = require('../utils/ai');
const {
  getNextQuestionId,
  getNextPaperQuestionId,
  resolveQuestionId,
} = require('../utils/nextQuestionId');

const router = express.Router();

router.use(requireAuth);

async function getKnownExamIds() {
  const snapshot = await getDb().collection(getExamsCollectionName()).get();
  return snapshot.docs.map((doc) => doc.id);
}

/** GET /api/meta — categories, exam types, and difficulties */
router.get('/meta', async (_req, res) => {
  try {
    const examsSnapshot = await getDb().collection(getExamsCollectionName()).get();
    const exams = examsSnapshot.docs
      .map(fromExamDoc)
      .sort((a, b) => {
        if (a.examType !== b.examType) return a.examType.localeCompare(b.examType);
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    res.json({ categories: CATEGORIES, examTypes: EXAM_TYPES, exams, difficulties: DIFFICULTIES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/questions — list with optional ?category= & ?search= */
router.get('/questions', async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(getCollectionName());
    const { category, search } = req.query;

    let snapshot;
    if (category) {
      snapshot = await col.where('category', '==', category).get();
    } else {
      snapshot = await col.get();
    }

    let questions = snapshot.docs.map(fromFirestoreDoc);

    if (search) {
      const q = String(search).toLowerCase();
      questions = questions.filter(
        (item) =>
          item.question?.toLowerCase().includes(q) ||
          item.explanation?.toLowerCase().includes(q) ||
          String(item.id).includes(q)
      );
    }

    questions.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return (a.id || 0) - (b.id || 0);
    });

    res.json({ questions, total: questions.length });
  } catch (err) {
    console.error('List questions error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/questions/:docId */
router.get('/questions/:docId', async (req, res) => {
  try {
    const doc = await getDb().collection(getCollectionName()).doc(req.params.docId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(fromFirestoreDoc(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/questions/generate — rephrase pasted MCQ with AI */
router.post('/questions/generate', async (req, res) => {
  try {
    const generated = await generateQuestionFromPaste(req.body.rawText, req.body.category);
    res.json(generated);
  } catch (err) {
    console.error('AI generate error:', err);
    res.status(err.message.includes('not configured') ? 503 : 400).json({ error: err.message });
  }
});

/** POST /api/questions — create */
router.post('/questions', async (req, res) => {
  const errors = validateQuestion(req.body, { isCreate: true });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  try {
    const col = getDb().collection(getCollectionName());
    const nextId = await getNextQuestionId(col, 'category', req.body.category);
    const questionId = resolveQuestionId(req.body, nextId);
    const docId = buildDocId(req.body.category, questionId);
    const payload = toFirestorePayload({ ...req.body, id: questionId });
    payload.createdAt = new Date().toISOString();

    const ref = col.doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ error: `Question ${docId} already exists` });
    }
    await ref.set(payload);
    res.status(201).json({ docId, ...payload });
  } catch (err) {
    console.error('Create error:', err);
    res.status(err.message.includes('Numeric id') ? 400 : 500).json({ error: err.message });
  }
});

/** PUT /api/questions/:docId — update */
router.put('/questions/:docId', async (req, res) => {
  const errors = validateQuestion(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const newDocId = buildDocId(req.body.category, req.body.id);
  const payload = toFirestorePayload(req.body);

  try {
    const col = getDb().collection(getCollectionName());
    const oldRef = col.doc(req.params.docId);

    if (newDocId !== req.params.docId) {
      const conflict = await col.doc(newDocId).get();
      if (conflict.exists) {
        return res.status(409).json({ error: `Target id ${newDocId} already exists` });
      }
      const oldData = (await oldRef.get()).data();
      await col.doc(newDocId).set({
        ...payload,
        createdAt: oldData?.createdAt || new Date().toISOString(),
      });
      await oldRef.delete();
      return res.json({ docId: newDocId, ...payload });
    }

    await oldRef.set(payload, { merge: true });
    res.json({ docId: req.params.docId, ...payload });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/questions/:docId */
router.delete('/questions/:docId', async (req, res) => {
  try {
    const ref = getDb().collection(getCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    await ref.delete();
    res.json({ success: true, docId: req.params.docId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/questions/:docId/toggle — enable/disable */
router.patch('/questions/:docId/toggle', async (req, res) => {
  try {
    const ref = getDb().collection(getCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const active = !(doc.data().active ?? true);
    await ref.update({ active, updatedAt: new Date().toISOString() });
    res.json({ docId: req.params.docId, active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Question Papers (`question_papers` collection) ─────────────────

/** GET /api/question-papers — list with optional ?paper= & ?search= */
router.get('/question-papers', async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(getQuestionPaperCollectionName());
    const { paper, search } = req.query;
    const examId = req.query.examId || paper;

    let snapshot;
    if (examId) {
      snapshot = await col.where('examId', '==', examId).get();
      if (snapshot.empty) {
        snapshot = await col.where('paper', '==', examId).get();
      }
    } else {
      snapshot = await col.get();
    }

    let questions = snapshot.docs.map(fromPaperDoc);

    if (search) {
      const q = String(search).toLowerCase();
      questions = questions.filter(
        (item) =>
          item.question?.toLowerCase().includes(q) ||
          item.explanation?.toLowerCase().includes(q) ||
          String(item.id).includes(q)
      );
    }

    questions.sort((a, b) => {
      const aGroup = a.examId || a.paper || '';
      const bGroup = b.examId || b.paper || '';
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
      return (a.id || 0) - (b.id || 0);
    });

    res.json({ questions, total: questions.length });
  } catch (err) {
    console.error('List question papers error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/question-papers/:docId */
router.get('/question-papers/:docId', async (req, res) => {
  try {
    const doc = await getDb().collection(getQuestionPaperCollectionName()).doc(req.params.docId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json(fromPaperDoc(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/question-papers — create */
router.post('/question-papers', async (req, res) => {
  const knownExamIds = await getKnownExamIds();
  const errors = validateQuestionPaper(req.body, knownExamIds, { isCreate: true });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const examId = req.body.examId || req.body.paper;

  try {
    const col = getDb().collection(getQuestionPaperCollectionName());
    const nextId = await getNextPaperQuestionId(col, examId);
    const questionId = resolveQuestionId(req.body, nextId);
    const docId = buildPaperDocId(examId, questionId);
    const payload = toPaperPayload({ ...req.body, examId, id: questionId });
    payload.createdAt = new Date().toISOString();

    const ref = col.doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ error: `Question ${docId} already exists` });
    }
    await ref.set(payload);
    res.status(201).json({ docId, ...payload });
  } catch (err) {
    console.error('Create question paper error:', err);
    res.status(err.message.includes('Numeric id') ? 400 : 500).json({ error: err.message });
  }
});

/** PUT /api/question-papers/:docId — update */
router.put('/question-papers/:docId', async (req, res) => {
  const knownExamIds = await getKnownExamIds();
  const errors = validateQuestionPaper(req.body, knownExamIds);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const examId = req.body.examId || req.body.paper;
  const newDocId = buildPaperDocId(examId, req.body.id);
  const payload = toPaperPayload(req.body);

  try {
    const col = getDb().collection(getQuestionPaperCollectionName());
    const oldRef = col.doc(req.params.docId);

    if (newDocId !== req.params.docId) {
      const conflict = await col.doc(newDocId).get();
      if (conflict.exists) {
        return res.status(409).json({ error: `Target id ${newDocId} already exists` });
      }
      const oldData = (await oldRef.get()).data();
      await col.doc(newDocId).set({
        ...payload,
        createdAt: oldData?.createdAt || new Date().toISOString(),
      });
      await oldRef.delete();
      return res.json({ docId: newDocId, ...payload });
    }

    await oldRef.set(payload, { merge: true });
    res.json({ docId: req.params.docId, ...payload });
  } catch (err) {
    console.error('Update question paper error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/question-papers/:docId */
router.delete('/question-papers/:docId', async (req, res) => {
  try {
    const ref = getDb().collection(getQuestionPaperCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    await ref.delete();
    res.json({ success: true, docId: req.params.docId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/question-papers/:docId/toggle — enable/disable */
router.patch('/question-papers/:docId/toggle', async (req, res) => {
  try {
    const ref = getDb().collection(getQuestionPaperCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const active = !(doc.data().active ?? true);
    await ref.update({ active, updatedAt: new Date().toISOString() });
    res.json({ docId: req.params.docId, active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Exams catalog (`exams` collection) ─────────────────────────────

/** GET /api/exams */
router.get('/exams', async (_req, res) => {
  try {
    const snapshot = await getDb().collection(getExamsCollectionName()).get();
    const exams = snapshot.docs
      .map(fromExamDoc)
      .sort((a, b) => {
        if (a.examType !== b.examType) return a.examType.localeCompare(b.examType);
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    res.json({ exams, total: exams.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/exams/:docId */
router.get('/exams/:docId', async (req, res) => {
  try {
    const doc = await getDb().collection(getExamsCollectionName()).doc(req.params.docId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    res.json(fromExamDoc(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/exams — create */
router.post('/exams', async (req, res) => {
  const errors = validateExam(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const docId = String(req.body.id).trim();
  const payload = toExamPayload(req.body);
  payload.createdAt = new Date().toISOString();

  try {
    const ref = getDb().collection(getExamsCollectionName()).doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ error: `Exam ${docId} already exists` });
    }
    await ref.set(payload);
    res.status(201).json({ docId, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/exams/:docId — update */
router.put('/exams/:docId', async (req, res) => {
  const errors = validateExam(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const newDocId = String(req.body.id).trim();
  const payload = toExamPayload(req.body);

  try {
    const col = getDb().collection(getExamsCollectionName());
    const oldRef = col.doc(req.params.docId);

    if (newDocId !== req.params.docId) {
      const conflict = await col.doc(newDocId).get();
      if (conflict.exists) {
        return res.status(409).json({ error: `Target id ${newDocId} already exists` });
      }
      const oldData = (await oldRef.get()).data();
      await col.doc(newDocId).set({
        ...payload,
        createdAt: oldData?.createdAt || new Date().toISOString(),
      });
      await oldRef.delete();
      return res.json({ docId: newDocId, ...payload });
    }

    await oldRef.set(payload, { merge: true });
    res.json({ docId: req.params.docId, ...payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/exams/:docId */
router.delete('/exams/:docId', async (req, res) => {
  try {
    const ref = getDb().collection(getExamsCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    await ref.delete();
    res.json({ success: true, docId: req.params.docId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/exams/:docId/toggle */
router.patch('/exams/:docId/toggle', async (req, res) => {
  try {
    const ref = getDb().collection(getExamsCollectionName()).doc(req.params.docId);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    const active = !(doc.data().active ?? true);
    await ref.update({ active, updatedAt: new Date().toISOString() });
    res.json({ docId: req.params.docId, active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
