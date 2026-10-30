// =============================================================
//  Validation des entrées — approche « liste blanche »
//
//  On n'accepte QUE ce qui est explicitement prévu : un champ
//  inconnu, un type inattendu ou une valeur hors liste est refusé.
//  Une liste noire (« on bloque ce qui est dangereux ») est
//  toujours incomplète ; une liste blanche ne l'est pas.
// =============================================================

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

const LIMITS = { title: 120, description: 500 };

// Un identifiant est un entier positif tenant dans un INTEGER PostgreSQL.
// Sans ce contrôle, « /tasks/abc » donnait NaN et une erreur 500.
function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^[1-9]\d{0,9}$/.test(text)) return null;
  const id = Number(text);
  return id <= 2147483647 ? id : null;
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkText(name, value, { required }) {
  if (value === undefined) {
    if (required) throw new ValidationError(`Le champ "${name}" est obligatoire.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`Le champ "${name}" doit être un texte.`);
  const text = value.trim();
  if (required && text.length === 0) throw new ValidationError(`Le champ "${name}" est obligatoire.`);
  if (text.length > LIMITS[name]) {
    throw new ValidationError(`Le champ "${name}" dépasse ${LIMITS[name]} caractères.`);
  }
  return text;
}

function checkEnum(name, value, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new ValidationError(`Le champ "${name}" doit valoir : ${allowed.join(', ')}.`);
  }
  return value;
}

function rejectUnknownFields(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`Champ non autorisé : ${unknown.join(', ')}.`);
}

// Corps attendu pour POST /tasks
function validateNewTask(body) {
  if (!isPlainObject(body)) throw new ValidationError('Le corps de la requête doit être un objet JSON.');
  rejectUnknownFields(body, ['title', 'description', 'project_id', 'status', 'priority']);

  const projectId = parseId(body.project_id);
  if (projectId === null) throw new ValidationError('Le champ "project_id" doit être un identifiant valide.');

  return {
    title: checkText('title', body.title, { required: true }),
    description: checkText('description', body.description, { required: false }) ?? '',
    projectId,
    status: checkEnum('status', body.status, STATUSES) ?? 'todo',
    priority: checkEnum('priority', body.priority, PRIORITIES) ?? 'medium',
  };
}

// Corps attendu pour PATCH /tasks/:id (au moins un champ)
function validateTaskPatch(body) {
  if (!isPlainObject(body)) throw new ValidationError('Le corps de la requête doit être un objet JSON.');
  rejectUnknownFields(body, ['title', 'description', 'status', 'priority']);

  const patch = {
    title: checkText('title', body.title, { required: false }),
    description: checkText('description', body.description, { required: false }),
    status: checkEnum('status', body.status, STATUSES),
    priority: checkEnum('priority', body.priority, PRIORITIES),
  };
  if (patch.title === '') throw new ValidationError('Le champ "title" ne peut pas être vide.');

  const fields = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (fields.length === 0) throw new ValidationError('Aucun champ modifiable fourni.');
  return Object.fromEntries(fields);
}

module.exports = {
  STATUSES,
  PRIORITIES,
  LIMITS,
  ValidationError,
  parseId,
  validateNewTask,
  validateTaskPatch,
};
