import { Suspense } from "react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageSocialMetadata } from "../lib/page-social-metadata";
import { MarketsTabPreloader } from "./tab-preloader";

export const metadata: Metadata = {
  title: "Vault research",
  description: "Find a Yearn vault, compare yields, and explore changes and composition.",
  ...pageSocialMetadata("markets"),
};

export default function MarketsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <MarketsTabPreloader />
      </Suspense>
      {children}
    </>
  );
}
