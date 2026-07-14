import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Explore",
  description: "Understand Yearn vault structure, screen vaults, and compare like assets.",
};

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}
