import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/*
 * Hugeicons stroke-rounded glyphs exported from the Paper file. Paper draws
 * them at a 1.75 stroke; lucide's paths differ, so the exact SVGs live here.
 */

const iconVariants = cva("shrink-0", {
  defaultVariants: { size: "md", tone: "inherit" },
  variants: {
    size: {
      lg: "size-5",
      md: "size-4",
      sm: "size-3.5",
      xs: "size-3",
    },
    tone: {
      accent: "text-accent",
      danger: "text-danger",
      disabled: "text-text-disabled",
      inherit: "",
      secondary: "text-text-secondary",
      success: "text-success",
      tertiary: "text-text-tertiary",
      text: "text-text",
      warning: "text-warning",
    },
  },
});

export type IconProps = Omit<ComponentProps<"svg">, "size"> &
  VariantProps<typeof iconVariants>;

const Svg = ({ children, className, size, tone, ...props }: IconProps) => (
  <svg
    aria-hidden="true"
    className={cn(iconVariants({ size, tone }), className)}
    fill="none"
    focusable="false"
    stroke="currentColor"
    strokeWidth={1.75}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    {children}
  </svg>
);

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M17 17L21 21" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M19 11C19 6.582 15.418 3 11 3C6.582 3 3 6.582 3 11C3 15.418 6.582 19 11 19C15.418 19 19 15.418 19 11Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12.001 5V19.002" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M19.002 12.002L5 12.002"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const PullRequestIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M6 8L6 16" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M18 16V12C18 9.172 18 7.757 17.121 6.879C16.243 6 14.828 6 12 6L11 6M11 6C11 5.3 12.994 3.992 13.5 3.5M11 6C11 6.7 12.994 8.008 13.5 8.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="18" r="2" />
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const ClockIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8V12L14 14" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const UnfoldIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M18 14C18 14 13.581 19 12 19C10.419 19 6 14 6 14"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18 10C18 10 13.581 5 12 5C10.419 5 6 10 6 10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FolderIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M8 7H16.75C18.857 7 19.91 7 20.667 7.506C20.994 7.724 21.276 8.006 21.494 8.333C22 9.09 22 10.143 22 12.25C22 15.761 22 17.517 21.157 18.778C20.793 19.324 20.324 19.793 19.778 20.157C18.517 21 16.761 21 13.25 21H12C7.286 21 4.929 21 3.464 19.535C2 18.071 2 15.714 2 11V7.944C2 6.128 2 5.22 2.38 4.538C2.651 4.052 3.052 3.651 3.538 3.38C4.22 3 5.128 3 6.944 3C8.108 3 8.69 3 9.199 3.191C10.362 3.627 10.842 4.684 11.367 5.733L12 7"
      strokeLinecap="round"
    />
  </Svg>
);

export const BranchIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M7 19H13C15.828 19 17.243 19 18.121 18.121C19 17.243 19 15.828 19 13V10M19 10C19.7 10 21.009 11.994 21.5 12.5M19 10C18.3 10 16.991 11.994 16.5 12.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M5 7L5 17" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="5" cy="5" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
  </Svg>
);

export const LaptopIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M20.5 16.5V8.5C20.5 6.143 20.5 4.964 19.768 4.232C19.035 3.5 17.857 3.5 15.5 3.5H8.5C6.143 3.5 4.964 3.5 4.232 4.232C3.5 4.964 3.5 6.143 3.5 8.5V16.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21.984 20.5H2.016C1.633 20.5 1.384 20.109 1.555 19.776L3.5 16.5H20.5L22.445 19.776C22.616 20.109 22.367 20.5 21.984 20.5Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M18 6L6.001 17.999M17.999 18L6 6.001"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const BugIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M3.013 4.991C2.893 6.051 3.552 8.423 6.489 8.423"
      strokeLinecap="round"
    />
    <path
      d="M17.595 8.381C18.836 8.579 21.113 7.499 20.996 5.003"
      strokeLinecap="round"
    />
    <path
      d="M20.993 20.999C21.053 19.943 20.178 17.555 17.599 17.423"
      strokeLinecap="round"
    />
    <path
      d="M6.452 17.471C5.65 17.231 3.013 18.335 3.013 20.999"
      strokeLinecap="round"
    />
    <path d="M9.33 6.119C9.354 5.099 9.845 2.999 12.003 2.999C13.921 2.999 14.586 4.619 14.676 6.119M6.261 9.419C6.381 8.639 7.292 6.815 9.366 6.635C11.463 6.556 14.34 6.587 14.88 6.671C15.587 6.734 17.295 7.439 17.751 9.419C17.912 10.439 17.828 11.879 17.852 12.719C17.817 13.559 17.921 15.262 17.756 16.139C17.637 17.099 16.989 18.467 16.102 19.307C14.784 20.723 11.164 22.211 8.035 19.451C6.417 17.891 6.309 16.379 6.189 15.779C6.157 15.457 6.159 13.876 6.165 12.359C6.141 11.046 6.172 9.781 6.261 9.419Z" />
    <path d="M3.013 12.899H5.95" strokeLinecap="round" />
    <path d="M20.993 12.899L18.116 12.899" strokeLinecap="round" />
    <path d="M12.003 16.499L12.003 20.279" strokeLinecap="round" />
  </Svg>
);

export const TaskDoneIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M11 6L21 6" strokeLinecap="round" />
    <path d="M11 12L21 12" strokeLinecap="round" />
    <path d="M11 18L21 18" strokeLinecap="round" />
    <path
      d="M3 7.393C3 7.393 4 8.045 4.5 9C4.5 9 6 5.25 8 4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 18.393C3 18.393 4 19.045 4.5 20C4.5 20 6 16.25 8 15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const AttachIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M5.823 12L4.279 10.456C2.574 8.75 2.574 5.985 4.279 4.279C5.985 2.574 8.75 2.574 10.456 4.279L19.721 13.544C21.426 15.25 21.426 18.015 19.721 19.721C18.015 21.426 15.25 21.426 13.544 19.721L10.07 16.246C9.004 15.18 9.004 13.452 10.07 12.386C11.136 11.32 12.864 11.32 13.93 12.386L15.86 14.316"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const AtIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M15.6 8.4V12.9C15.6 14.392 16.809 15.6 18.3 15.6C19.791 15.6 21 14.392 21 12.9V12C21 7.029 16.971 3 12 3C7.029 3 3 7.029 3 12C3 16.971 7.029 21 12 21C14.027 21 15.896 20.33 17.401 19.2M15.6 12C15.6 13.989 13.988 15.6 12 15.6C10.012 15.6 8.4 13.989 8.4 12C8.4 10.012 10.012 8.4 12 8.4C13.988 8.4 15.6 10.012 15.6 12Z"
      strokeLinecap="round"
    />
  </Svg>
);

export const ShieldIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M18.709 3.495C16.817 2.554 14.501 2 12 2C9.499 2 7.184 2.554 5.291 3.495C4.363 3.957 3.899 4.188 3.45 4.914C3 5.64 3 6.342 3 7.748V11.237C3 16.921 7.542 20.08 10.173 21.434C10.907 21.811 11.274 22 12 22C12.726 22 13.093 21.811 13.827 21.434C16.458 20.08 21 16.921 21 11.237L21 7.748C21 6.342 21 5.64 20.55 4.914C20.101 4.188 19.637 3.957 18.709 3.495Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M18 9C18 9 13.581 15 12 15C10.419 15 6 9 6 9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5.5V19" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M18 11C18 11 13.581 5 12 5C10.419 5 6 11 6 11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FolderAddIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M13 21H12C7.286 21 4.929 21 3.464 19.535C2 18.071 2 15.714 2 11V7.944C2 6.128 2 5.22 2.38 4.538C2.651 4.052 3.052 3.651 3.538 3.38C4.22 3 5.128 3 6.944 3C8.108 3 8.69 3 9.199 3.191C10.362 3.627 10.842 4.684 11.367 5.733L12 7M8 7H16.75C18.857 7 19.91 7 20.667 7.506C20.994 7.724 21.276 8.006 21.494 8.333C21.98 9.059 21.999 10.059 22 12"
      strokeLinecap="round"
    />
    <path d="M18 13V21M22 17H14" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const GithubIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M10 20.567C6.571 21.725 3.714 20.567 2 17"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 22V18.758C10 18.16 10.184 17.64 10.48 17.17C10.684 16.848 10.544 16.39 10.177 16.289C7.134 15.453 5 14.108 5 9.646C5 8.486 5.38 7.396 6.048 6.446C6.214 6.21 6.297 6.092 6.317 5.985C6.337 5.878 6.303 5.739 6.233 5.459C5.95 4.323 5.969 3.116 6.393 2.028C6.393 2.028 7.27 1.742 9.267 2.99C9.723 3.274 9.951 3.417 10.152 3.449C10.352 3.481 10.621 3.414 11.157 3.28C11.891 3.098 12.648 3 13.5 3C14.352 3 15.109 3.098 15.843 3.28C16.379 3.414 16.648 3.481 16.849 3.449C17.049 3.417 17.277 3.274 17.733 2.99C19.73 1.742 20.607 2.028 20.607 2.028C21.031 3.116 21.05 4.323 20.767 5.459C20.697 5.739 20.663 5.878 20.683 5.985C20.703 6.092 20.786 6.21 20.952 6.446C21.62 7.396 22 8.486 22 9.646C22 14.108 19.866 15.453 16.823 16.289C16.456 16.39 16.316 16.848 16.52 17.17C16.816 17.64 17 18.16 17 18.758V22"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const LinkIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M9.143 10.691L9.35 10.484C11.329 8.505 14.537 8.505 16.516 10.484C18.495 12.463 18.495 15.671 16.516 17.65L13.65 20.516C11.671 22.495 8.463 22.495 6.484 20.516C4.505 18.537 4.505 15.329 6.484 13.35L6.948 12.886"
      strokeLinecap="round"
    />
    <path
      d="M17.052 11.114L17.516 10.65C19.495 8.671 19.495 5.463 17.516 3.484C15.537 1.505 12.329 1.505 10.35 3.484L7.484 6.35C5.505 8.329 5.505 11.537 7.484 13.516C9.463 15.495 12.671 15.495 14.65 13.516L14.857 13.309"
      strokeLinecap="round"
    />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M5 14L8.5 17.5L19 6.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FolderLibraryIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M16.263 10.5H7.737C5.156 10.5 3.865 10.5 3.271 11.353C2.678 12.205 3.119 13.426 4.001 15.867L5.085 18.867C5.545 20.14 5.775 20.776 6.289 21.138C6.802 21.5 7.475 21.5 8.821 21.5H15.179C16.525 21.5 17.198 21.5 17.711 21.138C18.224 20.776 18.454 20.14 18.915 18.867L19.999 15.867C20.881 13.426 21.322 12.205 20.729 11.353C20.135 10.5 18.844 10.5 16.263 10.5Z"
      strokeLinecap="square"
    />
    <path
      d="M19 8C19 7.534 19 7.301 18.924 7.117C18.822 6.872 18.628 6.678 18.383 6.576C18.199 6.5 17.966 6.5 17.5 6.5H6.5C6.034 6.5 5.801 6.5 5.617 6.576C5.372 6.678 5.178 6.872 5.076 7.117C5 7.301 5 7.534 5 8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 4C16.5 3.534 16.5 3.301 16.424 3.117C16.322 2.872 16.128 2.678 15.883 2.576C15.699 2.5 15.466 2.5 15 2.5H9C8.534 2.5 8.301 2.5 8.117 2.576C7.872 2.678 7.678 2.872 7.576 3.117C7.5 3.301 7.5 3.534 7.5 4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M16.95 12.182C17.198 12.814 16.508 13.573 15.127 15.09C13.67 16.69 12.92 17.49 12 17.5C11.08 17.49 10.33 16.69 8.873 15.09C7.492 13.573 6.802 12.814 7.05 12.182C7.059 12.159 7.069 12.136 7.079 12.114C7.349 11.542 8.245 11.503 10 11.5V5C10 4.535 10 4.303 10.051 4.112C10.19 3.594 10.594 3.19 11.112 3.051C11.303 3 11.535 3 12 3C12.465 3 12.697 3 12.888 3.051C13.406 3.19 13.81 3.594 13.949 4.112C14 4.303 14 4.535 14 5V11.5C15.755 11.503 16.651 11.542 16.921 12.114C16.931 12.136 16.941 12.159 16.95 12.182Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M5 21H19" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FolderOpenIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M2 19V7.549C2 6.105 2 5.383 2.243 4.816C2.547 4.11 3.11 3.547 3.816 3.243C4.383 3 5.098 3 6.549 3H7.043C7.648 3 8.221 3.274 8.6 3.745L10.418 6M10.418 6H16C17.4 6 18.1 6 18.635 6.272C19.105 6.512 19.488 6.895 19.727 7.365C20 7.9 20 8.6 20 10V11M10.418 6H7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.158 15.514L3.456 14.772C4.19 12.945 4.557 12.032 5.322 11.516C6.088 11 7.076 11 9.052 11H17.112C19.8 11 21.145 11 21.742 11.879C22.34 12.758 21.84 14 20.842 16.486L20.544 17.228C19.81 19.055 19.443 19.968 18.678 20.484C17.912 21 16.924 21 14.948 21H6.888C4.2 21 2.855 21 2.258 20.121C1.66 19.242 2.16 18 3.158 15.514Z"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M9 6C9 6 15 10.419 15 12C15 13.581 9 18 9 18"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const AlertIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M13.925 21H10.075C5.445 21 3.13 21 2.276 19.494C1.423 17.988 2.607 15.991 4.976 11.998L6.901 8.753C9.176 4.918 10.313 3 12 3C13.687 3 14.824 4.918 17.099 8.753L19.024 11.998C21.393 15.991 22.577 17.988 21.724 19.494C20.87 21 18.555 21 13.925 21Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 9V13" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M12.125 16.75H12M12.25 16.75C12.25 16.888 12.138 17 12 17C11.862 17 11.75 16.888 11.75 16.75C11.75 16.612 11.862 16.5 12 16.5C12.138 16.5 12.25 16.612 12.25 16.75Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const TerminalIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M14 4H10C6.229 4 4.343 4 3.172 5.172C2 6.343 2 8.229 2 12C2 15.771 2 17.657 3.172 18.828C4.343 20 6.229 20 10 20H14C17.771 20 19.657 20 20.828 18.828C22 17.657 22 15.771 22 12C22 8.229 22 6.343 20.828 5.172C19.657 4 17.771 4 14 4Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 9L8.84 10.586C9.613 11.252 10 11.586 10 12C10 12.414 9.613 12.748 8.84 13.414L7 15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M13 16H17" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M7.5 14.5C7.5 11.2 7.5 9.55 8.525 8.525C9.55 7.5 11.2 7.5 14.5 7.5C17.8 7.5 19.45 7.5 20.475 8.525C21.5 9.55 21.5 11.2 21.5 14.5C21.5 17.8 21.5 19.45 20.475 20.475C19.45 21.5 17.8 21.5 14.5 21.5C11.2 21.5 9.55 21.5 8.525 20.475C7.5 19.45 7.5 17.8 7.5 14.5Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.5 16.5C6.104 16.5 5.405 16.5 4.844 16.304C3.839 15.952 3.048 15.161 2.696 14.156C2.5 13.595 2.5 12.896 2.5 11.5V9.5C2.5 6.2 2.5 4.55 3.525 3.525C4.55 2.5 6.2 2.5 9.5 2.5H11.5C12.896 2.5 13.595 2.5 14.156 2.696C15.161 3.048 15.952 3.839 16.304 4.844C16.5 5.405 16.5 6.104 16.5 7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const RepeatIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M20.5 5.5H9.5C5.787 5.5 3 8.185 3 12"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.5 18.5H14.5C18.213 18.5 21 15.815 21 12"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18.5 3C18.5 3 21 4.841 21 5.5C21 6.159 18.5 8 18.5 8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.5 16C5.5 16 3 17.841 3 18.5C3 19.159 5.5 21 5.5 21"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const LayersIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M8.643 3.146L6.938 3.934C4.313 5.147 3 5.754 3 6.75C3 7.746 4.313 8.353 6.938 9.566L8.643 10.354C10.295 11.118 11.121 11.5 12 11.5C12.879 11.5 13.705 11.118 15.357 10.354L17.062 9.566C19.687 8.353 21 7.746 21 6.75C21 5.754 19.687 5.147 17.062 3.934L15.357 3.146C13.705 2.382 12.879 2 12 2C11.121 2 10.295 2.382 8.643 3.146Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.788 11.097C20.929 11.296 21 11.503 21 11.731C21 12.713 19.687 13.311 17.062 14.507L15.357 15.284C13.705 16.037 12.879 16.413 12 16.413C11.121 16.413 10.295 16.037 8.643 15.284L6.938 14.507C4.313 13.311 3 12.713 3 11.731C3 11.503 3.071 11.296 3.212 11.097"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.377 16.266C20.792 16.597 21 16.927 21 17.318C21 18.299 19.687 18.898 17.062 20.094L15.357 20.871C13.705 21.624 12.879 22 12 22C11.121 22 10.295 21.624 8.643 20.871L6.938 20.094C4.313 18.898 3 18.299 3 17.318C3 16.927 3.208 16.597 3.623 16.266"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FlaskIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M8 2H16" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M16.219 13.004L15.992 13.615C15.522 14.65 14.111 15.744 11.761 14.318C10.247 13.4 8.937 12.663 8 13.16L7.219 13.541"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14.532 2V8.566C14.532 9.278 14.532 9.634 14.63 9.972C14.729 10.31 14.92 10.612 15.302 11.216L17.286 14.35C19.427 17.733 20.498 19.424 19.775 20.712C19.052 22 17.032 22 12.991 22H11.009C6.968 22 4.948 22 4.225 20.712C3.502 19.424 4.573 17.733 6.714 14.35L8.698 11.216C9.08 10.612 9.271 10.31 9.37 9.972C9.468 9.634 9.468 9.278 9.468 8.566V2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.125 19H15M15.25 19C15.25 19.138 15.138 19.25 15 19.25C14.862 19.25 14.75 19.138 14.75 19C14.75 18.862 14.862 18.75 15 18.75C15.138 18.75 15.25 18.862 15.25 19Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.125 17H10M10.25 17C10.25 17.138 10.138 17.25 10 17.25C9.862 17.25 9.75 17.138 9.75 17C9.75 16.862 9.862 16.75 10 16.75C10.138 16.75 10.25 16.862 10.25 17Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const SettingsIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M21.317 7.141L20.824 6.285C20.451 5.637 20.264 5.313 19.946 5.184C19.629 5.055 19.27 5.157 18.551 5.36L17.331 5.704C16.872 5.81 16.391 5.75 15.973 5.535L15.636 5.34C15.277 5.11 15 4.771 14.848 4.373L14.514 3.375C14.294 2.715 14.184 2.385 13.923 2.197C13.662 2.008 13.314 2.008 12.62 2.008H11.505C10.811 2.008 10.464 2.008 10.202 2.197C9.941 2.385 9.831 2.715 9.611 3.375L9.278 4.373C9.125 4.771 8.848 5.11 8.489 5.34L8.152 5.535C7.734 5.75 7.253 5.81 6.794 5.704L5.574 5.36C4.855 5.157 4.496 5.055 4.179 5.184C3.861 5.313 3.674 5.637 3.301 6.285L2.808 7.141C2.458 7.749 2.283 8.052 2.317 8.375C2.351 8.699 2.585 8.959 3.053 9.48L4.084 10.633C4.336 10.952 4.515 11.508 4.515 12.008C4.515 12.508 4.336 13.064 4.084 13.383L3.053 14.535C2.585 15.056 2.351 15.317 2.317 15.64C2.283 15.963 2.458 16.267 2.808 16.874L3.301 17.731C3.674 18.378 3.861 18.703 4.179 18.832C4.496 18.961 4.855 18.859 5.574 18.655L6.794 18.311C7.253 18.206 7.734 18.266 8.153 18.481L8.489 18.675C8.849 18.905 9.125 19.244 9.277 19.643L9.611 20.64C9.831 21.3 9.941 21.63 10.202 21.819C10.464 22.008 10.811 22.008 11.505 22.008H12.62C13.314 22.008 13.662 22.008 13.923 21.819C14.184 21.63 14.294 21.3 14.514 20.64L14.848 19.643C15 19.244 15.277 18.905 15.636 18.675L15.972 18.481C16.391 18.266 16.872 18.206 17.331 18.311L18.551 18.655C19.27 18.859 19.629 18.961 19.946 18.832C20.264 18.703 20.451 18.378 20.824 17.731L21.317 16.874C21.667 16.267 21.842 15.963 21.808 15.64C21.774 15.317 21.54 15.056 21.072 14.535L20.041 13.383C19.789 13.064 19.61 12.508 19.61 12.008C19.61 11.508 19.789 10.952 20.041 10.633L21.072 9.48C21.54 8.959 21.774 8.699 21.808 8.375C21.842 8.052 21.667 7.749 21.317 7.141Z"
      strokeLinecap="round"
    />
    <path d="M15.52 12C15.52 13.933 13.953 15.5 12.02 15.5C10.086 15.5 8.52 13.933 8.52 12C8.52 10.067 10.086 8.5 12.02 8.5C13.953 8.5 15.52 10.067 15.52 12Z" />
  </Svg>
);

export const SidebarLeftIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M2 12C2 8.311 2 6.466 2.814 5.159C3.115 4.675 3.489 4.254 3.919 3.916C5.081 3 6.721 3 10 3H14C17.279 3 18.919 3 20.081 3.916C20.511 4.254 20.885 4.675 21.186 5.159C22 6.466 22 8.311 22 12C22 15.689 22 17.534 21.186 18.841C20.885 19.325 20.511 19.746 20.081 20.084C18.919 21 17.279 21 14 21H10C6.721 21 5.081 21 3.919 20.084C3.489 19.746 3.115 19.325 2.814 18.841C2 17.534 2 15.689 2 12Z" />
    <path d="M9.5 3L9.5 21" strokeLinejoin="round" />
    <path d="M5 7H6M5 10H6" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ClipboardIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M14.496 2H9.496C8.668 2 7.996 2.672 7.996 3.5C7.996 4.329 8.668 5 9.496 5H14.496C15.325 5 15.996 4.329 15.996 3.5C15.996 2.672 15.325 2 14.496 2Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.996 15H11.425M7.996 11H15.996"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.996 3.5C17.55 3.547 18.476 3.72 19.117 4.362C19.996 5.24 19.996 6.655 19.996 9.483L19.996 16C19.996 18.828 19.996 20.242 19.117 21.121C18.239 22 16.825 22 13.996 22L9.996 22C7.168 22 5.753 22 4.875 21.121C3.996 20.242 3.996 18.828 3.996 16L3.996 9.483C3.996 6.655 3.996 5.24 4.875 4.362C5.516 3.72 6.443 3.547 7.996 3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const BrainIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M12 4.5C12 3.119 10.881 2 9.5 2C8.119 2 7 3.119 7 4.5C5.343 4.5 4 5.843 4 7.5C4 8.069 4.158 8.6 4.433 9.053C3.047 9.318 2 10.537 2 12C2 13.463 3.047 14.681 4.433 14.946C4.158 15.399 4 15.931 4 16.5C4 18.157 5.343 19.5 7 19.5C7 20.881 8.119 22 9.5 22C10.881 22 12 20.881 12 19.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 19.5C12 20.881 13.119 22 14.5 22C15.881 22 17 20.881 17 19.5C18.657 19.5 20 18.157 20 16.5C20 15.931 19.842 15.399 19.567 14.946C20.953 14.681 22 13.463 22 12C22 10.537 20.953 9.318 19.567 9.053C19.842 8.6 20 8.069 20 7.5C20 5.843 18.657 4.5 17 4.5C17 3.119 15.881 2 14.5 2C13.119 2 12 3.119 12 4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10.487 7.001V8.98M7 10.501H9.052M15.023 10.501H17.075M15.023 13.475H17.075M7 13.475H9.052M10.487 15.02V16.999M13.512 15.02V16.999M13.502 7.001V8.98M10.052 14.968H14.023C14.575 14.968 15.023 14.521 15.023 13.968V9.98C15.023 9.428 14.575 8.98 14.023 8.98H10.052C9.5 8.98 9.052 9.428 9.052 9.98V13.968C9.052 14.521 9.5 14.968 10.052 14.968Z"
      strokeLinecap="round"
    />
  </Svg>
);

export const EditIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M16.425 4.605L17.415 3.615C18.235 2.795 19.565 2.795 20.385 3.615C21.205 4.435 21.205 5.765 20.385 6.585L19.395 7.575M16.425 4.605L9.766 11.264C9.258 11.772 8.898 12.408 8.724 13.104L8 16L10.896 15.276C11.592 15.102 12.228 14.742 12.736 14.234L19.395 7.575M16.425 4.605L19.395 7.575"
      strokeLinejoin="round"
    />
    <path
      d="M19 13.5C19 16.788 19 18.431 18.092 19.538C17.926 19.74 17.74 19.926 17.538 20.092C16.431 21 14.787 21 11.5 21H11C7.229 21 5.343 21 4.172 19.828C3 18.657 3 16.771 3 13V12.5C3 9.213 3 7.569 3.908 6.462C4.074 6.26 4.26 6.074 4.462 5.908C5.569 5 7.213 5 10.5 5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FolderSyncIcon = (props: IconProps) => (
  <Svg {...props}>
    <path
      d="M2.5 20V8.877C2.5 7.589 2.5 6.946 2.785 6.47C2.954 6.189 3.189 5.954 3.47 5.785C3.946 5.5 4.594 5.5 5.892 5.5C6.523 5.5 6.839 5.5 7.126 5.588C7.318 5.647 7.499 5.734 7.665 5.847C7.913 6.016 8.109 6.261 8.5 6.75C8.891 7.239 9.087 7.484 9.335 7.653C9.501 7.766 9.682 7.853 9.874 7.912C10.161 8 10.474 8 11.101 8H15C16.404 8 17.107 8 17.611 8.337C17.829 8.483 18.017 8.67 18.163 8.889C18.5 9.393 18.5 10.095 18.5 11.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M4.42 14.014L3.634 16.014C2.656 18.5 2.167 19.742 2.752 20.621C3.337 21.5 4.653 21.5 7.285 21.5H15.19C16.425 21.5 17.042 21.5 17.529 21.18C18.017 20.859 18.27 20.287 18.777 19.142L19.662 17.142C20.787 14.599 21.349 13.328 20.768 12.414C20.187 11.5 18.816 11.5 16.075 11.5H8.072C6.782 11.5 6.138 11.5 5.638 11.844C5.139 12.188 4.899 12.797 4.42 14.014Z" />
    <path
      d="M11.5 4.515C12.415 3.284 13.666 2.556 15.512 2.502C16.116 2.484 16.715 2.614 17.268 2.855C18.575 3.426 19.419 4.156 20 5.5L21.5 3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const PauseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4 7C4 5.586 4 4.879 4.439 4.439C4.879 4 5.586 4 7 4C8.414 4 9.121 4 9.561 4.439C10 4.879 10 5.586 10 7V17C10 18.414 10 19.121 9.561 19.561C9.121 20 8.414 20 7 20C5.586 20 4.879 20 4.439 19.561C4 19.121 4 18.414 4 17V7Z" />
    <path d="M14 7C14 5.586 14 4.879 14.439 4.439C14.879 4 15.586 4 17 4C18.414 4 19.121 4 19.561 4.439C20 4.879 20 5.586 20 7V17C20 18.414 20 19.121 19.561 19.561C19.121 20 18.414 20 17 20C15.586 20 14.879 20 14.439 19.561C14 19.121 14 18.414 14 17V7Z" />
  </Svg>
);

export const CircleIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="10" strokeLinejoin="round" />
  </Svg>
);

export const PlugIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15.5 2V6M8.5 6V2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.004 7.613C5.937 6.743 6.64 6 7.53 6H16.47C17.36 6 18.063 6.743 17.995 7.613L17.812 9.992C17.68 11.702 17.101 13.35 16.132 14.777L15.531 15.662C14.964 16.498 14.008 17 12.984 17H11.016C9.992 17 9.036 16.498 8.469 15.662L7.868 14.777C6.899 13.35 6.32 11.702 6.188 9.992L6.004 7.613Z" />
    <path d="M12 17V22" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11 9H13" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
