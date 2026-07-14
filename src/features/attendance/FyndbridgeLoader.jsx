export function FyndbridgeLoader({ size = 84, label = 'Loading attendance...', className = '' }) {
  return (
    <div
      className={`fyndbridge-loader-wrap ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label="Loading Team Attendance"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 240 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="fyndbridge-loader"
        style={{ '--fyndbridge-loader-size': `${size}px` }}
      >
        <g
          fill="none"
          stroke="#E0B300"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M83 126 L83 45 L191 45 L191 132 L155 132"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset="1"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="1;0;0;1"
              keyTimes="0;0.52;0.82;1"
              dur="2.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="1;1;1;0"
              keyTimes="0;0.78;0.86;1"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </path>

          <path
            d="M68 98 L37 98 L37 185 L139 185 L139 98 L112 98"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset="1"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="1;0;0;1"
              keyTimes="0;0.52;0.82;1"
              dur="2.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="1;1;1;0"
              keyTimes="0;0.78;0.86;1"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </path>
        </g>
      </svg>

      {label ? <span>{label}</span> : null}
    </div>
  )
}
