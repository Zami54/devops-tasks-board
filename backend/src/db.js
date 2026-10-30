const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const log = require('./logger');

// Sur Render, la base managée impose une connexion chiffrée (TLS).
// En local et sur Kubernetes, la base n'est joignable que sur un
// réseau privé : TLS est désactivé.
const useSsl = process.env.DATABASE_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Une requête qui dure plus de 5 s est coupée : elle ne peut pas
  // bloquer une connexion du pool indéfiniment (déni de service).
  statement_timeout: 5000,
});

pool.on('error', (err) => {
  // Une connexion inactive coupée par PostgreSQL ne doit pas tuer le process.
  log.error('db_idle_connection_error', { message: err.message });
});

const query = (text, params) => pool.query(text, params);

// Attend que PostgreSQL accepte les connexions (utile au démarrage
// sous Kubernetes, où rien ne garantit l'ordre de démarrage des pods).
async function waitForDb({ retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      log.info('db_connected', { attempt });
      return;
    } catch (err) {
      log.warn('db_unavailable', { attempt, retries, message: err.message });
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Sur Render uniquement (INIT_DB_ON_START=true) : rejoue le script
// d'initialisation, idempotent, au démarrage. Une base recréée après
// l'expiration du plan gratuit retrouve ainsi son schéma et ses données
// de démonstration sans qu'on ait besoin de l'ouvrir sur Internet.
async function initSchemaIfRequested() {
  if (process.env.INIT_DB_ON_START !== 'true') return;
  const sqlPath = process.env.INIT_SQL_PATH
    || path.resolve(__dirname, '../../infra/db/init_db.sql');
  if (!fs.existsSync(sqlPath)) {
    log.warn('db_init_skipped', { reason: 'script introuvable' });
    return;
  }
  await pool.query(fs.readFileSync(sqlPath, 'utf8'));
  log.info('db_init_done');
}

module.exports = { pool, query, waitForDb, initSchemaIfRequested };
