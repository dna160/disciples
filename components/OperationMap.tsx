'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import PipelineNode from './PipelineNode'
import TerminalLog from './TerminalLog'
import MasterControls from './MasterControls'
import CopywriterConfigModal from './CopywriterConfigModal'
import SeoStrategistModal from './SeoStrategistModal'
import type { NodeId, NodeState, Settings, LogEntry } from '@/types'

interface OperationMapProps {
  settings: Settings
  onSettingsUpdate: (s: Partial<Settings>) => void
  onTrigger: () => void
  isRunning: boolean
  onRunningChange: (running: boolean) => void
}

type NodeStates = Record<NodeId, NodeState>

const INITIAL_NODE_STATES: NodeStates = {
  'seo-strategist': 'idle',
  investigator: 'idle',
  router: 'idle',
  'copywriter-a': 'idle',
  'copywriter-b': 'idle',
  editor: 'idle',
  'publisher-a': 'idle',
  'publisher-b': 'idle',
}

const NODE_DEFS: { id: NodeId; label: string; icon: string; subtitle?: string }[] = [
  { id: 'seo-strategist', label: 'SEO Strategist', icon: '📈', subtitle: 'Trend & Keyword Intel' },
  { id: 'investigator', label: 'Investigator', icon: '🔍', subtitle: 'Scraper & Researcher' },
  { id: 'router', label: 'Router', icon: '🔀', subtitle: 'Brand Dispatcher' },
  { id: 'copywriter-a', label: 'Copywriter A', icon: '✍️', subtitle: 'Gen-Z Tech' },
  { id: 'copywriter-b', label: 'Copywriter B', icon: '📝', subtitle: 'Formal Biz' },
  { id: 'editor', label: 'Editor', icon: '🎯', subtitle: 'QA & Review' },
  { id: 'publisher-a', label: 'Publisher A', icon: '🚀', subtitle: 'Gen-Z Site' },
  { id: 'publisher-b', label: 'Publisher B', icon: '📰', subtitle: 'Formal Site' },
]

// ── Parse SSE log messages to infer node state changes ──────────────────────
function inferNodeStatesFromLog(message: string, level: LogEntry['level']): Partial<NodeStates> {
  const msg = message.toLowerCase()
  const updates: Partial<NodeStates> = {}

  const isError = level === 'error'
  const isDone = level === 'success' || msg.includes('complete') || msg.includes('finished') || msg.includes('done')
  const isStart = msg.includes('start') || msg.includes('begin') || msg.includes('processing') || msg.includes('working')

  if (msg.includes('seo strateg') || msg.includes('investigator_directive') || msg.includes('seo-strategist')) {
    updates['seo-strategist'] = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('investigat')) {
    updates.investigator = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('rout') || msg.includes('dispatch')) {
    updates.router = isError ? 'error' : isDone ? 'success' : isStart ? 'working' : undefined
  }
  if (msg.includes('copywriter-a') || msg.includes('copywriter a') || msg.includes('gen-z') || msg.includes('genz')) {
    updates['copywriter-a'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('copywriter-b') || msg.includes('copywriter b') || msg.includes('formal-biz') || msg.includes('formalbiz')) {
    updates['copywriter-b'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('edit') || msg.includes('review') || msg.includes('qa')) {
    updates.editor = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-a') || msg.includes(' a') || msg.includes('gen-z'))) {
    updates['publisher-a'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  if (msg.includes('publish') && (msg.includes('-b') || msg.includes(' b') || msg.includes('formal'))) {
    updates['publisher-b'] = isError ? 'error' : isDone ? 'success' : 'working'
  }
  // Generic "publisher" fallback
  if (msg.includes('publish') && !updates['publisher-a'] && !updates['publisher-b']) {
    const state: NodeState = isError ? 'error' : isDone ? 'success' : 'working'
    updates['publisher-a'] = state
    updates['publisher-b'] = state
  }

  // Cycle complete — reset all to idle after short delay
  if (msg.includes('cycle complete') || msg.includes('pipeline complete') || msg.includes('all done')) {
    return {
      'seo-strategist': 'success',
      investigator: 'success',
      router: 'success',
      'copywriter-a': 'success',
      'copywriter-b': 'success',
      editor: 'success',
      'publisher-a': 'success',
      'publisher-b': 'success',
    }
  }

  // Remove undefined values
  return Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined)) as Partial<NodeStates>
}

// ── SVG arrow component ──────────────────────────────────────────────────────
interface ArrowProps {
  x1: number; y1: number; x2: number; y2: number
  active?: boolean
  id: string
}

function PipelineArrow({ x1, y1, x2, y2, active = false, id }: ArrowProps) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)

  return (
    <g>
      <defs>
        <marker
          id={`arrowhead-${id}`}
          markerWidth="8"
          markerHeight="8"
          refX="4"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 8 3, 0 6"
            fill={active ? 'rgba(245,158,11,0.8)' : 'rgba(245,158,11,0.3)'}
          />
        </marker>
      </defs>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={active ? 'rgba(245,158,11,0.7)' : 'rgba(245,158,11,0.25)'}
        strokeWidth={active ? 1.5 : 1}
        strokeDasharray={active ? 'none' : '4 4'}
        markerEnd={`url(#arrowhead-${id})`}
        style={{
          animation: active ? 'arrow-glow 1s ease-in-out infinite' : 'arrow-glow 3s ease-in-out infinite',
        }}
      />
      {/* Animated travel dot */}
      {active && (
        <circle r="3" fill="#F59E0B" style={{ filter: 'drop-shadow(0 0 4px rgba(245,158,11,0.9))' }}>
          <animateMotion
            dur="1.5s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
      {!active && (
        <circle r="2.5" fill="rgba(245,158,11,0.5)">
          <animateMotion
            dur="3s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
    </g>
  )
}

export default function OperationMap({
  settings,
  onSettingsUpdate,
  onTrigger,
  isRunning,
  onRunningChange,
}: OperationMapProps) {
  const [nodeStates, setNodeStates] = useState<NodeStates>(INITIAL_NODE_STATES)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [configModal, setConfigModal] = useState<'gen-z-tech' | 'formal-biz' | null>(null)
  const [seoModalOpen, setSeoModalOpen] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null)

  const handleNewLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries((prev) => [...prev.slice(-499), entry])

    // Infer node state changes
    const stateUpdates = inferNodeStatesFromLog(entry.message, entry.level)
    if (Object.keys(stateUpdates).length > 0) {
      setNodeStates((prev) => ({ ...prev, ...stateUpdates }))
      onRunningChange(true)

      // Schedule reset to idle after inactivity
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = setTimeout(() => {
        setNodeStates(INITIAL_NODE_STATES)
      }, 8000)
    }
  }, [onRunningChange])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  const handleSaveConfig = useCallback(
    async (updates: Partial<Settings>) => {
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
        onSettingsUpdate(updates)
      } catch (err) {
        console.error('[OperationMap] Failed to save copywriter config:', err)
      }
    },
    [onSettingsUpdate]
  )

  const getNode = (id: NodeId) => NODE_DEFS.find((n) => n.id === id)!

  const isEdgeActive = (fromId: NodeId, toId: NodeId): boolean => {
    return nodeStates[fromId] === 'working' || nodeStates[toId] === 'working'
  }

  // ── Fixed-pixel layout (SVG px === CSS px, no scaling mismatch) ─────────
  const DIAGRAM_W = 1120
  const DIAGRAM_H = 290
  const NW = 60 // node half-width in px
  const NH = 52 // node half-height in px

  // Node centers in exact CSS/SVG pixels
  const NC = {
    'seo-strategist': { x: 80,  y: 145 },
    investigator:     { x: 255, y: 145 },
    router:           { x: 430, y: 145 },
    'copywriter-a':   { x: 615, y: 78  },
    'copywriter-b':   { x: 615, y: 212 },
    editor:           { x: 810, y: 145 },
    'publisher-a':    { x: 1000, y: 78  },
    'publisher-b':    { x: 1000, y: 212 },
  }

  const arrows: (ArrowProps & { id: string })[] = [
    {
      id: 'seo-inv',
      x1: NC['seo-strategist'].x + NW, y1: NC['seo-strategist'].y,
      x2: NC.investigator.x - NW,      y2: NC.investigator.y,
    },
    {
      id: 'inv-rtr',
      x1: NC.investigator.x + NW,   y1: NC.investigator.y,
      x2: NC.router.x - NW,         y2: NC.router.y,
    },
    {
      id: 'rtr-cwa',
      x1: NC.router.x + NW - 6,     y1: NC.router.y - 12,
      x2: NC['copywriter-a'].x - NW, y2: NC['copywriter-a'].y,
    },
    {
      id: 'rtr-cwb',
      x1: NC.router.x + NW - 6,     y1: NC.router.y + 12,
      x2: NC['copywriter-b'].x - NW, y2: NC['copywriter-b'].y,
    },
    {
      id: 'cwa-edt',
      x1: NC['copywriter-a'].x + NW, y1: NC['copywriter-a'].y,
      x2: NC.editor.x - NW,          y2: NC.editor.y - 12,
    },
    {
      id: 'cwb-edt',
      x1: NC['copywriter-b'].x + NW, y1: NC['copywriter-b'].y,
      x2: NC.editor.x - NW,          y2: NC.editor.y + 12,
    },
    {
      id: 'edt-puba',
      x1: NC.editor.x + NW - 6,     y1: NC.editor.y - 12,
      x2: NC['publisher-a'].x - NW,  y2: NC['publisher-a'].y,
    },
    {
      id: 'edt-pubb',
      x1: NC.editor.x + NW - 6,     y1: NC.editor.y + 12,
      x2: NC['publisher-b'].x - NW,  y2: NC['publisher-b'].y,
    },
  ]

  const arrowActiveMap: Record<string, boolean> = {
    'seo-inv':  isEdgeActive('seo-strategist', 'investigator'),
    'inv-rtr':  isEdgeActive('investigator', 'router'),
    'rtr-cwa':  isEdgeActive('router', 'copywriter-a'),
    'rtr-cwb':  isEdgeActive('router', 'copywriter-b'),
    'cwa-edt':  isEdgeActive('copywriter-a', 'editor'),
    'cwb-edt':  isEdgeActive('copywriter-b', 'editor'),
    'edt-puba': isEdgeActive('editor', 'publisher-a'),
    'edt-pubb': isEdgeActive('editor', 'publisher-b'),
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        height: '100%',
        overflow: 'auto',
      }}
    >
      {/* Pipeline diagram */}
      <div
        style={{
          background: '#0D0D10',
          border: '1px solid #2A2A32',
          borderRadius: '10px',
          padding: '24px 20px 20px',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <span style={{ fontSize: '1rem' }}>🗺️</span>
          <span
            style={{
              color: '#6B6B80',
              fontSize: '0.625rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            PIPELINE DIAGRAM
          </span>
          {isRunning && (
            <span
              style={{
                marginLeft: '8px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#F59E0B',
                fontSize: '0.5625rem',
                fontWeight: 700,
                letterSpacing: '0.1em',
                borderRadius: '4px',
                padding: '2px 8px',
                fontFamily: "'JetBrains Mono', monospace",
                animation: 'glow-pulse 1.5s ease-in-out infinite',
              }}
            >
              ⚡ ACTIVE
            </span>
          )}
        </div>

        {/* SVG arrows + Node overlays — fixed-pixel container */}
        <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: `${DIAGRAM_W}px`, height: `${DIAGRAM_H}px`, margin: '0 auto' }}>
          {/* SVG for arrows — 1 SVG unit = 1 CSS px */}
          <svg
            width={DIAGRAM_W}
            height={DIAGRAM_H}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
            xmlns="http://www.w3.org/2000/svg"
          >
            {arrows.map((a) => (
              <PipelineArrow key={a.id} {...a} active={arrowActiveMap[a.id]} />
            ))}
          </svg>

          {/* Nodes — exact pixel positions matching SVG coordinates */}
          {(
            [
              { id: 'seo-strategist' as NodeId },
              { id: 'investigator' as NodeId },
              { id: 'router' as NodeId },
              { id: 'copywriter-a' as NodeId },
              { id: 'copywriter-b' as NodeId },
              { id: 'editor' as NodeId },
              { id: 'publisher-a' as NodeId },
              { id: 'publisher-b' as NodeId },
            ] as { id: NodeId }[]
          ).map(({ id }) => {
            const def = getNode(id)
            const nc = NC[id]
            const leftPx = nc.x - NW
            const topPx = nc.y - NH
            const isCopywriter = id === 'copywriter-a' || id === 'copywriter-b'
            const isSeoStrategist = id === 'seo-strategist'
            const isClickable = isCopywriter || isSeoStrategist
            const brandId = id === 'copywriter-a' ? 'gen-z-tech' : 'formal-biz'
            const hasCustomNiche =
              isCopywriter &&
              (id === 'copywriter-a' ? !!settings.nicheA?.trim() : !!settings.nicheB?.trim())
            const seoIsConfigured = isSeoStrategist && (
              (settings.seoDedupeHours ?? 24) !== 24 ||
              (settings.seoShortTail ?? 2) !== 2 ||
              (settings.seoEvergreen ?? 1) !== 1
            )
            const showBadge = (isCopywriter && hasCustomNiche) || (isSeoStrategist && seoIsConfigured)
            const isHovered = hoveredNode === id

            return (
              <div
                key={id}
                onClick={
                  isCopywriter ? () => setConfigModal(brandId)
                  : isSeoStrategist ? () => setSeoModalOpen(true)
                  : undefined
                }
                onMouseEnter={isClickable ? () => setHoveredNode(id) : undefined}
                onMouseLeave={isClickable ? () => setHoveredNode(null) : undefined}
                style={{
                  position: 'absolute',
                  left: `${leftPx}px`,
                  top: `${topPx}px`,
                  zIndex: 2,
                  cursor: isClickable ? 'pointer' : 'default',
                }}
              >
                {/* Config indicator badge */}
                {showBadge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-8px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#10B981',
                      color: '#fff',
                      fontSize: '0.45rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      zIndex: 3,
                      fontFamily: "'JetBrains Mono', monospace",
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                    }}
                  >
                    ✦ CONFIGURED
                  </div>
                )}
                {/* Click hint on hover */}
                {isClickable && isHovered && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-20px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: isSeoStrategist ? 'rgba(16,185,129,0.9)' : 'rgba(245,158,11,0.9)',
                      color: '#000',
                      fontSize: '0.45rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      zIndex: 3,
                      fontFamily: "'JetBrains Mono', monospace",
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      animation: 'fadeIn 0.15s ease',
                    }}
                  >
                    ⚙ CONFIGURE
                  </div>
                )}
                <div
                  style={{
                    transition: 'transform 0.15s ease, filter 0.15s ease',
                    transform: isHovered ? 'scale(1.06)' : 'scale(1)',
                    filter: isHovered
                      ? `drop-shadow(0 0 12px ${isSeoStrategist ? 'rgba(16,185,129,0.6)' : 'rgba(245,158,11,0.6)'})`
                      : 'none',
                  }}
                >
                  <PipelineNode
                    id={def.id}
                    label={def.label}
                    icon={def.icon}
                    state={nodeStates[id]}
                    subtitle={def.subtitle}
                  />
                </div>
              </div>
            )
          })}

        </div>
        </div>
      </div>

      {/* Master controls */}
      <MasterControls
        settings={settings}
        onUpdate={onSettingsUpdate}
        onTrigger={onTrigger}
        isRunning={isRunning}
      />

      {/* Terminal log */}
      <TerminalLog
        entries={logEntries}
        maxHeight="280px"
        onNewEntry={handleNewLogEntry}
      />

      {/* Copywriter Config Modals */}
      {configModal && (
        <CopywriterConfigModal
          brandId={configModal}
          settings={settings}
          onSave={handleSaveConfig}
          onClose={() => setConfigModal(null)}
        />
      )}

      {/* SEO Strategist Config Modal */}
      {seoModalOpen && (
        <SeoStrategistModal
          settings={settings}
          onSave={handleSaveConfig}
          onClose={() => setSeoModalOpen(false)}
        />
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  )
}
