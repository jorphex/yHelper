"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { queryClient } from "./lib/query-client";

const HOME_HERO_SRC = "/home-assets-yearn-blender/hero-yearn-blender-coins.png";
const STYFI_HERO_SRC = "/styfi-assets-blender/hero-styfi-blender-coin-tilt-left.png";

function warmImage(src: string) {
  if (typeof window === "undefined") return;
  const image = new window.Image();
  image.decoding = "async";
  image.src = src;
}

function GlobalPrefetch() {
  const router = useRouter();

  useEffect(() => {
    const idle = window.setTimeout(() => {
      for (const href of ["/", "/markets", "/reports", "/styfi"]) router.prefetch(href);
      warmImage(HOME_HERO_SRC);
      warmImage(STYFI_HERO_SRC);
    }, 250);

    return () => window.clearTimeout(idle);
  }, [router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalPrefetch />
      {children}
    </QueryClientProvider>
  );
}
