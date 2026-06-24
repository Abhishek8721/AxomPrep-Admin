let meta = { categories: [], examTypes: [], exams: [], difficulties: [] };
let allQuestions = [];
let allExams = [];
let deleteTarget = null;
let deleteMode = 'practice';
let currentMode = 'practice'; // 'practice' | 'exams' | 'papers'

function apiBase() {
  if (currentMode === 'papers') return '/api/question-papers';
  if (currentMode === 'exams') return '/api/exams';
  return '/api/questions';
}

function groupField() {
  return currentMode === 'papers' ? 'examId' : 'category';
}

function groupOptions() {
  if (currentMode === 'papers') return meta.exams;
  return meta.categories;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showAlert(msg, type = 'success') {
  const el = document.getElementById('alertBox');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function difficultyClass(d) {
  if (d === 'Easy') return 'badge-easy';
  if (d === 'Hard') return 'badge-hard';
  return 'badge-medium';
}

function examLabel(exam) {
  if (!exam) return '';
  const year = exam.year ? ` (${exam.year})` : '';
  return `${exam.icon || '📋'} ${exam.title}${year}`;
}

function groupLabel(id) {
  if (currentMode === 'papers') {
    const exam = meta.exams.find((e) => e.id === id);
    return exam ? examLabel(exam) : id;
  }
  const cat = meta.categories.find((c) => c.id === id);
  return cat ? `${cat.icon} ${cat.label}` : id;
}

function updateModeUi() {
  const isPractice = currentMode === 'practice';
  const isExams = currentMode === 'exams';
  const isPapers = currentMode === 'papers';

  document.getElementById('tabPractice').classList.toggle('active', isPractice);
  document.getElementById('tabExams').classList.toggle('active', isExams);
  document.getElementById('tabPapers').classList.toggle('active', isPapers);

  document.getElementById('btnNew').textContent = isExams ? '+ New Exam' : '+ New Question';
  document.getElementById('filterDifficulty').parentElement.style.display = isExams ? 'none' : '';
  document.getElementById('searchInput').placeholder = isExams
    ? 'Search exams...'
    : 'Search questions...';

  if (isExams) {
    document.getElementById('thGroup').textContent = 'Type';
    document.getElementById('filterCategory').innerHTML = '<option value="">All Types</option>';
    meta.examTypes.forEach((t) => {
      document.getElementById('filterCategory').innerHTML +=
        `<option value="${t.id}">${t.icon} ${t.label}</option>`;
    });
    return;
  }

  const filterLabel = isPapers ? 'All Exams' : 'All Categories';
  const groupLabelText = isPapers ? 'Exam' : 'Category';
  document.getElementById('thGroup').textContent = groupLabelText;
  document.getElementById('fieldGroupLabel').textContent = `${groupLabelText} *`;

  const filterSelect = document.getElementById('filterCategory');
  const fieldCat = document.getElementById('fieldCategory');
  filterSelect.innerHTML = `<option value="">${filterLabel}</option>`;
  fieldCat.innerHTML = '';
  groupOptions().forEach((c) => {
    const label = isPapers ? examLabel(c) : `${c.icon} ${c.label}`;
    const value = isPapers ? c.id : c.id;
    filterSelect.innerHTML += `<option value="${value}">${label}</option>`;
    fieldCat.innerHTML += `<option value="${value}">${label}</option>`;
  });

  document.getElementById('aiPasteSection').classList.toggle('hidden', isPapers);
}

async function checkAuth() {
  const session = await fetch('/api/session').then((r) => r.json());
  if (!session.authenticated) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function loadMeta() {
  meta = await api('/api/meta');
  allExams = meta.exams || [];

  const fieldDiff = document.getElementById('fieldDifficulty');
  fieldDiff.innerHTML = '';
  meta.difficulties.forEach((d) => {
    fieldDiff.innerHTML += `<option value="${d}">${d}</option>`;
  });

  const fieldExamType = document.getElementById('fieldExamType');
  fieldExamType.innerHTML = '';
  meta.examTypes.forEach((t) => {
    fieldExamType.innerHTML += `<option value="${t.id}">${t.icon} ${t.label}</option>`;
  });

  updateModeUi();
}

async function loadData() {
  if (currentMode === 'exams') {
    await loadExams();
  } else {
    await loadQuestions();
  }
}

async function loadExams() {
  const data = await api('/api/exams');
  allExams = data.exams;

  const typeFilter = document.getElementById('filterCategory').value;
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  let filtered = allExams;
  if (typeFilter) {
    filtered = filtered.filter((e) => e.examType === typeFilter);
  }
  if (search) {
    filtered = filtered.filter(
      (e) =>
        e.title?.toLowerCase().includes(search) ||
        e.id?.toLowerCase().includes(search) ||
        String(e.year || '').includes(search)
    );
  }

  renderExamsTable(filtered);
  document.getElementById('statsBar').textContent =
    `${filtered.length} exam${filtered.length !== 1 ? 's' : ''} shown`;
}

function renderExamsTable(exams) {
  const tbody = document.getElementById('questionsBody');
  if (!exams.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty">No exams found. Click "+ New Exam" to add one.</td></tr>';
    return;
  }

  tbody.innerHTML = exams
    .map((e) => {
      const active = e.active !== false;
      return `
        <tr>
          <td><strong>${escapeHtml(e.id)}</strong></td>
          <td><span class="badge badge-cat">${escapeHtml(e.examType)}</span></td>
          <td class="q-text" title="${escapeHtml(e.title)}">${e.icon || '📋'} ${escapeHtml(e.title)}</td>
          <td>${e.year || '—'}</td>
          <td>${escapeHtml(e.duration || '—')}</td>
          <td><span class="badge ${active ? 'badge-active' : 'badge-inactive'}">${active ? 'Active' : 'Hidden'}</span></td>
          <td class="actions">
            <button class="btn btn-outline btn-sm" onclick="openEditExam('${e.docId || e.id}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="toggleExamActive('${e.docId || e.id}')">${active ? 'Hide' : 'Show'}</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteExam('${e.docId || e.id}', '${escapeHtml(e.title)}')">Delete</button>
          </td>
        </tr>`;
    })
    .join('');
}

async function loadQuestions() {
  const group = document.getElementById('filterCategory').value;
  const params = new URLSearchParams();
  if (group) params.set(groupField(), group);
  const search = document.getElementById('searchInput').value.trim();
  if (search) params.set('search', search);

  const data = await api(`${apiBase()}?${params}`);
  allQuestions = data.questions;

  const diffFilter = document.getElementById('filterDifficulty').value;
  const filtered = diffFilter
    ? allQuestions.filter((q) => q.difficulty === diffFilter)
    : allQuestions;

  renderTable(filtered);
  document.getElementById('statsBar').textContent =
    `${filtered.length} question${filtered.length !== 1 ? 's' : ''} shown`;
}

function renderTable(questions) {
  const tbody = document.getElementById('questionsBody');
  if (!questions.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty">No questions found. Click "+ New Question" to add one.</td></tr>';
    return;
  }

  const field = groupField();
  tbody.innerHTML = questions
    .map((q) => {
      const answerLabel = ['A', 'B', 'C', 'D'][q.correctAnswer] || '?';
      const active = q.active !== false;
      return `
        <tr>
          <td><strong>${q.id}</strong><br><small style="color:var(--muted)">${q.docId}</small></td>
          <td><span class="badge badge-cat">${groupLabel(q[field])}</span></td>
          <td class="q-text" title="${escapeHtml(q.question)}">${escapeHtml(q.question)}</td>
          <td><span class="badge ${difficultyClass(q.difficulty)}">${q.difficulty}</span></td>
          <td>${answerLabel}</td>
          <td><span class="badge ${active ? 'badge-active' : 'badge-inactive'}">${active ? 'Active' : 'Hidden'}</span></td>
          <td class="actions">
            <button class="btn btn-outline btn-sm" onclick="openEdit('${q.docId}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="toggleActive('${q.docId}')">${active ? 'Hide' : 'Show'}</button>
            <button class="btn btn-danger btn-sm" onclick="openDelete('${q.docId}', '${escapeHtml(q.question).slice(0, 60)}')">Delete</button>
          </td>
        </tr>`;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openModal() {
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('formError').classList.add('hidden');
}

function openExamModal() {
  document.getElementById('examModal').classList.remove('hidden');
}

function closeExamModal() {
  document.getElementById('examModal').classList.add('hidden');
  document.getElementById('examFormError').classList.add('hidden');
}

function handleNewClick() {
  if (currentMode === 'exams') openNewExam();
  else openNew();
}

function openNew() {
  document.getElementById('modalTitle').textContent = 'New Question';
  document.getElementById('questionForm').reset();
  document.getElementById('editDocId').value = '';
  document.getElementById('fieldActive').checked = true;
  document.getElementById('aiRawInput').value = '';
  document.getElementById('aiError').classList.add('hidden');
  document.getElementById('aiVerifyNotice').classList.add('hidden');
  setQuestionIdField(false);
  setAiSectionVisible(currentMode === 'practice');
  openModal();
}

function openNewExam() {
  document.getElementById('examModalTitle').textContent = 'New Exam';
  document.getElementById('examForm').reset();
  document.getElementById('editExamDocId').value = '';
  document.getElementById('fieldExamActive').checked = true;
  document.getElementById('fieldExamDuration').value = '60 min';
  document.getElementById('fieldExamIcon').value = '📋';
  document.getElementById('fieldExamSortOrder').value = '0';
  openExamModal();
}

function setAiSectionVisible(visible) {
  document.getElementById('aiPasteSection').classList.toggle('hidden', !visible);
  document.getElementById('formDivider').classList.toggle('hidden', !visible);
}

function setQuestionIdField(visible, value) {
  const row = document.getElementById('fieldIdRow');
  row.classList.toggle('hidden', !visible);
  if (value != null) document.getElementById('fieldId').value = value;
}

function fillQuestionForm(data, { keepCategory = false } = {}) {
  if (!keepCategory && (data.category || data.examId || data.paper)) {
    document.getElementById('fieldCategory').value = data.category || data.examId || data.paper;
  }
  document.getElementById('fieldDifficulty').value = data.difficulty;
  document.getElementById('fieldQuestion').value = data.question;
  document.getElementById('fieldCorrectAnswer').value = data.correctAnswer;
  document.getElementById('fieldExplanation').value = data.explanation;
  (data.options || []).forEach((opt, i) => {
    const el = document.getElementById(`opt${i}`);
    if (el) el.value = opt;
  });
}

function showAiVerification(data) {
  const el = document.getElementById('aiVerifyNotice');
  const labels = ['A', 'B', 'C', 'D'];
  const correctLabel = labels[data.correctAnswer] || '?';
  const method =
    data.questionType === 'maths'
      ? 'step-by-step maths solution'
      : data.questionType === 'reasoning'
        ? 'step-by-step reasoning'
        : 'web search';

  if (data.sourceAnswerWrong) {
    el.className = 'ai-verify-notice ai-verify-warn';
    el.textContent =
      `⚠ Source had a wrong answer. Verified via ${method}: ${correctLabel}. ${data.verificationNote || ''}`.trim();
  } else {
    el.className = 'ai-verify-notice ai-verify-ok';
    el.textContent =
      `✓ Verified via ${method}: ${correctLabel}. ${data.verificationNote || 'Review the explanation before saving.'}`.trim();
  }
}

async function generateWithAi() {
  const rawText = document.getElementById('aiRawInput').value.trim();
  const errEl = document.getElementById('aiError');
  const verifyEl = document.getElementById('aiVerifyNotice');
  const btn = document.getElementById('btnGenerateAi');

  errEl.classList.add('hidden');
  verifyEl.classList.add('hidden');
  if (!rawText) {
    errEl.textContent = 'Paste the question and options first.';
    errEl.classList.remove('hidden');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying with AI...';

  const category = document.getElementById('fieldCategory').value;
  if (!category) {
    errEl.textContent = 'Select a category first.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const generated = await api('/api/questions/generate', {
      method: 'POST',
      body: JSON.stringify({ rawText, category }),
    });
    fillQuestionForm(generated, { keepCategory: true });
    showAiVerification(generated);
    const alertMsg = generated.sourceAnswerWrong
      ? 'Wrong source answer corrected — please review before saving'
      : 'Question generated and answer verified — review and save when ready';
    showAlert(alertMsg, generated.sourceAnswerWrong ? 'error' : 'success');
    document.getElementById('fieldQuestion').focus();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function openEdit(docId) {
  const q = await api(`${apiBase()}/${docId}`);
  document.getElementById('modalTitle').textContent = 'Edit Question';
  setAiSectionVisible(false);
  document.getElementById('editDocId').value = docId;
  document.getElementById('fieldCategory').value = q.category || q.examId || q.paper;
  setQuestionIdField(true, q.id);
  document.getElementById('fieldDifficulty').value = q.difficulty;
  document.getElementById('fieldQuestion').value = q.question;
  document.getElementById('fieldCorrectAnswer').value = q.correctAnswer;
  document.getElementById('fieldExplanation').value = q.explanation;
  document.getElementById('fieldActive').checked = q.active !== false;
  (q.options || []).forEach((opt, i) => {
    const el = document.getElementById(`opt${i}`);
    if (el) el.value = opt;
  });
  openModal();
}

async function openEditExam(docId) {
  const e = await api(`/api/exams/${docId}`);
  document.getElementById('examModalTitle').textContent = 'Edit Exam';
  document.getElementById('editExamDocId').value = docId;
  document.getElementById('fieldExamId').value = e.id;
  document.getElementById('fieldExamTitle').value = e.title;
  document.getElementById('fieldExamType').value = e.examType;
  document.getElementById('fieldExamYear').value = e.year ?? '';
  document.getElementById('fieldExamDuration').value = e.duration || '60 min';
  document.getElementById('fieldExamIcon').value = e.icon || '📋';
  document.getElementById('fieldExamDescription').value = e.description || '';
  document.getElementById('fieldExamSortOrder').value = e.sortOrder ?? 0;
  document.getElementById('fieldExamActive').checked = e.active !== false;
  openExamModal();
}

async function saveQuestion(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  errEl.classList.add('hidden');

  const groupValue = document.getElementById('fieldCategory').value;
  const docId = document.getElementById('editDocId').value;
  const payload = {
    difficulty: document.getElementById('fieldDifficulty').value,
    question: document.getElementById('fieldQuestion').value,
    options: [0, 1, 2, 3].map((i) => document.getElementById(`opt${i}`).value),
    correctAnswer: Number(document.getElementById('fieldCorrectAnswer').value),
    explanation: document.getElementById('fieldExplanation').value,
    active: document.getElementById('fieldActive').checked,
  };

  if (docId) {
    payload.id = Number(document.getElementById('fieldId').value);
  }

  if (currentMode === 'papers') {
    payload.examId = groupValue;
  } else {
    payload.category = groupValue;
  }

  try {
    if (docId) {
      await api(`${apiBase()}/${docId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showAlert('Question updated successfully');
    } else {
      await api(apiBase(), { method: 'POST', body: JSON.stringify(payload) });
      showAlert('Question created successfully');
    }
    closeModal();
    loadData();
    if (currentMode === 'papers') loadMeta();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function saveExam(e) {
  e.preventDefault();
  const errEl = document.getElementById('examFormError');
  errEl.classList.add('hidden');

  const payload = {
    id: document.getElementById('fieldExamId').value.trim(),
    title: document.getElementById('fieldExamTitle').value,
    examType: document.getElementById('fieldExamType').value,
    year: document.getElementById('fieldExamYear').value,
    duration: document.getElementById('fieldExamDuration').value,
    icon: document.getElementById('fieldExamIcon').value,
    description: document.getElementById('fieldExamDescription').value,
    sortOrder: Number(document.getElementById('fieldExamSortOrder').value) || 0,
    active: document.getElementById('fieldExamActive').checked,
  };

  try {
    const docId = document.getElementById('editExamDocId').value;
    if (docId) {
      await api(`/api/exams/${docId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showAlert('Exam updated successfully');
    } else {
      await api('/api/exams', { method: 'POST', body: JSON.stringify(payload) });
      showAlert('Exam created successfully');
    }
    closeExamModal();
    await loadMeta();
    loadData();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function openDelete(docId, preview) {
  deleteTarget = docId;
  deleteMode = currentMode;
  document.getElementById('deleteMessage').textContent =
    `Delete "${preview}..."? This cannot be undone.`;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function openDeleteExam(docId, preview) {
  openDelete(docId, preview);
}

function closeDeleteModal() {
  deleteTarget = null;
  document.getElementById('deleteModal').classList.add('hidden');
}

async function confirmDelete() {
  if (!deleteTarget) return;
  const base =
    deleteMode === 'exams'
      ? '/api/exams'
      : deleteMode === 'papers'
        ? '/api/question-papers'
        : '/api/questions';
  try {
    await api(`${base}/${deleteTarget}`, { method: 'DELETE' });
    showAlert(deleteMode === 'exams' ? 'Exam deleted' : 'Question deleted');
    closeDeleteModal();
    if (deleteMode === 'exams') await loadMeta();
    loadData();
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

async function toggleActive(docId) {
  try {
    const result = await api(`${apiBase()}/${docId}/toggle`, { method: 'PATCH' });
    showAlert(result.active ? 'Question is now visible' : 'Question hidden from app');
    loadData();
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

async function toggleExamActive(docId) {
  try {
    const result = await api(`/api/exams/${docId}/toggle`, { method: 'PATCH' });
    showAlert(result.active ? 'Exam is now visible' : 'Exam hidden from app');
    loadData();
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

function switchMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterDifficulty').value = '';
  document.getElementById('searchInput').value = '';
  updateModeUi();
  loadData();
}

function updateTableHeadersForExams() {
  const thead = document.querySelector('table thead tr');
  if (currentMode === 'exams') {
    thead.innerHTML = `
      <th>ID</th>
      <th>Type</th>
      <th>Title</th>
      <th>Year</th>
      <th>Duration</th>
      <th>Status</th>
      <th>Actions</th>`;
  } else {
    thead.innerHTML = `
      <th>ID</th>
      <th id="thGroup">${currentMode === 'papers' ? 'Exam' : 'Category'}</th>
      <th>Question</th>
      <th>Difficulty</th>
      <th>Answer</th>
      <th>Status</th>
      <th>Actions</th>`;
  }
}

const _origSwitchMode = switchMode;
switchMode = function (mode) {
  _origSwitchMode(mode);
  updateTableHeadersForExams();
};

// Event listeners
document.getElementById('btnNew').addEventListener('click', handleNewClick);
document.getElementById('btnGenerateAi').addEventListener('click', generateWithAi);
document.getElementById('tabPractice').addEventListener('click', () => switchMode('practice'));
document.getElementById('tabExams').addEventListener('click', () => switchMode('exams'));
document.getElementById('tabPapers').addEventListener('click', () => switchMode('papers'));
document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('questionForm').addEventListener('submit', saveQuestion);
document.getElementById('examForm').addEventListener('submit', saveExam);
document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
document.querySelectorAll('[data-close-exam]').forEach((el) => el.addEventListener('click', closeExamModal));
document.querySelectorAll('[data-close-delete]').forEach((el) => el.addEventListener('click', closeDeleteModal));

document.getElementById('filterCategory').addEventListener('change', loadData);
document.getElementById('filterDifficulty').addEventListener('change', loadData);
document.getElementById('searchInput').addEventListener('input', debounce(loadData, 300));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Boot
(async () => {
  if (!(await checkAuth())) return;
  await loadMeta();
  updateTableHeadersForExams();
  await loadData();
})();
