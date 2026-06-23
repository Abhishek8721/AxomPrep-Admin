let meta = { categories: [], papers: [], difficulties: [] };
let allQuestions = [];
let deleteTarget = null;
let currentMode = 'practice'; // 'practice' | 'papers'

function apiBase() {
  return currentMode === 'papers' ? '/api/question-papers' : '/api/questions';
}

function groupField() {
  return currentMode === 'papers' ? 'paper' : 'category';
}

function groupOptions() {
  return currentMode === 'papers' ? meta.papers : meta.categories;
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

function groupLabel(id) {
  const item = groupOptions().find((c) => c.id === id);
  return item ? `${item.icon} ${item.label}` : id;
}

function updateModeUi() {
  const isPapers = currentMode === 'papers';
  const filterSelect = document.getElementById('filterCategory');
  const fieldCat = document.getElementById('fieldCategory');
  const filterLabel = isPapers ? 'All Papers' : 'All Categories';
  const groupLabelText = isPapers ? 'Paper' : 'Category';

  document.getElementById('tabPractice').classList.toggle('active', !isPapers);
  document.getElementById('tabPapers').classList.toggle('active', isPapers);
  document.getElementById('thGroup').textContent = groupLabelText;
  document.getElementById('fieldGroupLabel').textContent = `${groupLabelText} *`;
  document.getElementById('aiPasteSection').classList.toggle('hidden', isPapers);

  filterSelect.innerHTML = `<option value="">${filterLabel}</option>`;
  fieldCat.innerHTML = '';
  groupOptions().forEach((c) => {
    filterSelect.innerHTML += `<option value="${c.id}">${c.icon} ${c.label}</option>`;
    fieldCat.innerHTML += `<option value="${c.id}">${c.icon} ${c.label}</option>`;
  });
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
  const fieldDiff = document.getElementById('fieldDifficulty');
  fieldDiff.innerHTML = '';
  meta.difficulties.forEach((d) => {
    fieldDiff.innerHTML += `<option value="${d}">${d}</option>`;
  });
  updateModeUi();
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

function openNew() {
  document.getElementById('modalTitle').textContent = 'New Question';
  document.getElementById('questionForm').reset();
  document.getElementById('editDocId').value = '';
  document.getElementById('fieldActive').checked = true;
  document.getElementById('aiRawInput').value = '';
  document.getElementById('aiError').classList.add('hidden');
  document.getElementById('aiVerifyNotice').classList.add('hidden');
  setAiSectionVisible(currentMode === 'practice');
  openModal();
}

function setAiSectionVisible(visible) {
  document.getElementById('aiPasteSection').classList.toggle('hidden', !visible);
  document.getElementById('formDivider').classList.toggle('hidden', !visible);
}

function suggestNextQuestionId(group) {
  const field = groupField();
  const ids = allQuestions
    .filter((q) => q[field] === group)
    .map((q) => Number(q.id))
    .filter((n) => !Number.isNaN(n));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function fillQuestionForm(data) {
  document.getElementById('fieldCategory').value = data.category || data.paper;
  document.getElementById('fieldId').value = suggestNextQuestionId(data.category || data.paper);
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

  try {
    const generated = await api('/api/questions/generate', {
      method: 'POST',
      body: JSON.stringify({ rawText }),
    });
    fillQuestionForm(generated);
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
  document.getElementById('fieldCategory').value = q.category || q.paper;
  document.getElementById('fieldId').value = q.id;
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

async function saveQuestion(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  errEl.classList.add('hidden');

  const groupValue = document.getElementById('fieldCategory').value;
  const payload = {
    id: Number(document.getElementById('fieldId').value),
    difficulty: document.getElementById('fieldDifficulty').value,
    question: document.getElementById('fieldQuestion').value,
    options: [0, 1, 2, 3].map((i) => document.getElementById(`opt${i}`).value),
    correctAnswer: Number(document.getElementById('fieldCorrectAnswer').value),
    explanation: document.getElementById('fieldExplanation').value,
    active: document.getElementById('fieldActive').checked,
  };

  if (currentMode === 'papers') {
    payload.paper = groupValue;
  } else {
    payload.category = groupValue;
  }

  try {
    const docId = document.getElementById('editDocId').value;
    if (docId) {
      await api(`${apiBase()}/${docId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showAlert('Question updated successfully');
    } else {
      await api(apiBase(), { method: 'POST', body: JSON.stringify(payload) });
      showAlert('Question created successfully');
    }
    closeModal();
    loadQuestions();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function openDelete(docId, preview) {
  deleteTarget = docId;
  document.getElementById('deleteMessage').textContent =
    `Delete "${preview}..."? This cannot be undone.`;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  deleteTarget = null;
  document.getElementById('deleteModal').classList.add('hidden');
}

async function confirmDelete() {
  if (!deleteTarget) return;
  try {
    await api(`${apiBase()}/${deleteTarget}`, { method: 'DELETE' });
    showAlert('Question deleted');
    closeDeleteModal();
    loadQuestions();
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

async function toggleActive(docId) {
  try {
    const result = await api(`${apiBase()}/${docId}/toggle`, { method: 'PATCH' });
    showAlert(result.active ? 'Question is now visible' : 'Question hidden from app');
    loadQuestions();
  } catch (err) {
    showAlert(err.message, 'error');
  }
}

function switchMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;
  document.getElementById('filterCategory').value = '';
  document.getElementById('searchInput').value = '';
  updateModeUi();
  loadQuestions();
}

// Event listeners
document.getElementById('btnNew').addEventListener('click', openNew);
document.getElementById('btnGenerateAi').addEventListener('click', generateWithAi);
document.getElementById('tabPractice').addEventListener('click', () => switchMode('practice'));
document.getElementById('tabPapers').addEventListener('click', () => switchMode('papers'));
document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
document.getElementById('questionForm').addEventListener('submit', saveQuestion);
document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
document.querySelectorAll('[data-close-delete]').forEach((el) => el.addEventListener('click', closeDeleteModal));

document.getElementById('filterCategory').addEventListener('change', loadQuestions);
document.getElementById('filterDifficulty').addEventListener('change', loadQuestions);
document.getElementById('searchInput').addEventListener(
  'input',
  debounce(loadQuestions, 300)
);

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
  await loadQuestions();
})();
