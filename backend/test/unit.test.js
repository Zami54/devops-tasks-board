// Tests unitaires : ils tournent SANS base de données. Ils couvrent tout
// ce qui doit être refusé AVANT d'atteindre PostgreSQL (validation,
// routes inconnues, en-têtes de sécurité, CORS, taille des requêtes).
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { parseId, validateNewTask, validateTaskPatch } = require('../src/validation');
const { maskIp } = require('../src/logger');

const app = createApp();

test('GET /health répond 200 sans toucher la base', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('les en-têtes de sécurité sont présents et X-Powered-By est masqué', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']);
});

test('une route inconnue répond 404, rien d\'autre n\'est exposé', async () => {
  for (const path of ['/admin', '/projects/1', '/.env', '/tasks/1/edit']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404, path);
  }
});

test('POST /projects n\'existe plus (surface réduite)', async () => {
  const res = await request(app).post('/projects').send({ name: 'x' });
  assert.equal(res.status, 404);
});

test('identifiant non numérique : 400 et non plus 500', async () => {
  for (const id of ['abc', '0', '-1', '1.5', '1e3', '99999999999']) {
    const res = await request(app).delete(`/tasks/${id}`);
    assert.equal(res.status, 400, id);
  }
});

test('POST /tasks refuse un titre manquant, vide ou trop long', async () => {
  assert.equal((await request(app).post('/tasks').send({ project_id: 1 })).status, 400);
  assert.equal((await request(app).post('/tasks').send({ title: '   ', project_id: 1 })).status, 400);
  const long = 'a'.repeat(121);
  assert.equal((await request(app).post('/tasks').send({ title: long, project_id: 1 })).status, 400);
});

test('POST /tasks refuse un champ inconnu (liste blanche)', async () => {
  const res = await request(app).post('/tasks').send({ title: 'x', project_id: 1, is_admin: true });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /non autorisé/);
});

test('POST /tasks refuse un statut ou une priorité hors liste', async () => {
  assert.equal((await request(app).post('/tasks').send({ title: 'x', project_id: 1, status: 'hacked' })).status, 400);
  assert.equal((await request(app).post('/tasks').send({ title: 'x', project_id: 1, priority: 'urgent' })).status, 400);
});

test('un JSON invalide renvoie 400 sans détail technique', async () => {
  const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{"title":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'JSON invalide.');
});

test('un corps de plus de 10 Ko est refusé (413)', async () => {
  const res = await request(app).post('/tasks').send({ title: 'x', description: 'a'.repeat(20_000), project_id: 1 });
  assert.equal(res.status, 413);
});

test('CORS : une origine non autorisée ne reçoit pas d\'autorisation', async () => {
  const res = await request(app).get('/health').set('Origin', 'https://site-pirate.example');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('parseId n\'accepte que des entiers positifs', () => {
  assert.equal(parseId('42'), 42);
  for (const bad of ['', 'abc', '0', '01', '-3', '2.5', '2147483648', null, undefined, {}]) {
    assert.equal(parseId(bad), null, String(bad));
  }
});

test('validateNewTask applique les valeurs par défaut et nettoie le texte', () => {
  const task = validateNewTask({ title: '  Écrire les tests  ', project_id: '2' });
  assert.deepEqual(task, {
    title: 'Écrire les tests', description: '', projectId: 2, status: 'todo', priority: 'medium',
  });
});

test('validateTaskPatch exige au moins un champ', () => {
  assert.throws(() => validateTaskPatch({}), /Aucun champ/);
  assert.deepEqual(validateTaskPatch({ status: 'done' }), { status: 'done' });
});

test('maskIp masque la fin de l\'adresse (RGPD)', () => {
  assert.equal(maskIp('203.0.113.57'), '203.0.113.0');
  assert.equal(maskIp('::ffff:198.51.100.9'), '198.51.100.0');
});
