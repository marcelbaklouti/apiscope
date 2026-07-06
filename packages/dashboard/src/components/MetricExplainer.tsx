import { useId, type ReactNode } from 'react'

export interface MetricExplainerProps {
  label: string
  explanation: string
  children: ReactNode
}

export function MetricExplainer(props: MetricExplainerProps): ReactNode {
  const { label, explanation, children } = props
  const tipId = useId()
  return (
    <span className="metric-explained">
      {children}
      <button
        type="button"
        className="metric-explainer"
        data-testid="metric-explainer"
        aria-label={`what ${label} means`}
        aria-describedby={tipId}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1" />
          <path d="M6 5.1v2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="3.5" r="0.72" fill="currentColor" />
        </svg>
        <span className="metric-explainer-tip" id={tipId} role="tooltip">
          {explanation}
        </span>
      </button>
    </span>
  )
}
