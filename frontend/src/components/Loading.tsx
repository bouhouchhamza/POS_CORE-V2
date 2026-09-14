type LoadingProps = {
  label?: string
}

export default function Loading({ label = 'Chargement...' }: LoadingProps) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}
