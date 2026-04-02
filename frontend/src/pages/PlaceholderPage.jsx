import { Construction } from 'lucide-react'

export default function PlaceholderPage({ title = 'Module' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-mid-grey select-none">
      <Construction size={32} strokeWidth={1} className="opacity-40" />
      <div className="text-center">
        <p className="text-body font-medium text-dark-grey">{title}</p>
        <p className="text-caption mt-0.5">Coming in a future update</p>
      </div>
    </div>
  )
}
