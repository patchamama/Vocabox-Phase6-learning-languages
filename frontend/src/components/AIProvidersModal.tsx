/**
 * AIProvidersModal — manage external AI provider configurations.
 *
 * Supports: Ollama, OpenAI, Anthropic (Claude), Gemini, Azure OpenAI,
 * and any OpenAI-compatible endpoint (LM Studio, Groq, Mistral, etc.)
 *
 * API keys are stored server-side and NEVER appear in responses.
 */

import { useEffect, useState } from 'react'
import { aiProvidersApi, type AIProviderInfo } from '../api/client'

interface Props {
  onClose: () => void
  onActiveChanged: () => void
}

const PROVIDER_TYPES = [
  { key: 'ollama', label: 'Ollama (local)', needsKey: false, needsUrl: true },
  { key: 'openai', label: 'OpenAI', needsKey: true, needsUrl: false },
  { key: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, needsUrl: false },
  { key: 'gemini', label: 'Google Gemini', needsKey: true, needsUrl: false },
  { key: 'azure', label: 'Azure OpenAI', needsKey: true, needsUrl: true },
  { key: 'openai_compat', label: 'Compatible con OpenAI (LM Studio, Groq…)', needsKey: true, needsUrl: true },
]

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  ollama: ['llama3', 'mistral', 'qwen2.5', 'gemma3'],
  azure: ['gpt-4o', 'gpt-4-turbo'],
  openai_compat: ['llama-3.3-70b-versatile', 'mistral-large-latest'],
}

const TYPE_ICON: Record<string, string> = {
  ollama: '🦙', openai: '🤖', anthropic: '🟠', gemini: '💎',
  azure: '☁', openai_compat: '🔧',
}

const EMPTY_FORM = { name: '', provider_type: 'openai', api_key: '', base_url: '', model_name: '' }

export default function AIProvidersModal({ onClose, onActiveChanged }: Props) {
  const [providers, setProviders] = useState<AIProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<Record<number, boolean | null>>({})
  const [testing, setTesting] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await aiProvidersApi.list()
      setProviders(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const providerMeta = (type: string) =>
    PROVIDER_TYPES.find((p) => p.key === type) ?? PROVIDER_TYPES[0]

  const openAdd = () => {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(true)
  }

  const openEdit = (p: AIProviderInfo) => {
    setEditId(p.id)
    setForm({
      name: p.name,
      provider_type: p.provider_type,
      api_key: '',          // never pre-fill
      base_url: p.base_url ?? '',
      model_name: p.model_name,
    })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.model_name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        provider_type: form.provider_type,
        api_key: form.api_key.trim() || undefined,
        base_url: form.base_url.trim() || undefined,
        model_name: form.model_name.trim(),
      }
      if (editId !== null) {
        await aiProvidersApi.update(editId, payload)
      } else {
        await aiProvidersApi.create(payload)
      }
      setShowForm(false)
      await load()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const remove = async (id: number) => {
    await aiProvidersApi.delete(id)
    setProviders((prev) => prev.filter((p) => p.id !== id))
    onActiveChanged()
  }

  const activate = async (id: number) => {
    await aiProvidersApi.activate(id)
    await load()
    onActiveChanged()
  }

  const deactivate = async (id: number) => {
    await aiProvidersApi.deactivate(id)
    await load()
    onActiveChanged()
  }

  const test = async (id: number) => {
    setTesting(id)
    setTestResult((prev) => ({ ...prev, [id]: null }))
    try {
      const res = await aiProvidersApi.test(id)
      setTestResult((prev) => ({ ...prev, [id]: res.data.ok }))
    } catch {
      setTestResult((prev) => ({ ...prev, [id]: false }))
    } finally { setTesting(null) }
  }

  const meta = providerMeta(form.provider_type)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="bg-slate-800 w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700">
          <h2 className="font-semibold text-white">🤖 Proveedores de IA</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {showForm ? (
            /* ── Add / Edit form ── */
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-300">
                {editId !== null ? 'Editar proveedor' : 'Agregar proveedor'}
              </p>

              {/* Provider type */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Tipo</label>
                <select
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value, model_name: MODEL_SUGGESTIONS[e.target.value]?.[0] ?? '' }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {PROVIDER_TYPES.map((pt) => (
                    <option key={pt.key} value={pt.key}>{pt.label}</option>
                  ))}
                </select>
              </div>

              {/* Name */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nombre (para identificarlo)</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={`p.ej. ${meta.label}`}
                  className="input w-full"
                />
              </div>

              {/* Model */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Modelo</label>
                <input
                  list={`models-${form.provider_type}`}
                  type="text"
                  value={form.model_name}
                  onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                  placeholder="nombre del modelo"
                  className="input w-full"
                />
                <datalist id={`models-${form.provider_type}`}>
                  {(MODEL_SUGGESTIONS[form.provider_type] ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              {/* API Key */}
              {meta.needsKey && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    API Key {editId !== null && <span className="text-slate-500">(vacío = no cambiar)</span>}
                  </label>
                  <input
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    placeholder="sk-..."
                    className="input w-full font-mono"
                  />
                </div>
              )}

              {/* Base URL */}
              {meta.needsUrl && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    {form.provider_type === 'ollama' ? 'URL de Ollama' :
                     form.provider_type === 'azure' ? 'Endpoint de Azure' :
                     'Base URL (opcional)'}
                  </label>
                  <input
                    type="text"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder={
                      form.provider_type === 'ollama' ? 'http://localhost:11434' :
                      form.provider_type === 'azure' ? 'https://mi-recurso.openai.azure.com/openai/deployments/mi-modelo/v1' :
                      'https://api.groq.com/openai/v1'
                    }
                    className="input w-full font-mono text-xs"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)} className="btn-secondary flex-1 text-sm">
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={saving || !form.name.trim() || !form.model_name.trim()}
                  className="btn-primary flex-1 text-sm disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : editId !== null ? 'Actualizar' : 'Agregar'}
                </button>
              </div>
            </div>
          ) : (
            /* ── Provider list ── */
            <>
              {loading && (
                <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
              )}

              {!loading && providers.length === 0 && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-slate-400 text-sm">Sin proveedores configurados.</p>
                  <p className="text-slate-500 text-xs">
                    Si no hay ninguno activo, se usa Ollama configurado en Ajustes → Ollama.
                  </p>
                </div>
              )}

              {providers.map((p) => (
                <div
                  key={p.id}
                  className={`card space-y-2 transition-all ${p.is_active ? 'border-blue-500/50 bg-blue-500/5' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{TYPE_ICON[p.provider_type] ?? '🤖'}</span>
                        <span className="font-medium text-white text-sm truncate">{p.name}</span>
                        {p.is_active && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                            activo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 ml-7 truncate">
                        {p.model_name}
                        {p.base_url && <span className="text-slate-500 ml-2">· {p.base_url}</span>}
                      </p>
                    </div>

                    {/* Test result */}
                    {testResult[p.id] !== undefined && testResult[p.id] !== null && (
                      <span className={`text-xs font-medium shrink-0 ${testResult[p.id] ? 'text-green-400' : 'text-red-400'}`}>
                        {testResult[p.id] ? '✓ OK' : '✗ Error'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {!p.is_active ? (
                      <button
                        onClick={() => activate(p.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 transition-colors"
                      >
                        ▶ Activar
                      </button>
                    ) : (
                      <button
                        onClick={() => deactivate(p.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-600/40 text-slate-300 hover:bg-slate-600/60 border border-slate-500/30 transition-colors"
                      >
                        ⏹ Desactivar
                      </button>
                    )}
                    <button
                      onClick={() => test(p.id)}
                      disabled={testing === p.id}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600 transition-colors disabled:opacity-50"
                    >
                      {testing === p.id ? '⏳' : '🔌'} Probar
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600 transition-colors"
                    >
                      ✏ Editar
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}

              <button
                onClick={openAdd}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-600 text-slate-400 hover:border-blue-500/50 hover:text-blue-300 text-sm transition-colors"
              >
                + Agregar proveedor
              </button>

              <div className="text-xs text-slate-500 pt-1 space-y-1">
                <p>• Las API keys se guardan en el servidor, nunca se envían al navegador.</p>
                <p>• Si ningún proveedor está activo, se usa Ollama (configurado en Ajustes).</p>
                <p>• El proveedor activo se usa para: gramática, mejorar palabras.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
