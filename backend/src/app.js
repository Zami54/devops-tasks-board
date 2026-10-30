// =============================================================
//  API REST du DevOps Tasks Board
//
//  Surface d'attaque volontairement réduite : 7 routes, et pas une
//  de plus. Chaque route existe parce que le frontend ou Kubernetes
//  s'en sert (voir docs/securite.md, « Recenser la surface »).
//
//    GET    /health       sonde de vie (Kubernetes, Render)
//    GET    /ready        sonde de disponibilité (teste la base)
//    GET    /projects     liste des projets
//    GET    /tasks        liste des tâches
//    POST   /tasks        création d'une tâche
//    PATCH  /tasks/:id    modification (statut, priorité, texte)
//    DELETE /tasks/:id    suppression
// =============================================================

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { query } = require('./db');
const log = require('./logger');
const {
  ValidationError, parseId, validateNewTask, validateTaskPatch,
} = require('./validation');

const PROBES = new Set(['/health', '/ready']);

function corsOptions() {
  // Liste blanche d'origines, lue dans CORS_ORIGIN (séparées par des virgules).
  // Vide = aucune origine extérieure autorisée : c'est le cas en local et sur
  // Kubernetes, où nginx sert le frontend et l'API sur la MÊME adresse.
  const allowed = (process.env.CORS_ORIGIN || '')
    .split(',').map((o) => o.trim()).filter(Boolean);
  return {
    origin: (origin, done) => done(null, Boolean(origin) && allowed.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  };
}

function limiter({ windowMs, limit, name }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => PROBES.has(req.path),
    handler: (req, res) => {
      log.warn('rate_limited', { limiter: name, method: req.method, path: req.path, ip: log.maskIp(req.ip) });
      res.status(429).json({ error: 'Trop de requêtes, réessayez dans une minute.' });
    },
  });
}

function createApp() {
  const app = express();

  // Derrière nginx ou le proxy de Render : on fait confiance à UN saut
  // pour connaître la vraie adresse du client (utile au rate limiting).
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

  // En-têtes de sécurité HTTP, et suppression de « X-Powered-By: Express »
  // qui indiquerait à un attaquant quelle technologie viser.
  app.use(helmet());
  app.use(cors(corsOptions()));

  // Corps JSON limité à 10 Ko : une tâche n'en a jamais besoin de plus.
  app.use(express.json({ limit: '10kb', strict: true }));

  // Limitation de débit : 120 requêtes/minute par adresse, et 30 écritures.
  app.use(limiter({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_ALL ?? 120), name: 'all' }));
  const writeLimiter = limiter({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_WRITE ?? 30), name: 'write' });

  // Journal d'accès (sans les sondes, trop bavardes).
  app.use((req, res, next) => {
    if (PROBES.has(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log[level]('http_request', {
        method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms), ip: log.maskIp(req.ip),
      });
    });
    return next();
  });

  // --- Sondes --------------------------------------------------------------
  // /health ne touche PAS la base : si PostgreSQL tombe, Kubernetes ne doit
  // pas redémarrer l'API en boucle, seulement la retirer du trafic (/ready).
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.get('/ready', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (err) {
      log.error('readiness_failed', { message: err.message });
      // Message générique : le détail technique reste dans les logs.
      res.status(503).json({ status: 'not-ready' });
    }
  });

  // --- Projets -------------------------------------------------------------
  app.get('/projects', async (req, res) => {
    const { rows } = await query(`
      SELECT p.id, p.name, p.color,
             COUNT(t.id)::int                                  AS task_count,
             COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS done_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      GROUP BY p.id
      ORDER BY p.id`);
    res.json(rows);
  });

  // --- Tâches --------------------------------------------------------------
  // Toutes les requêtes sont PARAMÉTRÉES ($1, $2…) : une saisie utilisateur
  // n'est jamais collée dans le SQL, ce qui rend l'injection SQL impossible.
  app.get('/tasks', async (req, res) => {
    const { rows } = await query(`
      SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
             t.created_at, p.name AS project_name, p.color AS project_color
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      ORDER BY t.created_at DESC, t.id DESC`);
    res.json(rows);
  });

  app.post('/tasks', writeLimiter, async (req, res) => {
    const task = validateNewTask(req.body);
    try {
      const { rows } = await query(
        `INSERT INTO tasks (project_id, title, description, status, priority)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, project_id, title, description, status, priority, created_at`,
        [task.projectId, task.title, task.description, task.status, task.priority],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      // 23503 = clé étrangère : le projet visé n'existe pas.
      if (err.code === '23503') throw new ValidationError('Projet introuvable.');
      throw err;
    }
  });

  app.patch('/tasks/:id', writeLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) throw new ValidationError('Identifiant de tâche invalide.');
    const patch = validateTaskPatch(req.body);

    // Les noms de colonnes viennent de la liste blanche ci-dessous, jamais
    // de la requête ; seules les VALEURS sont passées en paramètres.
    const columns = ['title', 'description', 'status', 'priority'].filter((c) => c in patch);
    const sets = columns.map((c, i) => `${c} = $${i + 1}`);
    const params = columns.map((c) => patch[c]);
    params.push(id);

    const { rows } = await query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING id, project_id, title, description, status, priority, created_at`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Tâche introuvable.' });
    return res.json(rows[0]);
  });

  app.delete('/tasks/:id', writeLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) throw new ValidationError('Identifiant de tâche invalide.');
    const { rowCount } = await query('DELETE FROM tasks WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Tâche introuvable.' });
    return res.status(204).end();
  });

  // Toute autre route : 404. Rien d'autre n'est exposé.
  app.use((req, res) => res.status(404).json({ error: 'Route inconnue.' }));

  // Gestion centralisée des erreurs (Express 5 y envoie aussi les erreurs
  // des fonctions async). L'utilisateur ne reçoit qu'un message générique ;
  // le détail technique part dans les logs, jamais dans la réponse.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ValidationError) {
      log.warn('validation_rejected', { method: req.method, path: req.path, reason: err.message, ip: log.maskIp(req.ip) });
      return res.status(400).json({ error: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON invalide.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Requête trop volumineuse.' });
    }
    log.error('unhandled_error', { method: req.method, path: req.path, message: err.message });
    return res.status(500).json({ error: 'Une erreur est survenue.' });
  });

  return app;
}

module.exports = { createApp };
