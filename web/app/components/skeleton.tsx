import type { CSSProperties } from "react";

function Skeleton({ width, height, style }: { width: string; height: number; style: CSSProperties }) {
  return <div className="skeleton" style={{ ...style, width, height }} aria-hidden="true" />;
}

function KpiCardSkeleton() {
  return (
    <div
      style={{
        background: "transparent",
        border: 0,
        borderRadius: 0,
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

export function KpiGridSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </>
  );
}

export function TableSkeleton({ rows, columns }: { rows: number; columns: number }) {
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
