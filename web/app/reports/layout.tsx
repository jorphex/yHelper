import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageSocialMetadata } from "../lib/page-social-metadata";

export const metadata: Metadata = {
  title: "Reports",
  description: "Recent Yearn vault reports, plus yCRV and yYB reward history.",
  ...pageSocialMetadata("reports"),
};

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return children;
}
