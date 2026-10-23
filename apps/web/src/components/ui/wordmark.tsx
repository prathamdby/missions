import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * "MISSIONS" in the ANSI Shadow figlet face, as Paper draws it: solid blocks
 * for the letter faces and box-drawing glyphs for the shadow. One cell is a
 * Geist Mono glyph at 12px plus 0.3px tracking, which is 7.5px wide.
 * Numbers are runs of filled cells, negative numbers runs of empty cells.
 */
const ROWS: readonly (readonly (number | string)[])[] = [
  [
    3,
    "╗",
    -3,
    3,
    "╗",
    2,
    "╗",
    7,
    "╗",
    7,
    "╗",
    2,
    "╗",
    -1,
    6,
    "╗",
    -1,
    3,
    "╗",
    -3,
    2,
    "╗",
    7,
    "╗",
  ],
  [
    4,
    "╗",
    -1,
    4,
    "║",
    2,
    "║",
    2,
    "╔════╝",
    2,
    "╔════╝",
    2,
    "║",
    2,
    "╔═══",
    2,
    "╗",
    4,
    "╗",
    -2,
    2,
    "║",
    2,
    "╔════╝",
  ],
  [
    2,
    "╔",
    4,
    "╔",
    2,
    "║",
    2,
    "║",
    7,
    "╗",
    7,
    "╗",
    2,
    "║",
    2,
    "║",
    -3,
    2,
    "║",
    2,
    "╔",
    2,
    "╗",
    -1,
    2,
    "║",
    7,
    "╗",
  ],
  [
    2,
    "║╚",
    2,
    "╔╝",
    2,
    "║",
    2,
    "║╚════",
    2,
    "║╚════",
    2,
    "║",
    2,
    "║",
    2,
    "║",
    -3,
    2,
    "║",
    2,
    "║╚",
    2,
    "╗",
    2,
    "║╚════",
    2,
    "║",
  ],
  [
    2,
    "║",
    -1,
    "╚═╝",
    -1,
    2,
    "║",
    2,
    "║",
    7,
    "║",
    7,
    "║",
    2,
    "║╚",
    6,
    "╔╝",
    2,
    "║",
    -1,
    "╚",
    4,
    "║",
    7,
    "║",
  ],
  [
    "╚═╝",
    -5,
    "╚═╝╚═╝╚══════╝╚══════╝╚═╝",
    -1,
    "╚═════╝",
    -1,
    "╚═╝",
    -2,
    "╚═══╝╚══════╝",
  ],
];

const cellVariants = cva("h-[13px] shrink-0", {
  variants: {
    row: {
      0: "bg-text",
      1: "bg-logo-fill-2",
      2: "bg-logo-fill-3",
      3: "bg-logo-fill-4",
      4: "bg-logo-fill-5",
      5: "",
    },
    width: {
      1: "w-[7.5px]",
      2: "w-[15px]",
      3: "w-[22.5px]",
      4: "w-[30px]",
      5: "w-[37.5px]",
      6: "w-[45px]",
      7: "w-[52.5px]",
    },
  },
});

type RowIndex = 0 | 1 | 2 | 3 | 4 | 5;
type CellWidth = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Segment {
  fill: boolean;
  id: string;
  text: string | null;
  width: CellWidth;
}

const toWidth = (value: number): CellWidth =>
  Math.min(Math.max(Math.abs(value), 1), 7) as CellWidth;

const SEGMENTS: readonly (readonly Segment[])[] = ROWS.map((row, rowIndex) =>
  row.map((item, itemIndex) => ({
    fill: typeof item === "number" && item > 0,
    id: `${rowIndex}:${itemIndex}`,
    text: typeof item === "string" ? item : null,
    width: typeof item === "number" ? toWidth(item) : 1,
  }))
);

const ROW_IDS = ["face-1", "face-2", "face-3", "face-4", "face-5", "base"];

/** M5Q, LFE: the ASCII "MISSIONS" mark above the new-mission composer. `responsive` shrinks it to two thirds on touch screens (YL0). */
export const Wordmark = ({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "responsive";
}) => (
  <div
    aria-hidden="true"
    className={cn(
      "flex shrink-0 flex-col items-start",
      size === "responsive" && "max-md:[zoom:0.667]",
      className
    )}
  >
    {SEGMENTS.map((segments, rowIndex) => (
      <div className="flex h-[13px] shrink-0" key={ROW_IDS[rowIndex]}>
        {segments.map((segment) =>
          segment.text === null ? (
            <span
              className={cellVariants({
                row: segment.fill ? (rowIndex as RowIndex) : 5,
                width: segment.width,
              })}
              key={segment.id}
            />
          ) : (
            <span
              className="h-[13px] shrink-0 font-mono text-xs leading-[13px] tracking-[0.3px] whitespace-pre text-logo-shade"
              key={segment.id}
            >
              {segment.text}
            </span>
          )
        )}
      </div>
    ))}
  </div>
);

/** The 16px accent square that stands for Missions in the sidebar and drawer. */
export const LogoMark = () => (
  <span
    aria-hidden="true"
    className="size-4 shrink-0 rounded-[5px] bg-accent"
  />
);
