import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageSocialMetadata } from "../lib/page-social-metadata";
import { flexCopy } from "./copy";

export const metadata: Metadata = {
  title: flexCopy.metadata.title,
  description: flexCopy.metadata.description,
  ...pageSocialMetadata("flex"),
};

export default function FlexLayout({ children }: { children: ReactNode }) {
  return children;
}
