import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Finding } from '../lib/types'

export interface FindingCardProps {
  finding: Finding
  expanded: boolean
  onToggle(): void
  onDismiss(): void
}

const CATEGORY_LABEL: Record<Finding['category'], string> = {
  performance: 'performance',
  payload: 'payload',
  caching: 'caching',
  database: 'database',
  dependencies: 'dependencies',
  reliability: 'reliability',
  code: 'code'
}

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  critical: 'critical',
  warning: 'warning',
  advisory: 'advisory'
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      resolve()
    } catch (error) {
      reject(error instanceof Error ? error : new Error('copy failed'))
    }
  })
}

function evidenceHref(deepLink: string): string {
  return deepLink.startsWith('/') ? `#${deepLink}` : deepLink
}

export function FindingCard(props: FindingCardProps): ReactNode {
  const { finding, expanded, onToggle, onDismiss } = props
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    }
  }, [])

  const handleCopy = () => {
    if (finding.fix.codeSnippet === undefined) return
    void copyToClipboard(finding.fix.codeSnippet).then(() => {
      setCopied(true)
      if (copyTimer.current !== null) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1200)
    })
  }

  const routeLabel =
    finding.scope.level === 'route' && finding.scope.routePattern !== undefined
      ? finding.scope.routePattern
      : null

  return (
    <article className="finding" data-severity={finding.severity} data-expanded={expanded}>
      <div className="finding-head">
        <span className="finding-rail" aria-hidden="true" />
        <button
          type="button"
          className="finding-toggle-btn"
          data-testid="finding-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="finding-head-main">
            <span className="finding-chips">
              <span
                className="finding-chip finding-chip-severity"
                data-testid="finding-severity"
                data-severity={finding.severity}
              >
                {SEVERITY_LABEL[finding.severity]}
              </span>
              <span className="finding-chip finding-chip-category">{CATEGORY_LABEL[finding.category]}</span>
              {routeLabel !== null && <span className="finding-route mono">{routeLabel}</span>}
            </span>
            <span className="finding-title" data-testid="finding-title">
              {finding.title}
            </span>
            <span className="finding-why">{finding.whatAndWhy}</span>
            <span className="finding-impact mono" data-testid="finding-impact">
              {finding.impact.humanized}
            </span>
          </span>
          <span className="finding-caret" aria-hidden="true" data-expanded={expanded}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 5.25 7 8.75l3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className="finding-dismiss"
          data-testid="finding-dismiss"
          aria-label="dismiss finding"
          onClick={onDismiss}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M3.2 3.2l6.6 6.6M9.8 3.2l-6.6 6.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="finding-body">
          <p className="finding-fix-explain">{finding.fix.explanation}</p>

          {finding.fix.codeSnippet !== undefined && (
            <div className="finding-snippet-wrap">
              <pre className="finding-snippet mono" data-testid="finding-snippet">
                <code>{finding.fix.codeSnippet}</code>
              </pre>
              <button
                type="button"
                className="finding-copy"
                data-testid="finding-copy"
                data-copied={copied}
                onClick={handleCopy}
              >
                {copied ? (
                  <span data-testid="finding-copied" className="finding-copied">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6.8 5 9.3l5.5-5.6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    copied
                  </span>
                ) : (
                  <span className="finding-copy-idle">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                      <rect x="3.2" y="3.2" width="6.4" height="6.4" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M2 8.2V2.4A1.4 1.4 0 0 1 3.4 1h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    copy fix
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="finding-actions">
            <a
              className="finding-evidence"
              data-testid="finding-evidence"
              href={evidenceHref(finding.evidence.deepLink)}
            >
              show me the evidence
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M3 9 9 3M9 3H4.5M9 3v4.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            {finding.fix.docsUrl !== undefined && (
              <a className="finding-docs" href={finding.fix.docsUrl} target="_blank" rel="noreferrer">
                docs
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
