import type { CSSProperties } from "react";

/**
 * Skeleton loading component with shimmer animation
 * Used to show loading state while data is being fetched
 */

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  variant?: "default" | "card" | "text" | "circle" | "table-row";
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}

export function Skeleton({
  className = "",
  style = {},
  variant = "default",
  width,
  height,
  borderRadius,
}: SkeletonProps) {
  const baseStyles: CSSProperties = {
    background: "linear-gradient(90deg, var(--surface-secondary) 25%, var(--surface-primary) 50%, var(--surface-secondary) 75%)",
    backgroundSize: "200% 100%",
    animation: "skeleton-shimmer 1.5s ease-in-out infinite",
    ...style,
  };

  if (width) baseStyles.width = typeof width === "number" ? `${width}px` : width;
  if (height) baseStyles.height = typeof height === "number" ? `${height}px` : height;
  if (borderRadius) baseStyles.borderRadius = borderRadius;

  const variantClasses = {
    default: "",
    card: "rounded-lg",
    text: "rounded-md",
    circle: "rounded-full",
    "table-row": "rounded-none w-full h-12",
  };

  return (
    <div
      className={`skeleton ${variantClasses[variant]} ${className}`}
      style={baseStyles}
      aria-hidden="true"
    />
  );
}

/**
 * KPI Card Skeleton - matches KPI card dimensions exactly
 */
export function KpiCardSkeleton() {
  return (
    <div
      className="kpi-card skeleton-card"
      style={{
        background: "var(--surface-secondary)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
        minHeight: "100px",
      }}
    >
      <Skeleton
        variant="text"
        width="60%"
        height={12}
        style={{ marginBottom: "var(--space-3)" }}
      />
      <Skeleton
        variant="text"
        width="80%"
        height={28}
        style={{ marginBottom: "var(--space-2)" }}
      />
      <Skeleton
        variant="text"
        width="40%"
        height={12}
      />
    </div>
  );
}

/**
 * KPI Grid Skeleton - renders multiple KPI card skeletons
 */
interface KpiGridSkeletonProps {
  count?: number;
  columns?: number;
}

export function KpiGridSkeleton({ count = 8, columns = 4 }: KpiGridSkeletonProps) {
  return (
    <div
      className="kpi-grid-skeleton"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "var(--space-3)",
        marginBottom: "var(--space-5)",
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Table Row Skeleton
 */
export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div
      className="table-row-skeleton"
      style={{
        display: "flex",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        borderBottom: "1px solid var(--border-subtle)",
        alignItems: "center",
      }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          width={`${Math.random() * 40 + 40}%`}
          height={16}
          style={{ flex: 1 }}
        />
      ))}
    </div>
  );
}

/**
 * Table Skeleton - complete table placeholder
 */
interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}

export function TableSkeleton({ rows = 8, columns = 6, showHeader = true }: TableSkeletonProps) {
  return (
    <div
      className="table-skeleton"
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "var(--surface-primary)",
      }}
    >
      {showHeader && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            background: "var(--surface-secondary)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton
              key={i}
              variant="text"
              width={60}
              height={12}
              style={{ flex: 1 }}
            />
          ))}
        </div>
      )}
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} columns={columns} />
        ))}
      </div>
    </div>
  );
}

/**
 * Card Skeleton - for generic card loading states
 */
export function CardSkeleton({ children, className = "", style }: { children?: React.ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`card skeleton-card ${className}`}
      style={{
        background: "var(--surface-primary)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-6)",
        ...style,
      }}
    >
      {children || (
        <>
          <Skeleton
            variant="text"
            width="40%"
            height={24}
            style={{ marginBottom: "var(--space-4)" }}
          />
          <Skeleton
            variant="text"
            width="100%"
            height={16}
            style={{ marginBottom: "var(--space-2)" }}
          />
          <Skeleton
            variant="text"
            width="80%"
            height={16}
          />
        </>
      )}
    </div>
  );
}

/**
 * Bar List Skeleton
 */
export function BarListSkeleton({ items = 5 }: { items?: number }) {
  return (
    <div className="bar-list-skeleton" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <Skeleton variant="text" width={80} height={14} />
          <div style={{ flex: 1, height: 8, background: "var(--surface-secondary)", borderRadius: 4, overflow: "hidden" }}>
            <Skeleton
              width={`${Math.random() * 60 + 20}%`}
              height="100%"
              borderRadius="4px"
            />
          </div>
          <Skeleton variant="text" width={60} height={14} />
        </div>
      ))}
    </div>
  );
}

/**
 * Scatter Plot Skeleton
 */
export function ScatterPlotSkeleton() {
  return (
    <div
      className="scatter-plot-skeleton"
      style={{
        aspectRatio: "16/10",
        background: "var(--surface-secondary)",
        borderRadius: "var(--radius-lg)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Grid lines */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.1 }}>
        <div style={{ position: "absolute", left: "25%", top: 0, bottom: 0, width: 1, background: "var(--ink)" }} />
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--ink)" }} />
        <div style={{ position: "absolute", left: "75%", top: 0, bottom: 0, width: 1, background: "var(--ink)" }} />
        <div style={{ position: "absolute", top: "25%", left: 0, right: 0, height: 1, background: "var(--ink)" }} />
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "var(--ink)" }} />
        <div style={{ position: "absolute", top: "75%", left: 0, right: 0, height: 1, background: "var(--ink)" }} />
      </div>
      {/* Scatter points */}
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton
          key={i}
          variant="circle"
          width={Math.random() * 8 + 6}
          height={Math.random() * 8 + 6}
          style={{
            position: "absolute",
            left: `${Math.random() * 70 + 15}%`,
            top: `${Math.random() * 70 + 15}%`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Page Loading State - Full page skeleton layout
 */
export function PageSkeleton({ type }: { type: "discover" | "changes" | "assets" | "composition" | "regimes" | "chains" | "styfi" | "home" }) {
  switch (type) {
    case "home":
      return (
        <div className="page-skeleton" style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <CardSkeleton style={{ minHeight: 400 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <KpiCardSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    case "discover":
    case "changes":
    case "assets":
    case "composition":
    case "regimes":
    case "chains":
    case "styfi":
      return (
        <div className="page-skeleton" style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <CardSkeleton />
          <KpiGridSkeleton count={8} columns={4} />
          <TableSkeleton rows={8} columns={6} />
        </div>
      );
    default:
      return <CardSkeleton />;
  }
}
