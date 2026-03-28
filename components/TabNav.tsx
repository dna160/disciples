'use client'

export type ActiveTab = 'operation-map' | 'war-room'

interface TabNavProps {
  activeTab: ActiveTab
  onChange: (tab: ActiveTab) => void
}

const TABS: { id: ActiveTab; label: string; icon: string }[] = [
  { id: 'operation-map', label: 'OPERATION MAP', icon: '🗺️' },
  { id: 'war-room', label: 'WAR ROOM', icon: '⚔️' },
]

export default function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <nav
      style={{
        background: '#0D0D10',
        borderBottom: '1px solid #2A2A32',
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 20px',
        gap: '0',
        flexShrink: 0,
        height: '42px',
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: isActive
                ? '2px solid #F59E0B'
                : '2px solid transparent',
              color: isActive ? '#F59E0B' : '#6B6B80',
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              padding: '0 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              fontFamily: 'inherit',
              marginBottom: '-1px',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                ;(e.currentTarget as HTMLButtonElement).style.color = '#D1D5DB'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                ;(e.currentTarget as HTMLButtonElement).style.color = '#6B6B80'
              }
            }}
            aria-selected={isActive}
            role="tab"
          >
            <span style={{ fontSize: '0.875rem' }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '0',
                  left: '0',
                  right: '0',
                  height: '2px',
                  background: 'linear-gradient(90deg, transparent, rgba(245, 158, 11, 0.3), transparent)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </button>
        )
      })}

      {/* Right-side info */}
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingRight: '4px',
        }}
      >
        <span
          style={{
            color: '#374151',
            fontSize: '0.5625rem',
            letterSpacing: '0.1em',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          DISCIPLES — AI PIPELINE DASHBOARD
        </span>
      </div>
    </nav>
  )
}
