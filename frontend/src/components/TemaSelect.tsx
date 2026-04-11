import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { temasApi } from '../api/client'
import type { Tema } from '../types'

interface TemaSelectProps {
  temas: Tema[]
  value: string
  onChange: (temaId: string) => void
  onTemaCreated: (tema: Tema) => void
}

export default function TemaSelect({
  temas,
  value,
  onChange,
  onTemaCreated,
}: TemaSelectProps) {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  const [isSaving, setIsSaving] = useState(false)

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__new__') {
      setIsCreating(true)
    } else {
      onChange(e.target.value)
    }
  }

  const handleCreate = async () => {
    if (!newNombre.trim()) return
    setIsSaving(true)
    try {
      const { data } = await temasApi.create(newNombre.trim(), newColor)
      onTemaCreated(data)
      onChange(String(data.id))
      setIsCreating(false)
      setNewNombre('')
      setNewColor('#3B82F6')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setIsCreating(false)
    setNewNombre('')
    setNewColor('#3B82F6')
  }

  if (isCreating) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={t('temaSelect.themeName')}
            value={newNombre}
            onChange={(e) => setNewNombre(e.target.value)}
            autoFocus
          />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-10 w-10 rounded-lg cursor-pointer border border-slate-600 bg-slate-700 p-1 shrink-0"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="btn-secondary flex-1 py-1.5 text-sm"
          >
            {t('temaSelect.cancel')}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newNombre.trim() || isSaving}
            className="btn-primary flex-1 py-1.5 text-sm"
          >
            {isSaving ? t('temaSelect.creating') : t('temaSelect.create')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <select className="input" value={value} onChange={handleSelectChange}>
      <option value="">{t('temaSelect.noTheme')}</option>
      {temas.map((t) => (
        <option key={t.id} value={t.id}>
          {t.nombre}
        </option>
      ))}
      <option value="__new__">{t('temaSelect.createNew')}</option>
    </select>
  )
}
