import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reports",
  description: "Verify recent Yearn vault strategy accounting reports.",
};

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return children;
}
