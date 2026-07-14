import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "stYFI",
  description: "Track stYFI participation, rewards, and epochs.",
};

export default function StyfiLayout({ children }: { children: ReactNode }) {
  return children;
}
