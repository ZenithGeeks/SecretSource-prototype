export interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">Something went wrong</p>
      <p className="state__hint">{message}</p>
      {onRetry && (
        <button className="state__retry" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
