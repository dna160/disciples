'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Settings } from '@/types'

interface SeoStrategistModalProps {
  settings: Settings
  onSave: (updates: Partial<Settings>) => void
  onClose: () => void
}

const DEDUPE_OPTIONS = [
  { value: 0,   label: 'Off' },
  { value: 2,   label: '2h' },
  { value: 4,   label: '4h' },
  { value: 8,   label: '8h' },
  { value: 24,  label: '24h' },
  { value: 48,  label: '48h' },
  { value: 72,  label: '72h' },
  { value: 168, label: '7 days' },
]

const inputStyle: React.CSSProperties = {
  background: '#0D0D10',
  border: '1px solid #2A2A32',
  borderRadius: '6px',
  color: '#E5E7EB',
  padding: '10px 12px',
  fontSize: '0.8125rem',
  fontFamily: "'JetBrains Mono', monospace",
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s ease',
  appearance: 'none',
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{
        color: '#9CA3AF',
        fontSize: '0.625rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ color: '#4B5563', fontSize: '0.6rem', marginTop: '2px' }}>{hint}</span>}
    </div>
  )
}

export default function SeoStrategistModal({ settings, onSave, onClose }: SeoStrategistModalProps) {
  const [dedupeHours, setDedupeHours] = useState(settings.seoDedupeHours ?? 24)
  const [shortTail, setShortTail] = useState(settings.seoShortTail ?? 2)
  const [evergreen, setEvergreen] = useState(settings.seoEvergreen ?? 1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onSave({
        seoDedupeHours: dedupeHours,
        seoShortTail: shortTail,
        seoEvergreen: evergreen,
      })
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1000)
    } finally {
      setSaving(false)
    }
  }, [dedupeHours, shortTail, evergreen, onSave, onClose])

  const handleReset = useCallback(() => {
    setDedupeHours(24)
    setShortTail(2)
    setEvergreen(1)
  }, [])

  const totalDirectives = shortTail + evergreen

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111114',
          border: '1px solid rgba(16,185,129,0.35)',
          borderRadius: '12px',
          width: '500px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 60px rgba(16,185,129,0.1), 0 25px 50px rgba(0,0,0,0.8)',
          animation: 'slideUp 0.2s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 18px',
          borderBottom: '1px solid #1E1E26',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(16,185,129,0.07)',
        }}>
          <span style={{ fontSize: '1.5rem' }}>📈</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#F3F4F6', fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '0.03em' }}>
                SEO Strategist
              </span>
              <span style={{
                background: 'rgba(16,185,129,0.15)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#10B981',
                fontSize: '0.5rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                borderRadius: '4px',
                padding: '2px 6px',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                STAGE 0
              </span>
            </div>
            <p style={{ color: '#6B6B80', fontSize: '0.6875rem', marginTop: '2px' }}>
              Configure keyword strategy &amp; topic deduplication
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #2A2A32',
              borderRadius: '6px',
              color: '#6B6B80',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.875rem',
              transition: 'all 0.15s ease',
            }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>

          {/* Info banner */}
          <div style={{
            background: 'rgba(16,185,129,0.05)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '0.875rem', marginTop: '1px' }}>💡</span>
            <p style={{ color: '#6B7280', fontSize: '0.6875rem', lineHeight: 1.6, margin: 0 }}>
              The SEO Strategist runs before the Investigator each cycle to select high-value keyword targets.
              Deduplication prevents it from re-recommending topics it already covered recently.
            </p>
          </div>

          {/* Dedupe Window */}
          <Field
            label="Topic Deduplication Window"
            hint="The strategist will avoid recommending keywords it used within this time window. Set to Off to disable."
          >
            <div style={{ position: 'relative' }}>
              <select
                value={dedupeHours}
                onChange={(e) => setDedupeHours(Number(e.target.value))}
                onFocus={() => setFocusedField('dedupe')}
                onBlur={() => setFocusedField(null)}
                style={{
                  ...inputStyle,
                  borderColor: focusedField === 'dedupe' ? '#10B981' : '#2A2A32',
                  boxShadow: focusedField === 'dedupe' ? '0 0 0 2px rgba(16,185,129,0.15)' : 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B6B80' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  paddingRight: '32px',
                  cursor: 'pointer',
                }}
              >
                {DEDUPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </Field>

          {/* Short-tail count */}
          <Field
            label="Short-Tail Topics Per Cycle"
            hint="Trending topics requiring immediate news coverage. Captures spike traffic."
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setShortTail(n)}
                  style={{
                    background: shortTail === n ? 'rgba(245,158,11,0.15)' : 'transparent',
                    border: `1px solid ${shortTail === n ? 'rgba(245,158,11,0.4)' : '#2A2A32'}`,
                    borderRadius: '6px',
                    color: shortTail === n ? '#F59E0B' : '#6B6B80',
                    width: '44px',
                    height: '38px',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>

          {/* Evergreen count */}
          <Field
            label="Evergreen Topics Per Cycle"
            hint="Long-term foundational content for steady month-over-month traffic. Can be set to 0."
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setEvergreen(n)}
                  style={{
                    background: evergreen === n ? 'rgba(16,185,129,0.15)' : 'transparent',
                    border: `1px solid ${evergreen === n ? 'rgba(16,185,129,0.4)' : '#2A2A32'}`,
                    borderRadius: '6px',
                    color: evergreen === n ? '#10B981' : '#6B6B80',
                    width: '44px',
                    height: '38px',
                    fontSize: '0.875rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    transition: 'all 0.15s ease',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>

          {/* Pipeline preview */}
          <div style={{
            background: '#0D0D10',
            border: '1px solid #1E1E26',
            borderRadius: '8px',
            padding: '14px',
          }}>
            <p style={{
              color: '#4B5563',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: '10px',
            }}>
              ⚙ Strategy Preview
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                {
                  label: 'Total Directives',
                  value: `${totalDirectives} per cycle (${shortTail} short-tail + ${evergreen} evergreen)`,
                  active: true,
                },
                {
                  label: 'Deduplication',
                  value: dedupeHours === 0
                    ? 'Disabled — topics may repeat'
                    : `Avoids topics from the last ${DEDUPE_OPTIONS.find(o => o.value === dedupeHours)?.label}`,
                  active: dedupeHours > 0,
                },
                {
                  label: 'Search Queries',
                  value: `~${totalDirectives * 3} Serper queries per cycle`,
                  active: true,
                },
              ].map(({ label, value, active }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: active ? '#10B981' : '#374151',
                    flexShrink: 0,
                    marginTop: '5px',
                  }} />
                  <span style={{
                    color: '#6B6B80',
                    fontSize: '0.5625rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                    width: '110px',
                    flexShrink: 0,
                  }}>
                    {label}
                  </span>
                  <span style={{ color: active ? '#9CA3AF' : '#374151', fontSize: '0.6875rem' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #1E1E26',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <button
            onClick={handleReset}
            style={{
              background: 'none',
              border: '1px solid #2A2A32',
              borderRadius: '6px',
              color: '#6B6B80',
              padding: '8px 14px',
              fontSize: '0.6875rem',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.06em',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
          >
            ↺ Reset Defaults
          </button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: '1px solid #2A2A32',
                borderRadius: '6px',
                color: '#9CA3AF',
                padding: '8px 16px',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: saved ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
                border: `1px solid ${saved ? 'rgba(16,185,129,0.6)' : 'rgba(16,185,129,0.35)'}`,
                borderRadius: '6px',
                color: saved ? '#10B981' : '#34D399',
                padding: '8px 20px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: "'JetBrains Mono', monospace",
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 0 16px rgba(16,185,129,0.1)',
              }}
            >
              {saved ? '✓ SAVED' : saving ? '⟳ SAVING...' : '⬆ SAVE CONFIG'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }
      `}</style>
    </div>
  )
}
