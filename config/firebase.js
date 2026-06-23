const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let db = null;

function getServiceAccount() {
  // Vercel / cloud: paste full JSON as env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  // Local: read from file
  const credPath = path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(__dirname, '..', 'serviceAccountKey.json')
  );

  if (!fs.existsSync(credPath)) {
    throw new Error(
      'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT env var or add serviceAccountKey.json'
    );
  }

  return require(credPath);
}

function initFirebase() {
  if (admin.apps.length) {
    db = admin.firestore();
    return db;
  }

  admin.initializeApp({
    credential: admin.credential.cert(getServiceAccount()),
  });

  db = admin.firestore();
  return db;
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

function getCollectionName() {
  return process.env.FIRESTORE_COLLECTION || 'questions';
}

function getQuestionPaperCollectionName() {
  return process.env.FIRESTORE_QUESTION_PAPERS_COLLECTION || 'question_papers';
}

function getExamsCollectionName() {
  return process.env.FIRESTORE_EXAMS_COLLECTION || 'exams';
}

module.exports = {
  initFirebase,
  getDb,
  getCollectionName,
  getQuestionPaperCollectionName,
  getExamsCollectionName,
  admin,
};
