import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Momentum",
  description: "Follow changes in realized yield across comparable Yearn vaults.",
};

export default function MomentumLayout({ children }: { children: ReactNode }) {
  return children;
}
