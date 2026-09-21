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

  // Live model listing — fetched from the provider itself once type + key (if needed) are set
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [manualModelEntry, setManualModelEntry] = useState(false)

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
    setModelOptions([])
    setModelsError(null)
    setManualModelEntry(false)
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
    setModelOptions([])
    setModelsError(null)
    setManualModelEntry(false)
    setShowForm(true)
  }

  // Fetch the live model list from the provider once type + credentials look
  // usable. Debounced so it doesn't fire on every keystroke of the API key.
  useEffect(() => {
    if (!showForm) return
    const meta = providerMeta(form.provider_type)
    const hasKey = form.api_key.trim().length > 0
    // Editing without retyping the key still works — the backend falls back
    // to the stored key for this provider_id.
    const canTry = !meta.needsKey || hasKey || editId !== null
    if (!canTry) {
      setModelOptions([])
      setModelsError(null)
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    const handle = setTimeout(() => {
      aiProvidersApi
        .listModels({
          provider_type: form.provider_type,
          api_key: form.api_key.trim() || undefined,
          base_url: form.base_url.trim() || undefined,
          provider_id: editId ?? undefined,
        })
        .then((res) => {
          setModelOptions(res.data.models)
          if (res.data.models.length === 0) setModelsError('El proveedor no devolvió modelos.')
        })
        .catch(() => {
          setModelOptions([])
          setModelsError('No se pudo obtener la lista de modelos — revisá la API key / URL, o escribí el nombre manualmente.')
        })
        .finally(() => setModelsLoading(false))
    }, 500)
    return () => clearTimeout(handle)
  }, [showForm, form.provider_type, form.api_key, form.base_url, editId])

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
                  onChange={(e) => {
                    const provider_type = e.target.value
                    setForm((f) => ({ ...f, provider_type, model_name: '' }))
                    setModelOptions([])
                    setModelsError(null)
                    setManualModelEntry(false)
                  }}
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

              {/* Model — live listbox from the provider, manual fallback */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Modelo</label>
                  {modelOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setManualModelEntry((v) => !v)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {manualModelEntry ? 'Elegir de la lista' : 'Escribir manualmente'}
                    </button>
                  )}
                </div>

                {modelsLoading && (
                  <p className="text-xs text-slate-500 mb-1">Buscando modelos disponibles…</p>
                )}

                {modelOptions.length > 0 && !manualModelEntry ? (
                  <select
                    value={form.model_name}
                    onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Elegí un modelo…</option>
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.model_name}
                    onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                    placeholder="nombre del modelo"
                    className="input w-full"
                  />
                )}

                {modelsError && (
                  <p className="text-xs text-amber-400 mt-1">{modelsError}</p>
                )}
              </div>

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
