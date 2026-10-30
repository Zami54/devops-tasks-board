// Logique pure du tableau (filtrage, tri, statistiques), séparée de
// l'affichage pour pouvoir être testée sans navigateur.

export const COLUMNS = [
  { status: 'todo', label: 'À faire' },
  { status: 'doing', label: 'En cours' },
  { status: 'done', label: 'Terminé' },
]

export const PRIORITIES = [
  { value: 'high', label: 'Haute' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'low', label: 'Basse' },
]

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
const STATUS_ORDER = COLUMNS.map((c) => c.status)

export const priorityLabel = (value) => PRIORITIES.find((p) => p.value === value)?.label ?? value

// Statut voisin quand on déplace une tâche vers la gauche (-1) ou la droite (+1).
export function nextStatus(status, direction) {
  const index = STATUS_ORDER.indexOf(status) + direction
  return STATUS_ORDER[index] ?? null
}

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterTasks(tasks, { search = '', projectId = 'all', priority = 'all' } = {}) {
  const needle = normalize(search.trim())
  return tasks.filter((task) => {
    if (projectId !== 'all' && String(task.project_id) !== String(projectId)) return false
    if (priority !== 'all' && task.priority !== priority) return false
    if (!needle) return true
    return normalize(`${task.title} ${task.description ?? ''}`).includes(needle)
  })
}

export function sortTasks(tasks, sort = 'recent') {
  const copy = [...tasks]
  if (sort === 'priority') {
    return copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.id - a.id)
  }
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
  return copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)
}

export function computeStats(tasks) {
  const total = tasks.length
  const doing = tasks.filter((t) => t.status === 'doing').length
  const done = tasks.filter((t) => t.status === 'done').length
  return { total, doing, done, progress: total ? Math.round((done / total) * 100) : 0 }
}
