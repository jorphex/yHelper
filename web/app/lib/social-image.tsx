import { renderPageSocialImage } from "./page-social-image";

export const alt = "yHelper: Understand Yearn rewards, lending, and vault activity";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function renderSocialImage() {
  return renderPageSocialImage("overview");
}
