import type { Metadata } from "next";
import { pageSocialCopy, PageSocialSurface } from "./page-social-image";

export function pageSocialMetadata(surface: PageSocialSurface): Pick<Metadata, "openGraph" | "twitter"> {
  const copy = pageSocialCopy[surface];
  const image = `/og/${surface}`;
  return {
    openGraph: {
      title: copy.label,
      description: copy.promise,
      images: [{ url: image, width: 1200, height: 630, alt: `${copy.label} · yHelper` }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.label,
      description: copy.promise,
      images: [image],
    },
  };
}
