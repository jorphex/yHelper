import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Explore",
  description: "Browse Yearn vaults and inspect their structure.",
};

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}
