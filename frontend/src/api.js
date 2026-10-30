// Point d'entrée unique vers l'API.
//
//  - VITE_API_URL vide (local, Docker Compose, Kubernetes) : on appelle
//    "/api" sur la même adresse que la page ; nginx (ou Vite en dev)
//    relaie vers le backend. Aucune requête cross-origin.
//  - VITE_API_URL renseignée (Render) : on appelle directement l'URL
//    publique de l'API. Valeur lue au BUILD, pas à l'exécution.
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

async function call(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    throw new Error("Impossible de joindre l'API. Le backend est-il démarré ?")
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erreur ${response.status}`)
  return payload
}

export const getProjects = () => call('/projects')
export const getTasks = () => call('/tasks')
export const createTask = (task) => call('/tasks', { method: 'POST', body: JSON.stringify(task) })
export const updateTask = (id, patch) => call(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteTask = (id) => call(`/tasks/${id}`, { method: 'DELETE' })
