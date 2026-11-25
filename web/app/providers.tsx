"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { queryClient } from "./lib/query-client";

const HOME_HERO_SRC = "/home-assets-yearn-blender/hero-yearn-blender-coins.png";
const STYFI_HERO_SRC = "/styfi-assets-blender/hero-styfi-blender-coin-tilt-left.png";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const idle = window.setTimeout(() => {
      for (const href of ["/", "/markets", "/reports", "/styfi"]) router.prefetch(href);
      for (const src of [HOME_HERO_SRC, STYFI_HERO_SRC]) {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
      }
    }, 250);

    return () => window.clearTimeout(idle);
  }, [router]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
