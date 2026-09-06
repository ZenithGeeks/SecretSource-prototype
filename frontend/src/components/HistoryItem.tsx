import type { Paper } from '../types'

export interface HistoryItemProps {
  paper: Paper
}

export function HistoryItem({ paper }: HistoryItemProps) {
  return (
    <div className="recent__item">
      <img className="recent__icon" src="/icons/icon-file-text.svg" alt="File text icon" />
      <div className="recent__text">
        <p className="recent__name">{paper.fileName}</p>
        <p className="recent__meta">{paper.summary}</p>
      </div>
    </div>
  )
}
