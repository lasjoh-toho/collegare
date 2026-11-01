import { ImageResponse } from "next/og";
import { OgImage } from "@/components/image/og-image";
import { getOgFonts } from "@/utils/og";

export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt =
  "ZIZIYI Office - Free Online Word, Excel & PowerPoint Editor";

export default async function Image() {
  const image = await OgImage({});
  const fonts = await getOgFonts();

  return new ImageResponse(image, {
    ...size,
    fonts,
  });
}
