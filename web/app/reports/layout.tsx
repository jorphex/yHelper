import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reports",
  description: "Recent Yearn vault reports, plus yCRV and yYB reward history.",
};

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return children;
}
