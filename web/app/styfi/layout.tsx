import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageSocialMetadata } from "../lib/page-social-metadata";

export const metadata: Metadata = {
  title: "stYFI",
  description: "Track stYFI participation, rewards, and epochs.",
  ...pageSocialMetadata("styfi"),
};

export default function StyfiLayout({ children }: { children: ReactNode }) {
  return children;
}
