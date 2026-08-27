/**
 * Inline so there is no icon dependency and no request to fetch them, and drawn
 * with `currentColor` so each one takes the colour of the control it sits in —
 * blue on a normal button, red on a destructive one, without a second variant.
 */
type IconProps = { size?: number }

const Svg = ({ size = 16, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    className="icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const IconRefresh = (props: IconProps) => (
  <Svg {...props}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M21 3v5h-5" />
  </Svg>
)

export const IconTrash = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
  </Svg>
)

export const IconUserMinus = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M17 11h6" />
  </Svg>
)

export const IconUsers = (props: IconProps) => (
  <Svg {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
    <path d="M16 3.1a4 4 0 0 1 0 7.8" />
  </Svg>
)

export const IconBuilding = (props: IconProps) => (
  <Svg {...props}>
    <path d="M3 21h18" />
    <path d="M5 21V7l7-4 7 4v14" />
    <path d="M9.5 10h1M13.5 10h1M9.5 14h1M13.5 14h1M9.5 18h1M13.5 18h1" />
  </Svg>
)

export const IconUserCheck = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M16 11.5l2 2 4-4" />
  </Svg>
)

export const IconCheckSquare = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9 11.5l3 3L21.5 5" />
    <path d="M21 12.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </Svg>
)

export const IconSquare = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Svg>
)

export const IconSearch = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
)

export const IconExternal = (props: IconProps) => (
  <Svg {...props}>
    <path d="M14 3h7v7" />
    <path d="M21 3l-9 9" />
    <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
  </Svg>
)

export const IconSun = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)

export const IconMoon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
)

export const IconAuto = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconStop = (props: IconProps) => (
  <Svg {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
)

export const IconClose = (props: IconProps) => (
  <Svg {...props}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
)
