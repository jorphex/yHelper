export type BarDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
};

export type MeterSegmentDatum = {
  id: string;
  label: string;
  value: number | null | undefined;
  note?: string;
  tone?: "primary" | "positive" | "warning" | "muted";
};

export type ScatterPoint = {
  id: string;
  x: number | null | undefined;
  y: number | null | undefined;
  size?: number | null | undefined;
  href?: string;
  tooltip?: string;
  label?: string;
  tone?: "positive" | "negative" | "neutral";
};

export type TrendStripDatum = {
  id: string;
  label: string;
  points: Array<number | null | undefined>;
  note?: string;
  startLabel?: string;
  endLabel?: string;
  deltaLabel?: string;
};
