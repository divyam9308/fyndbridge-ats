import './FyndbridgeLoader.css'

export function FyndbridgeLoader({ size = 84, label = 'Loading...', ariaLabel = label, className = '' }) {
  return (
    <div
      className={`fyndbridge-loader-wrap ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 90 94"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="fyndbridge-loader"
        style={{ '--fyndbridge-loader-size': `${size}px` }}
      >
        <g
          className="fyndbridge-loader-progress"
          fill="none"
          stroke="#DAB111"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M47 52 L35 52 L35 14 L79 14 L79 52 L69 52"
            pathLength="1"
          />
          <path
            d="M26 35 L13 35 L13 73 L58 73 L58 35 L47 35"
            pathLength="1"
          />
        </g>
      </svg>
      {label ? <span>{label}</span> : null}
    </div>
  )
}
