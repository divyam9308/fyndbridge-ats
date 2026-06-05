/**
 * FyndbridgeLogo — Official Fyndbridge brand wordmark.
 *
 * Logo mark : two golden squares (#DAB111)
 * Brand name: FYNDBRIDGE — all caps
 * Tagline   : BRIDGING TALENT & SUCCESS — all caps
 *
 * Props:
 *   size        — 'sm' | 'md' | 'lg' | 'xl'
 *   theme       — 'light' | 'dark'
 *                 light → navy #001264 text  (use on white/off-white backgrounds)
 *                 dark  → white text          (use on navy/dark backgrounds)
 *   showTagline — boolean (default false)
 *   className   — extra class string
 */
export default function FyndbridgeLogo({
  size = 'md',
  theme = 'dark',
  showTagline = false,
  className = '',
}) {
  const cfg = {
    sm: { icon: 18, name: 13, tag: 7.5,  gap: 8,  iconGap: 2 },
    md: { icon: 24, name: 16, tag: 8.5,  gap: 10, iconGap: 2.5 },
    lg: { icon: 32, name: 21, tag: 10,   gap: 12, iconGap: 3 },
    xl: { icon: 44, name: 28, tag: 12,   gap: 16, iconGap: 4 },
  }
  const c = cfg[size] || cfg.md

  const GOLD  = '#DAB111'
  const textColor   = theme === 'light' ? '#001264' : '#FFFFFF'
  const taglineColor = theme === 'light'
    ? 'rgba(0,18,100,0.55)'
    : 'rgba(255,255,255,0.45)'

  /* Two overlapping golden squares — the bridge icon mark */
  const sq = c.icon * 0.42           // square side length
  const overlap = sq * 0.28          // horizontal overlap amount
  const totalW = sq * 2 - overlap    // total icon width
  const totalH = sq                  // total icon height

  return (
    <div
      className={`fynd-logo ${className}`}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        userSelect: 'none',
      }}
    >
      {/* Row: icon + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: c.gap }}>

        {/* Golden double-square icon */}
        <svg
          width={totalW}
          height={totalH}
          viewBox={`0 0 ${totalW} ${totalH}`}
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          {/* Back square (slightly offset) */}
          <rect
            x={sq - overlap}
            y={0}
            width={sq}
            height={sq}
            rx={sq * 0.14}
            fill={GOLD}
            opacity={0.7}
          />
          {/* Front square */}
          <rect
            x={0}
            y={0}
            width={sq}
            height={sq}
            rx={sq * 0.14}
            fill={GOLD}
          />
        </svg>

        {/* Brand name */}
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: c.name,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: textColor,
            lineHeight: 1,
            textTransform: 'uppercase',
          }}
        >
          FYNDBRIDGE
        </span>
      </div>

      {/* Tagline */}
      {showTagline && (
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: c.tag,
            fontWeight: 600,
            letterSpacing: '0.14em',
            color: taglineColor,
            textTransform: 'uppercase',
            lineHeight: 1,
            paddingLeft: totalW + c.gap,   // align under the brand name
          }}
        >
          Bridging Talent &amp; Success
        </span>
      )}
    </div>
  )
}
