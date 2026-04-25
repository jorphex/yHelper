"use client";

import type { CSSProperties } from "react";

/**
 * Skeleton loading component with shimmer animation
 * Editorial design system styling
 */

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  variant?: "default" | "card" | "text" | "circle" | "table-row";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = "",
  style = {},
  variant = "default",
  width,
  height,
}: SkeletonProps) {
  const baseStyles: CSSProperties = {
    background: "linear-gradient(90deg, #111111 25%, rgba(255,255,255,0.03) 50%, #111111 75%)",
    backgroundSize: "200% 100%",
    animation: "skeleton-shimmer 1.5s ease-in-out infinite",
    borderRadius: variant === "circle" ? "50%" : variant === "card" ? "12px" : "4px",
    ...style,
  };

  if (width) baseStyles.width = typeof width === "number" ? `${width}px` : width;
  if (height) baseStyles.height = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={`skeleton ${className}`}
      style={baseStyles}
      aria-hidden="true"
    />
  );
}

/**
 * KPI Card Skeleton
 */
export function KpiCardSkeleton() {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-5)",
        minHeight: "100px",
      }}
    >
      <Skeleton
        width="60%"
        height={10}
        style={{ marginBottom: "12px", borderRadius: "2px" }}
      />
      <Skeleton
        width="50%"
        height={28}
        style={{ marginBottom: "8px", borderRadius: "4px" }}
      />
      <Skeleton
        width="40%"
        height={10}
        style={{ borderRadius: "2px" }}
      />
    </div>
  );
}

/**
 * KPI Grid Skeleton
 */
interface KpiGridSkeletonProps {
  count?: number;
}

export function KpiGridSkeleton({ count = 4 }: KpiGridSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </>
  );
}

/**
 * Table Skeleton
 */
interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 6 }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx}>
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} style={{ padding: "12px 16px" }}>
              <Skeleton
                width={colIdx === 0 ? "80%" : colIdx === columns - 1 ? "60%" : "70%"}
                height={12}
                style={{ borderRadius: "2px" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
