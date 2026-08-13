import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageSocialMetadata } from "../lib/page-social-metadata";

export const metadata: Metadata = {
  title: "Markets",
  description: "Find consequential realized-yield changes across comparable Yearn vaults.",
  ...pageSocialMetadata("markets"),
};

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return children;
}
