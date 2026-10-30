// Tests d'intégration : ils parlent à une VRAIE base PostgreSQL.
// En CI, GitHub Actions démarre un conteneur PostgreSQL et joue
// init_db.sql + app_user.sh avant de lancer ce fichier.
//
//   DATABASE_URL       compte applicatif (app_user, droits limités)
//   ADMIN_DATABASE_URL facultatif, compte propriétaire (non utilisé par l'API)
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { pool } = require('../src/db');

const app = createApp();
let createdId;

test.after(() => pool.end());

test('GET /ready confirme que la base répond', async () => {
  const res = await request(app).get('/ready');
  assert.equal(res.status, 200);
});

test('GET /projects renvoie les projets de démonstration', async () => {
  const res = await request(app).get('/projects');
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 3);
  assert.ok('task_count' in res.body[0]);
});

test('POST /tasks crée une tâche persistée en base', async () => {
  const res = await request(app).post('/tasks').send({ title: 'Tâche de test', project_id: 1, priority: 'high' });
  assert.equal(res.status, 201);
  createdId = res.body.id;
  const { rows } = await pool.query('SELECT title, status FROM tasks WHERE id = $1', [createdId]);
  assert.deepEqual(rows[0], { title: 'Tâche de test', status: 'todo' });
});

test('une tentative d\'injection SQL est stockée comme du simple texte', async () => {
  const payload = "x'); DROP TABLE tasks; --";
  const res = await request(app).post('/tasks').send({ title: payload, project_id: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, payload);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM tasks');
  assert.ok(rows[0].n > 0, 'la table existe toujours');
  await request(app).delete(`/tasks/${res.body.id}`);
});

test('POST /tasks sur un projet inexistant renvoie 400', async () => {
  const res = await request(app).post('/tasks').send({ title: 'x', project_id: 9999 });
  assert.equal(res.status, 400);
});

test('PATCH /tasks/:id déplace la tâche', async () => {
  const res = await request(app).patch(`/tasks/${createdId}`).send({ status: 'doing' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'doing');
});

test('PATCH sur une tâche inexistante renvoie 404', async () => {
  const res = await request(app).patch('/tasks/999999').send({ status: 'done' });
  assert.equal(res.status, 404);
});

test('DELETE /tasks/:id supprime la tâche', async () => {
  assert.equal((await request(app).delete(`/tasks/${createdId}`)).status, 204);
  assert.equal((await request(app).delete(`/tasks/${createdId}`)).status, 404);
});

test('moindre privilège : le compte de l\'API ne peut pas supprimer une table', async () => {
  await assert.rejects(pool.query('DROP TABLE tasks'), /must be owner|permission denied/);
});

test('moindre privilège : le compte de l\'API ne peut pas créer de projet', async () => {
  await assert.rejects(pool.query("INSERT INTO projects (name) VALUES ('pirate')"), /permission denied/);
});
