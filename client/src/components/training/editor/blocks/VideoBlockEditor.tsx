import type { Block } from '../SlideEditor'

interface Props {
  block: Block
  onChange: (b: Block) => void
}

export default function VideoBlockEditor({ block, onChange }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--t-text-secondary)' }}>影片 Block</h3>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>來源類型</label>
        <div className="flex gap-2">
          {['upload', 'url'].map(m => (
            <button key={m} onClick={() => onChange({ ...block, source_type: m })}
              className="px-3 py-1.5 rounded text-xs transition border"
              style={{
                borderColor: block.source_type === m ? 'var(--t-accent)' : 'var(--t-border)',
                backgroundColor: block.source_type === m ? 'var(--t-accent-subtle)' : 'transparent',
                color: block.source_type === m ? 'var(--t-accent)' : 'var(--t-text-muted)'
              }}>
              {m === 'upload' ? '上傳影片' : '影片網址'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--t-text-dim)' }}>
          {block.source_type === 'url' ? '影片網址' : '影片檔案路徑'}
        </label>
        <input
          value={block.src || ''}
          onChange={e => onChange({ ...block, src: e.target.value })}
          className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
          style={{ backgroundColor: 'var(--t-bg-input)', borderColor: 'var(--t-border)', color: 'var(--t-text)' }}
          placeholder={block.source_type === 'url' ? 'https://video-server.example.com/video.mp4' : '/uploads/training/...'}
        />
      </div>

      {block.src && (
        <div className="bg-black rounded-lg overflow-hidden">
          <video src={block.src} controls className="w-full max-h-64" />
        </div>
      )}
    </div>
  )
}
