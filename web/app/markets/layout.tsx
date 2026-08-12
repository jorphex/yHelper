import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Markets",
  description: "Find consequential realized-yield changes across comparable Yearn vaults.",
};

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return children;
}
