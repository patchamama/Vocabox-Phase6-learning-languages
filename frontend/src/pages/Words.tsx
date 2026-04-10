import { FormEvent, useEffect, useState } from 'react'
import { temasApi, wordsApi } from '../api/client'
import type { Tema, Word } from '../types'

const EMPTY_FORM = {
  palabra: '',
  significado: '',
  idioma_origen: 'de',
  idioma_destino: 'es',
  tema_id: '',
}

export default function Words() {
  const [words, setWords] = useState<Word[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = async () => {
    setIsLoading(true)
    const [wRes, tRes] = await Promise.all([wordsApi.list(), temasApi.list()])
    setWords(wRes.data)
    setTemas(tRes.data)
    setIsLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    await wordsApi.create({
      ...form,
      tema_id: form.tema_id ? parseInt(form.tema_id) : undefined,
    })
    setForm(EMPTY_FORM)
    setIsAdding(false)
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar esta palabra?')) return
    await wordsApi.delete(id)
    setWords((prev) => prev.filter((w) => w.id !== id))
  }

  const set = (field: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  return (
    <div className="p-4 pt-8 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Vocabulario</h1>
        <button
          onClick={() => setIsAdding((v) => !v)}
          className="btn-primary py-2 px-4 text-sm"
        >
          {isAdding ? 'Cancelar' : '+ Añadir'}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="card space-y-3 animate-slide-up">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Palabra (origen)"
              value={form.palabra}
              onChange={set('palabra')}
              required
            />
            <input
              className="input"
              placeholder="Significado"
              value={form.significado}
              onChange={set('significado')}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Idioma origen"
              value={form.idioma_origen}
              onChange={set('idioma_origen')}
            />
            <input
              className="input"
              placeholder="Idioma destino"
              value={form.idioma_destino}
              onChange={set('idioma_destino')}
            />
          </div>
          <select className="input" value={form.tema_id} onChange={set('tema_id')}>
            <option value="">Sin tema</option>
            {temas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary w-full">
            Guardar
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="text-center text-slate-400 py-12">Cargando...</div>
      ) : words.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">📭</div>
          <p className="text-slate-400">Sin palabras todavía. ¡Añade la primera!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {words.map((word) => (
            <div key={word.id} className="card flex items-center gap-3 py-3">
              {word.tema && (
                <div
                  className="w-1.5 h-10 rounded-full shrink-0"
                  style={{ backgroundColor: word.tema.color }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{word.palabra}</p>
                <p className="text-slate-400 text-sm truncate">{word.significado}</p>
                {word.tema && (
                  <p className="text-xs text-slate-600 mt-0.5">{word.tema.nombre}</p>
                )}
              </div>
              <button
                onClick={() => handleDelete(word.id)}
                className="text-slate-600 hover:text-red-400 transition-colors px-2 text-lg shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
