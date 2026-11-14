"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface DoubleChevronProps {
  index: number;
  dotColor?: string;
  size?: "default" | "lg" | "xl";
}

const DoubleChevron: React.FC<DoubleChevronProps> = ({
  index,
  dotColor = "#0f0f0f",
  size = "lg",
}) => {
  const base = index * 0.12;
  const dots = [
    { cx: 2, cy: 2, d: 0 },
    { cx: 5, cy: 5, d: 0.05 },
    { cx: 8, cy: 8, d: 0.1 },
    { cx: 5, cy: 11, d: 0.15 },
    { cx: 2, cy: 14, d: 0.2 },
    { cx: 6, cy: 2, d: 0.05 },
    { cx: 9, cy: 5, d: 0.1 },
    { cx: 12, cy: 8, d: 0.15 },
    { cx: 9, cy: 11, d: 0.2 },
    { cx: 6, cy: 14, d: 0.25 },
  ];

  const scale = size === "xl" ? "scale-125" : size === "lg" ? "scale-115" : "scale-100";

  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0 overflow-visible transition-transform", scale)}
    >
      <g fill={dotColor}>
        {dots.map((p, i) => (
          <circle
            key={i}
            cx={p.cx}
            cy={p.cy}
            r="1.15"
            className="bd-dot"
            style={{ animationDelay: `${base + p.d}s` }}
          />
        ))}
      </g>
    </svg>
  );
};

export interface AntiMetalButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  accentFrom?: string;
  accentTo?: string;
  dotColor?: string;
  size?: "default" | "lg" | "xl";
}

export const AntiMetalButton = React.forwardRef<
  HTMLButtonElement,
  AntiMetalButtonProps
>(
  (
    {
      className,
      children,
      label,
      accentFrom = "#2dd4e6",
      accentTo = "#0284c7",
      dotColor = "#040814",
      size = "lg",
      ...props
    },
    ref
  ) => {
    const content = label ?? children ?? "Book a demo";

    const sizeStyles = {
      default: {
        btn: "h-12 w-52",
        text: "text-[14px] right-4",
        pill: "inset-y-1.5 left-1.5 w-10 pl-3 pr-2.5 group-hover/btn:w-[calc(100%-0.75rem)] rounded-lg",
      },
      lg: {
        btn: "h-14 w-64",
        text: "text-[15px] sm:text-base right-6",
        pill: "inset-y-1.5 left-1.5 w-12 pl-3.5 pr-3 group-hover/btn:w-[calc(100%-0.75rem)] rounded-xl",
      },
      xl: {
        btn: "h-16 w-72",
        text: "text-base sm:text-lg right-7",
        pill: "inset-y-2 left-2 w-14 pl-4 pr-3.5 group-hover/btn:w-[calc(100%-1rem)] rounded-xl",
      },
    }[size];

    return (
      <button
        ref={ref}
        className={cn(
          "group/btn relative inline-flex select-none items-center overflow-hidden rounded-2xl transition-all duration-300 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2dd4e6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030509]",
          "bg-[linear-gradient(180deg,#15202d_0%,#091018_100%)]",
          "border border-[#2dd4e6]/35 hover:border-[#2dd4e6]/80",
          "shadow-[inset_0_1px_1px_rgba(255,255,255,0.22),0_0_18px_rgba(45,212,230,0.15),0_6px_18px_rgba(0,0,0,0.5)]",
          "hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_0_32px_rgba(45,212,230,0.38),0_8px_24px_rgba(0,0,0,0.6)]",
          sizeStyles.btn,
          className
        )}
        {...props}
      >
        <style>{`
          @keyframes bd-dot-wave {
            0%, 70%, 100% { opacity: 0.25; transform: scale(0.85); }
            35% { opacity: 1; transform: scale(1); }
          }
          .bd-dot {
            transform-box: fill-box;
            transform-origin: center;
            animation: bd-dot-wave 1.4s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .bd-dot { animation: none; opacity: 1; }
          }
        `}</style>

        <span
          className={cn(
            "absolute inset-y-0 z-20 flex items-center font-semibold tracking-tight text-[#e6edf5] select-none pointer-events-none transition-all duration-200 group-hover/btn:opacity-0 group-hover/btn:translate-x-1.5",
            sizeStyles.text
          )}
        >
          {content}
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "absolute z-10 flex items-center justify-start gap-3 overflow-hidden transition-[width,gap] duration-300 ease-[cubic-bezier(0.65,0,0.35,1)]",
            sizeStyles.pill
          )}
          style={{
            background: `linear-gradient(180deg, ${accentFrom} 0%, ${accentTo} 100%)`,
            boxShadow:
              "inset 0 1px 1px rgba(255,255,255,0.7), inset 0 -2px 4px rgba(0,0,0,0.18), 0 0 16px rgba(45,212,230,0.5), 0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          <DoubleChevron index={0} dotColor={dotColor} size={size} />
          <DoubleChevron index={1} dotColor={dotColor} size={size} />
          <DoubleChevron index={2} dotColor={dotColor} size={size} />
          <DoubleChevron index={3} dotColor={dotColor} size={size} />
          <DoubleChevron index={4} dotColor={dotColor} size={size} />
          <DoubleChevron index={5} dotColor={dotColor} size={size} />
        </span>
      </button>
    );
  }
);

AntiMetalButton.displayName = "AntiMetalButton";

export default AntiMetalButton;

