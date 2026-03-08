import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSocialPreviewImage } from "./lib/social-preview";
import { SOCIAL_IMAGE_VERSION } from "./lib/social-image-version";

export const alt = `yHelper dashboard preview ${SOCIAL_IMAGE_VERSION}`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";
export const revalidate = 0;

export default async function OpenGraphImage() {
  const [aeonikRegular, aeonikBold, bgTexture] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/yearn/Aeonik-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/yearn/Aeonik-Bold.ttf")),
    readFile(join(process.cwd(), "public/bg/grit-abstract-v1.jpg")),
  ]);
  const backgroundTextureSrc = `data:image/jpeg;base64,${bgTexture.toString("base64")}`;
  return renderSocialPreviewImage({
    ...size,
    fonts: [
      { name: "Aeonik", data: aeonikRegular, style: "normal", weight: 400 },
      { name: "Aeonik", data: aeonikBold, style: "normal", weight: 700 },
    ],
    backgroundTextureSrc,
  });
}
