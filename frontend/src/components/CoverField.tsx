/** Pick, upload and preview the banner for an event or hackathon. */
import { useRef, useState } from 'react'

import { uploadImage } from '../api'
import { Cover } from './cards'
import { Icon } from './icons'
import { Button } from './ui'

export function CoverField({
  value,
  onChange,
  kind,
  title,
}: {
  value: string
  onChange: (url: string) => void
  /** Event type, or "hackathon": picks the drawn fallback shown while there is no image. */
  kind: string
  title: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const upload = async (file: File) => {
    setUploading(true)
    setError('')
    try {
      onChange(await uploadImage(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that image.')
    } finally {
      setUploading(false)
    }
  }
  return (
    <div role="group" aria-label="Cover image">
      <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wider text-stone-700">Cover image</span>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-center">
        <Cover image={value} kind={kind} title={title || 'Your title here'} />
        <div className="space-y-2">
          <p className="text-sm text-stone-600">
            Shown on cards and at the top of the page. A wide image (16:9, at least 1200 × 675) looks best.
            {value ? '' : ' Until you add one, a cover is drawn from the title.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
              <Icon name="image" className="h-4 w-4" />
              {uploading ? 'Uploading…' : value ? 'Change image' : 'Upload image'}
            </Button>
            {value && <Button variant="ghost" onClick={() => onChange('')}>Remove</Button>}
          </div>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
