import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge<"typography">({
  extend: {
    classGroups: {
      typography: [
        {
          type: [
            "display",
            "title",
            "heading",
            "body",
            "label",
            "caption",
            "micro",
            "mono",
          ],
        },
      ],
    },
    theme: {
      leading: ["xs", "sm", "md", "lg", "chat", "xl", "2xl"],
      radius: ["xs", "sm", "md", "lg", "xl", "2xl", "full"],
      shadow: ["button", "sm", "md", "lg", "focus"],
      spacing: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"],
      text: ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"],
    },
  },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
