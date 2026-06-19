const express = require('express');
const { getDb, getCollectionName } = require('../config/firebase');
const {
  CATEGORIES,
  DIFFICULTIES,
  buildDocId,
  validateQuestion,
  toFirestorePayload,
  fromFirestoreDoc,
} = require('../utils/questions');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/** GET /api/meta — categories and difficulties */
router.get('/meta', (_req, res) => {
  res.json({ categories: CATEGORIES, difficulties: DIFFICULTIES });
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

/** POST /api/questions — create */
router.post('/questions', async (req, res) => {
  const errors = validateQuestion(req.body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  const docId = buildDocId(req.body.category, req.body.id);
  const payload = toFirestorePayload(req.body);
  payload.createdAt = new Date().toISOString();

  try {
    const ref = getDb().collection(getCollectionName()).doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ error: `Question ${docId} already exists` });
    }
    await ref.set(payload);
    res.status(201).json({ docId, ...payload });
  } catch (err) {
    console.error('Create error:', err);
    res.status(500).json({ error: err.message });
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

module.exports = router;
