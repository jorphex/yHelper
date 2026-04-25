"use client";

import { useId } from "react";

type DataPoint = {
  x: string;
  y: number;
};

type MiniLineChartProps = {
  data: DataPoint[];
  color?: string;
  height?: number;
  width?: number | string;
  strokeWidth?: number;
};

export function MiniLineChart({
  data,
  color = "var(--accent, #0657E9)",
  height = 60,
  width = 200,
  strokeWidth = 2,
}: MiniLineChartProps) {
  const gradientId = useId().replace(/:/g, "");
  if (!data || data.length < 2) return null;

  const values = data.map((d) => d.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Add padding
  const padding = { top: 4, right: 4, bottom: 4, left: 4 };
  const numericWidth = typeof width === "string" ? 300 : width;
  const chartWidth = numericWidth - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const getX = (index: number) =>
    padding.left + (index / (data.length - 1)) * chartWidth;
  const getY = (value: number) =>
    padding.top + chartHeight - ((value - min) / range) * chartHeight;

  // Build path
  let path = "";
  data.forEach((point, i) => {
    const x = getX(i);
    const y = getY(point.y);
    if (i === 0) {
      path += `M ${x} ${y}`;
    } else {
      path += ` L ${x} ${y}`;
    }
  });

  // Create area path for gradient fill
  const areaPath =
    path +
    ` L ${getX(data.length - 1)} ${height - padding.bottom}` +
    ` L ${padding.left} ${height - padding.bottom} Z`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${numericWidth} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: typeof width === "string" ? width : `${width}px`, height: `${height}px` }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
        stroke="none"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
