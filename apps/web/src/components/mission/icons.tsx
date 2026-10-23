import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

const base = (className: string | undefined) =>
  cn("size-4 shrink-0", className);

export const ChevronDownIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M18 9C18 9 13.581 15 12 15C10.419 15 6 9 6 9"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CheckIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M5 14L8.5 17.5L19 6.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CircleIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />
  </svg>
);

export const PullRequestIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M6 8L6 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M18 16V12C18 9.172 18 7.757 17.121 6.879C16.243 6 14.828 6 12 6L11 6M11 6C11 5.3 12.994 3.992 13.5 3.5M11 6C11 6.7 12.994 8.008 13.5 8.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <circle cx="6" cy="18" r="2" fill="none" stroke="currentColor" />{" "}
    <circle cx="6" cy="6" r="2" fill="none" stroke="currentColor" />{" "}
    <circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" />
  </svg>
);

export const FileTextIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M8 17H16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M8 13H12"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M13 2.5V3C13 5.828 13 7.243 13.879 8.121C14.757 9 16.172 9 19 9H19.5M20 10.657V14C20 17.771 20 19.657 18.828 20.828C17.657 22 15.771 22 12 22C8.229 22 6.343 22 5.172 20.828C4 19.657 4 17.771 4 14V9.456C4 6.211 4 4.588 4.886 3.489C5.065 3.267 5.267 3.065 5.489 2.886C6.588 2 8.211 2 11.456 2C12.161 2 12.514 2 12.837 2.114C12.904 2.138 12.97 2.165 13.034 2.196C13.344 2.344 13.593 2.593 14.092 3.092L18.828 7.828C19.407 8.406 19.695 8.696 19.848 9.063C20 9.431 20 9.839 20 10.657Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SearchIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M17 17L21 21"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M19 11C19 6.582 15.418 3 11 3C6.582 3 3 6.582 3 11C3 15.418 6.582 19 11 19C15.418 19 19 15.418 19 11Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const FolderIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M8 7H16.75C18.857 7 19.91 7 20.667 7.506C20.994 7.724 21.276 8.006 21.494 8.333C22 9.09 22 10.143 22 12.25C22 15.761 22 17.517 21.157 18.778C20.793 19.324 20.324 19.793 19.778 20.157C18.517 21 16.761 21 13.25 21H12C7.286 21 4.929 21 3.464 19.535C2 18.071 2 15.714 2 11V7.944C2 6.128 2 5.22 2.38 4.538C2.651 4.052 3.052 3.651 3.538 3.38C4.22 3 5.128 3 6.944 3C8.108 3 8.69 3 9.199 3.191C10.362 3.627 10.842 4.684 11.367 5.733L12 7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </svg>
);

export const ChevronsUpDownIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M18 14C18 14 13.581 19 12 19C10.419 19 6 14 6 14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M18 10C18 10 13.581 5 12 5C10.419 5 6 10 6 10"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChevronRightIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M9 6C9 6 15 10.419 15 12C15 13.581 9 18 9 18"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BrainIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M12 4.5C12 3.119 10.881 2 9.5 2C8.119 2 7 3.119 7 4.5C5.343 4.5 4 5.843 4 7.5C4 8.069 4.158 8.6 4.433 9.053C3.047 9.318 2 10.537 2 12C2 13.463 3.047 14.681 4.433 14.946C4.158 15.399 4 15.931 4 16.5C4 18.157 5.343 19.5 7 19.5C7 20.881 8.119 22 9.5 22C10.881 22 12 20.881 12 19.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M12 19.5C12 20.881 13.119 22 14.5 22C15.881 22 17 20.881 17 19.5C18.657 19.5 20 18.157 20 16.5C20 15.931 19.842 15.399 19.567 14.946C20.953 14.681 22 13.463 22 12C22 10.537 20.953 9.318 19.567 9.053C19.842 8.6 20 8.069 20 7.5C20 5.843 18.657 4.5 17 4.5C17 3.119 15.881 2 14.5 2C13.119 2 12 3.119 12 4.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M10.487 7.001V8.98M7 10.501H9.052M15.023 10.501H17.075M15.023 13.475H17.075M7 13.475H9.052M10.487 15.02V16.999M13.512 15.02V16.999M13.502 7.001V8.98M10.052 14.968H14.023C14.575 14.968 15.023 14.521 15.023 13.968V9.98C15.023 9.428 14.575 8.98 14.023 8.98H10.052C9.5 8.98 9.052 9.428 9.052 9.98V13.968C9.052 14.521 9.5 14.968 10.052 14.968Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </svg>
);

export const TerminalIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M14 4H10C6.229 4 4.343 4 3.172 5.172C2 6.343 2 8.229 2 12C2 15.771 2 17.657 3.172 18.828C4.343 20 6.229 20 10 20H14C17.771 20 19.657 20 20.828 18.828C22 17.657 22 15.771 22 12C22 8.229 22 6.343 20.828 5.172C19.657 4 17.771 4 14 4Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M7 9L8.84 10.586C9.613 11.252 10 11.586 10 12C10 12.414 9.613 12.748 8.84 13.414L7 15"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M13 16H17"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PenSquareIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M16.425 4.605L17.415 3.615C18.235 2.795 19.565 2.795 20.385 3.615C21.205 4.435 21.205 5.765 20.385 6.585L19.395 7.575M16.425 4.605L9.766 11.264C9.258 11.772 8.898 12.408 8.724 13.104L8 16L10.896 15.276C11.592 15.102 12.228 14.742 12.736 14.234L19.395 7.575M16.425 4.605L19.395 7.575"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M19 13.5C19 16.788 19 18.431 18.092 19.538C17.926 19.74 17.74 19.926 17.538 20.092C16.431 21 14.787 21 11.5 21H11C7.229 21 5.343 21 4.172 19.828C3 18.657 3 16.771 3 13V12.5C3 9.213 3 7.569 3.908 6.462C4.074 6.26 4.26 6.074 4.462 5.908C5.569 5 7.213 5 10.5 5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ClipboardIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M14.496 2H9.496C8.668 2 7.996 2.672 7.996 3.5C7.996 4.329 8.668 5 9.496 5H14.496C15.325 5 15.996 4.329 15.996 3.5C15.996 2.672 15.325 2 14.496 2Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M7.996 15H11.425M7.996 11H15.996"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M15.996 3.5C17.55 3.547 18.476 3.72 19.117 4.362C19.996 5.24 19.996 6.655 19.996 9.483L19.996 16C19.996 18.828 19.996 20.242 19.117 21.121C18.239 22 16.825 22 13.996 22L9.996 22C7.168 22 5.753 22 4.875 21.121C3.996 20.242 3.996 18.828 3.996 16L3.996 9.483C3.996 6.655 3.996 5.24 4.875 4.362C5.516 3.72 6.443 3.547 7.996 3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const GlobeIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" />{" "}
    <path
      d="M8 12C8 18 12 22 12 22C12 22 16 18 16 12C16 6 12 2 12 2C12 2 8 6 8 12Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M21 15H3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M21 9H3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LinkIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M9.143 10.691L9.35 10.484C11.329 8.505 14.537 8.505 16.516 10.484C18.495 12.463 18.495 15.671 16.516 17.65L13.65 20.516C11.671 22.495 8.463 22.495 6.484 20.516C4.505 18.537 4.505 15.329 6.484 13.35L6.948 12.886"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />{" "}
    <path
      d="M17.052 11.114L17.516 10.65C19.495 8.671 19.495 5.463 17.516 3.484C15.537 1.505 12.329 1.505 10.35 3.484L7.484 6.35C5.505 8.329 5.505 11.537 7.484 13.516C9.463 15.495 12.671 15.495 14.65 13.516L14.857 13.309"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </svg>
);

export const WarningIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M13.925 21H10.075C5.445 21 3.13 21 2.276 19.494C1.423 17.988 2.607 15.991 4.976 11.998L6.901 8.753C9.176 4.918 10.313 3 12 3C13.687 3 14.824 4.918 17.099 8.753L19.024 11.998C21.393 15.991 22.577 17.988 21.724 19.494C20.87 21 18.555 21 13.925 21Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M12 9V13"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M12.125 16.75H12M12.25 16.75C12.25 16.888 12.138 17 12 17C11.862 17 11.75 16.888 11.75 16.75C11.75 16.612 11.862 16.5 12 16.5C12.138 16.5 12.25 16.612 12.25 16.75Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const RepeatIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M20.5 5.5H9.5C5.787 5.5 3 8.185 3 12"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M3.5 18.5H14.5C18.213 18.5 21 15.815 21 12"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M18.5 3C18.5 3 21 4.841 21 5.5C21 6.159 18.5 8 18.5 8"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M5.5 16C5.5 16 3 17.841 3 18.5C3 19.159 5.5 21 5.5 21"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const WandIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M13.926 12.777L11.777 10.629C11.485 10.336 11.338 10.19 11.18 10.112C10.88 9.963 10.527 9.963 10.226 10.112C10.069 10.19 9.922 10.336 9.629 10.629C9.336 10.922 9.19 11.069 9.112 11.226C8.963 11.527 8.963 11.88 9.112 12.18C9.19 12.338 9.336 12.485 9.629 12.777L11.777 14.926M13.926 12.777L20.371 19.223C20.664 19.515 20.81 19.662 20.888 19.82C21.037 20.12 21.037 20.473 20.888 20.774C20.81 20.931 20.664 21.078 20.371 21.371C20.078 21.664 19.931 21.81 19.774 21.888C19.473 22.037 19.12 22.037 18.82 21.888C18.662 21.81 18.515 21.664 18.223 21.371L11.777 14.926M13.926 12.777L11.777 14.926"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M17 2L17.295 2.797C17.681 3.841 17.875 4.363 18.256 4.744C18.637 5.125 19.159 5.319 20.203 5.705L21 6L20.203 6.295C19.159 6.681 18.637 6.875 18.256 7.256C17.875 7.637 17.681 8.159 17.295 9.203L17 10L16.705 9.203C16.319 8.159 16.125 7.637 15.744 7.256C15.363 6.875 14.841 6.681 13.797 6.295L13 6L13.797 5.705C14.841 5.319 15.363 5.125 15.744 4.744C16.125 4.363 16.319 3.841 16.705 2.797L17 2Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M6 4L6.221 4.597C6.511 5.381 6.656 5.773 6.942 6.058C7.227 6.344 7.619 6.489 8.403 6.779L9 7L8.403 7.221C7.619 7.511 7.227 7.656 6.942 7.942C6.656 8.227 6.511 8.619 6.221 9.403L6 10L5.779 9.403C5.489 8.619 5.344 8.227 5.058 7.942C4.773 7.656 4.381 7.511 3.597 7.221L3 7L3.597 6.779C4.381 6.489 4.773 6.344 5.058 6.058C5.344 5.773 5.489 5.381 5.779 4.597L6 4Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />
  </svg>
);

export const PlugIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M15.5 2V6M8.5 6V2"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M6.004 7.613C5.937 6.743 6.64 6 7.53 6H16.47C17.36 6 18.063 6.743 17.995 7.613L17.812 9.992C17.68 11.702 17.101 13.35 16.132 14.777L15.531 15.662C14.964 16.498 14.008 17 12.984 17H11.016C9.992 17 9.036 16.498 8.469 15.662L7.868 14.777C6.899 13.35 6.32 11.702 6.188 9.992L6.004 7.613Z"
      fill="none"
      stroke="currentColor"
    />{" "}
    <path
      d="M12 17V22"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M11 9H13"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const NotesIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M16.5 2V5M7.5 2V5M12 2V5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M13 3.5H11C7.7 3.5 6.05 3.5 5.025 4.525C4 5.55 4 7.2 4 10.5V15C4 18.3 4 19.95 5.025 20.975C6.05 22 7.7 22 11 22H13C16.3 22 17.95 22 18.975 20.975C20 19.95 20 18.3 20 15V10.5C20 7.2 20 5.55 18.975 4.525C17.95 3.5 16.3 3.5 13 3.5Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M8 15H12M8 11H16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ShieldIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M18.709 3.495C16.817 2.554 14.501 2 12 2C9.499 2 7.184 2.554 5.291 3.495C4.363 3.957 3.899 4.188 3.45 4.914C3 5.64 3 6.342 3 7.748V11.237C3 16.921 7.542 20.08 10.173 21.434C10.907 21.811 11.274 22 12 22C12.726 22 13.093 21.811 13.827 21.434C16.458 20.08 21 16.921 21 11.237L21 7.748C21 6.342 21 5.64 20.55 4.914C20.101 4.188 19.637 3.957 18.709 3.495Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CloseIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M18 6L6.001 17.999M17.999 18L6 6.001"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const FilePdfIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M19 11C19 10.182 19 9.431 18.848 9.063C18.695 8.696 18.407 8.406 17.828 7.828L13.092 3.092C12.593 2.593 12.344 2.344 12.034 2.196C11.97 2.165 11.904 2.138 11.837 2.114C11.514 2 11.161 2 10.456 2C7.211 2 5.588 2 4.489 2.886C4.267 3.065 4.065 3.267 3.886 3.489C3 4.588 3 6.211 3 9.456V14C3 17.771 3 19.657 4.172 20.828C5.343 22 7.229 22 11 22H19M12 2.5V3C12 5.828 12 7.243 12.879 8.121C13.757 9 15.172 9 18 9H18.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M21 14H19C18.448 14 18 14.448 18 15V16.5M18 16.5V19M18 16.5H20.5M7 19V17M7 17V14H8.5C9.328 14 10 14.672 10 15.5C10 16.328 9.328 17 8.5 17H7ZM12.5 14H13.786C14.732 14 15.5 14.746 15.5 15.667V17.333C15.5 18.254 14.732 19 13.786 19H12.5V14Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const FileCsvIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M7.5 17.22C7.445 16.029 6.622 16 5.505 16C3.785 16 3.5 16.406 3.5 18V20C3.5 21.594 3.785 22 5.505 22C6.622 22 7.445 21.971 7.5 20.78M20.5 16L18.723 20.695C18.393 21.565 18.229 22 17.968 22C17.707 22 17.542 21.565 17.213 20.695L15.436 16M12.876 16H11.695C11.223 16 10.987 16 10.801 16.076C10.167 16.335 10.176 16.945 10.176 17.5C10.176 18.055 10.167 18.665 10.801 18.924C10.987 19 11.223 19 11.695 19C12.167 19 12.403 19 12.589 19.076C13.223 19.335 13.214 19.945 13.214 20.5C13.214 21.055 13.223 21.665 12.589 21.924C12.403 22 12.167 22 11.695 22H10.409"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />{" "}
    <path
      d="M20 13V10.657C20 9.839 20 9.431 19.848 9.063C19.695 8.696 19.407 8.406 18.828 7.828L14.092 3.092C13.593 2.593 13.344 2.344 13.034 2.196C12.97 2.165 12.904 2.138 12.837 2.114C12.514 2 12.161 2 11.456 2C8.211 2 6.588 2 5.489 2.886C5.267 3.065 5.065 3.267 4.886 3.489C4 4.588 4 6.211 4 9.456V13M13 2.5V3C13 5.828 13 7.243 13.879 8.121C14.757 9 16.172 9 19 9H19.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ClockIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" />{" "}
    <path
      d="M12 8V12L14 14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SwapIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M19 9H6.659C5.653 9 5.15 9 5.025 8.691C4.9 8.383 5.255 8.019 5.966 7.293L8.211 5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M5 15H17.341C18.347 15 18.85 15 18.975 15.309C19.1 15.617 18.745 15.981 18.034 16.707L15.789 19"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ImageFileIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M3 16L7.47 11.53C7.809 11.191 8.27 11 8.75 11C9.23 11 9.691 11.191 10.03 11.53L14 15.5M15.5 17L14 15.5M21 16L18.53 13.53C18.191 13.191 17.73 13 17.25 13C16.77 13 16.309 13.191 15.97 13.53L14 15.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M15.5 8C15.776 8 16 7.776 16 7.5C16 7.224 15.776 7 15.5 7M15.5 8C15.224 8 15 7.776 15 7.5C15 7.224 15.224 7 15.5 7M15.5 8V7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M3.698 19.747C2.5 18.345 2.5 16.23 2.5 12C2.5 7.77 2.5 5.655 3.698 4.253C3.868 4.054 4.054 3.868 4.253 3.698C5.655 2.5 7.77 2.5 12 2.5C16.23 2.5 18.345 2.5 19.747 3.698C19.946 3.868 20.132 4.054 20.302 4.253C21.5 5.655 21.5 7.77 21.5 12C21.5 16.23 21.5 18.345 20.302 19.747C20.132 19.946 19.946 20.132 19.747 20.302C18.345 21.5 16.23 21.5 12 21.5C7.77 21.5 5.655 21.5 4.253 20.302C4.054 20.132 3.868 19.946 3.698 19.747Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PlayIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M18.891 12.846C18.537 14.189 16.867 15.138 13.526 17.036C10.296 18.871 8.681 19.788 7.38 19.42C6.842 19.267 6.352 18.978 5.956 18.579C5 17.614 5 15.743 5 12C5 8.257 5 6.386 5.956 5.421C6.352 5.022 6.842 4.733 7.38 4.58C8.681 4.212 10.296 5.129 13.526 6.964C16.867 8.862 18.537 9.811 18.891 11.154C19.037 11.708 19.037 12.292 18.891 12.846Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />
  </svg>
);

export const PaperclipIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M5.823 12L4.279 10.456C2.574 8.75 2.574 5.985 4.279 4.279C5.985 2.574 8.75 2.574 10.456 4.279L19.721 13.544C21.426 15.25 21.426 18.015 19.721 19.721C18.015 21.426 15.25 21.426 13.544 19.721L10.07 16.246C9.004 15.18 9.004 13.452 10.07 12.386C11.136 11.32 12.864 11.32 13.93 12.386L15.86 14.316"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const AtIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M15.6 8.4V12.9C15.6 14.392 16.809 15.6 18.3 15.6C19.791 15.6 21 14.392 21 12.9V12C21 7.029 16.971 3 12 3C7.029 3 3 7.029 3 12C3 16.971 7.029 21 12 21C14.027 21 15.896 20.33 17.401 19.2M15.6 12C15.6 13.989 13.988 15.6 12 15.6C10.012 15.6 8.4 13.989 8.4 12C8.4 10.012 10.012 8.4 12 8.4C13.988 8.4 15.6 10.012 15.6 12Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </svg>
);

export const ArrowUpIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M12 5.5V19"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M18 11C18 11 13.581 5 12 5C10.419 5 6 11 6 11"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SidebarIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M2 12C2 8.311 2 6.466 2.814 5.159C3.115 4.675 3.489 4.254 3.919 3.916C5.081 3 6.721 3 10 3H14C17.279 3 18.919 3 20.081 3.916C20.511 4.254 20.885 4.675 21.186 5.159C22 6.466 22 8.311 22 12C22 15.689 22 17.534 21.186 18.841C20.885 19.325 20.511 19.746 20.081 20.084C18.919 21 17.279 21 14 21H10C6.721 21 5.081 21 3.919 20.084C3.489 19.746 3.115 19.325 2.814 18.841C2 17.534 2 15.689 2 12Z"
      fill="none"
      stroke="currentColor"
    />{" "}
    <path
      d="M9.5 3L9.5 21"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M5 7H6M5 10H6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PauseIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M4 7C4 5.586 4 4.879 4.439 4.439C4.879 4 5.586 4 7 4C8.414 4 9.121 4 9.561 4.439C10 4.879 10 5.586 10 7V17C10 18.414 10 19.121 9.561 19.561C9.121 20 8.414 20 7 20C5.586 20 4.879 20 4.439 19.561C4 19.121 4 18.414 4 17V7Z"
      fill="none"
      stroke="currentColor"
    />{" "}
    <path
      d="M14 7C14 5.586 14 4.879 14.439 4.439C14.879 4 15.586 4 17 4C18.414 4 19.121 4 19.561 4.439C20 4.879 20 5.586 20 7V17C20 18.414 20 19.121 19.561 19.561C19.121 20 18.414 20 17 20C15.586 20 14.879 20 14.439 19.561C14 19.121 14 18.414 14 17V7Z"
      fill="none"
      stroke="currentColor"
    />
  </svg>
);

export const MergeIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M7 19H13C15.828 19 17.243 19 18.121 18.121C19 17.243 19 15.828 19 13V10M19 10C19.7 10 21.009 11.994 21.5 12.5M19 10C18.3 10 16.991 11.994 16.5 12.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M5 7L5 17"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <circle cx="5" cy="5" r="2" fill="none" stroke="currentColor" />{" "}
    <circle cx="19" cy="5" r="2" fill="none" stroke="currentColor" />{" "}
    <circle cx="5" cy="19" r="2" fill="none" stroke="currentColor" />
  </svg>
);

export const ArrowUpRightIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M9 6.65C9 6.65 15.938 6.108 16.915 7.085C17.892 8.062 17.35 15 17.35 15M16.5 7.5L6.5 17.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LayersIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M8.643 3.146L6.938 3.934C4.313 5.147 3 5.754 3 6.75C3 7.746 4.313 8.353 6.938 9.566L8.643 10.354C10.295 11.118 11.121 11.5 12 11.5C12.879 11.5 13.705 11.118 15.357 10.354L17.062 9.566C19.687 8.353 21 7.746 21 6.75C21 5.754 19.687 5.147 17.062 3.934L15.357 3.146C13.705 2.382 12.879 2 12 2C11.121 2 10.295 2.382 8.643 3.146Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M20.788 11.097C20.929 11.296 21 11.503 21 11.731C21 12.713 19.687 13.311 17.062 14.507L15.357 15.284C13.705 16.037 12.879 16.413 12 16.413C11.121 16.413 10.295 16.037 8.643 15.284L6.938 14.507C4.313 13.311 3 12.713 3 11.731C3 11.503 3.071 11.296 3.212 11.097"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M20.377 16.266C20.792 16.597 21 16.927 21 17.318C21 18.299 19.687 18.898 17.062 20.094L15.357 20.871C13.705 21.624 12.879 22 12 22C11.121 22 10.295 21.624 8.643 20.871L6.938 20.094C4.313 18.898 3 18.299 3 17.318C3 16.927 3.208 16.597 3.623 16.266"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DownloadIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M16.95 12.182C17.198 12.814 16.508 13.573 15.127 15.09C13.67 16.69 12.92 17.49 12 17.5C11.08 17.49 10.33 16.69 8.873 15.09C7.492 13.573 6.802 12.814 7.05 12.182C7.059 12.159 7.069 12.136 7.079 12.114C7.349 11.542 8.245 11.503 10 11.5V5C10 4.535 10 4.303 10.051 4.112C10.19 3.594 10.594 3.19 11.112 3.051C11.303 3 11.535 3 12 3C12.465 3 12.697 3 12.888 3.051C13.406 3.19 13.81 3.594 13.949 4.112C14 4.303 14 4.535 14 5V11.5C15.755 11.503 16.651 11.542 16.921 12.114C16.931 12.136 16.941 12.159 16.95 12.182Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M5 21H19"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CopyIcon = ({ className, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={base(className)}
    fill="none"
    strokeWidth="1.75"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M7.5 14.5C7.5 11.2 7.5 9.55 8.525 8.525C9.55 7.5 11.2 7.5 14.5 7.5C17.8 7.5 19.45 7.5 20.475 8.525C21.5 9.55 21.5 11.2 21.5 14.5C21.5 17.8 21.5 19.45 20.475 20.475C19.45 21.5 17.8 21.5 14.5 21.5C11.2 21.5 9.55 21.5 8.525 20.475C7.5 19.45 7.5 17.8 7.5 14.5Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />{" "}
    <path
      d="M7.5 16.5C6.104 16.5 5.405 16.5 4.844 16.304C3.839 15.952 3.048 15.161 2.696 14.156C2.5 13.595 2.5 12.896 2.5 11.5V9.5C2.5 6.2 2.5 4.55 3.525 3.525C4.55 2.5 6.2 2.5 9.5 2.5H11.5C12.896 2.5 13.595 2.5 14.156 2.696C15.161 3.048 15.952 3.839 16.304 4.844C16.5 5.405 16.5 6.104 16.5 7.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
