// The HUD's icons: small line drawings in the game's own ink, drawn here so
// the experiment brings no icon library with it.

function Icon({ children, size = 22, fill = 'none', ...rest }) {
  return (
    <svg
      className="sunfarm-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LookIcon = (p) => (
  <Icon {...p}>
    <path d="M5 3.5 18.5 10l-5.6 1.9L11 17.5z" fill="#fff" />
    <path d="m13.5 13.5 5 5" />
  </Icon>
);

export const PanelIcon = (p) => (
  <Icon {...p}>
    <path d="M6 5h12l3 10H3z" fill="#3b7be0" />
    <path
      d="M9.5 5 8.3 15M14.5 5l1.2 10M4.5 10h15"
      stroke="#fff"
      strokeWidth="1.4"
    />
    <path d="M6 5h12l3 10H3z" />
    <path d="M12 15v5M8.5 20h7" />
  </Icon>
);

export const BatteryIcon = (p) => (
  <Icon {...p}>
    <rect x="4" y="7" width="16" height="13" rx="2" fill="#fff8e7" />
    <path d="M8 7V4.5M16 7V4.5" />
    <path d="M12.8 9.5 9.5 14h5l-3.3 4.5" stroke="#1fa37a" />
  </Icon>
);

export const CableIcon = (p) => (
  <Icon {...p}>
    <path d="M12 6v15M7 6h10" stroke="#b47a42" strokeWidth="2.8" />
    <path d="M1.5 7.5c3 3 4.5 2.4 5.5-1.5M22.5 7.5c-3 3-4.5 2.4-5.5-1.5" />
    <path d="M9.5 21h5" />
  </Icon>
);

export const RemoveIcon = (p) => (
  <Icon {...p}>
    <path d="m14.5 4 5.5 5.5-3 3L11.5 7z" fill="#c9d2dc" />
    <path d="m13 8.5-9 9a2.1 2.1 0 0 0 3 3l9-9" />
  </Icon>
);

export const CoinIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" fill="#ffd23f" />
    <circle cx="12" cy="12" r="3.2" fill="#fff3b0" />
    <path
      d="M12 5.6v1.6M12 16.8v1.6M5.6 12h1.6M16.8 12h1.6M7.5 7.5l1.1 1.1M15.4 15.4l1.1 1.1M16.5 7.5l-1.1 1.1M8.6 15.4l-1.1 1.1"
      strokeWidth="1.5"
    />
  </Icon>
);

export const SunIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4.4" fill="#ffd23f" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
  </Icon>
);

export const MoonIcon = (p) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" fill="#dfe6ff" />
  </Icon>
);

export const HouseIcon = (p) => (
  <Icon {...p}>
    <path d="M5 11v9h14v-9" fill="#fff8e7" />
    <path d="M3 12 12 4l9 8" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);

export const BoltIcon = (p) => (
  <Icon {...p}>
    <path d="M13.5 2.5 5 13.5h6l-1 8L19 10h-6z" fill="#ffd23f" />
  </Icon>
);

export const PauseIcon = (p) => (
  <Icon {...p}>
    <path d="M8.5 5v14M15.5 5v14" strokeWidth="3" />
  </Icon>
);

export const PlayIcon = (p) => (
  <Icon {...p}>
    <path d="M7.5 4.5 19 12 7.5 19.5z" fill="currentColor" />
  </Icon>
);

export const TurnLeftIcon = (p) => (
  <Icon {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
    <path d="M4 3.5v4h4" />
  </Icon>
);

export const TurnRightIcon = (p) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
    <path d="M20 3.5v4h-4" />
  </Icon>
);

export const PlusIcon = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" strokeWidth="2.6" />
  </Icon>
);

export const MinusIcon = (p) => (
  <Icon {...p}>
    <path d="M5 12h14" strokeWidth="2.6" />
  </Icon>
);

export const ExpandIcon = (p) => (
  <Icon {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const ShrinkIcon = (p) => (
  <Icon {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
);

export const HelpIcon = (p) => (
  <Icon {...p}>
    <path
      d="M9 9.2a3.1 3.1 0 1 1 4.6 2.7c-1 .6-1.6 1.2-1.6 2.6"
      strokeWidth="2.4"
    />
    <path d="M12 18.4v.2" strokeWidth="3" />
  </Icon>
);

export const FlagIcon = (p) => (
  <Icon {...p}>
    <path d="M6 21V4" />
    <path d="M6 5h11l-2.5 3.5L17 12H6z" fill="#f25f4c" />
  </Icon>
);

export const RestartIcon = (p) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M20 4v4.5h-4.5" />
  </Icon>
);

export const CheckIcon = (p) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth="3" />
  </Icon>
);

export const CloseIcon = (p) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" strokeWidth="2.6" />
  </Icon>
);
