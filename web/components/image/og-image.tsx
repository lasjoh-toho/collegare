import React from "react";
import { promises as fs } from "fs";
import path from "path";

interface OgImageProps {
  title?: string;
  subtitle?: string;
}

const ORANGE = "#FF5900";
const LOGO_PATH = path.join(process.cwd(), "public", "logo.png");

let logoDataUri = "";
let logoLoaded = false;

async function getLogoDataUri() {
  if (logoLoaded) return logoDataUri;
  logoLoaded = true;
  try {
    const logoData = await fs.readFile(LOGO_PATH);
    logoDataUri = `data:image/png;base64,${logoData.toString("base64")}`;
  } catch {
    console.error("Failed to read logo.png");
  }
  return logoDataUri;
}

const docCards = [
  { letter: "W", label: "Word", bg: "linear-gradient(135deg, #2b579a 0%, #3b79d6 100%)" },
  { letter: "X", label: "Excel", bg: "linear-gradient(135deg, #217346 0%, #2ba362 100%)" },
  { letter: "P", label: "Slides", bg: "linear-gradient(135deg, #c43e1c 0%, #f05228 100%)" },
];

export const OgImage = async ({
  title,
  subtitle,
}: OgImageProps) => {
  const logoBase64 = await getLogoDataUri();
  const line1 = title || "Open & Edit Office Documents";
  const line2 = subtitle || "No upload · No server · Fully private";

  return (
    <div
      tw="flex w-full h-full"
      style={{
        background: "#0a0a0a",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow */}
      <div
        tw="absolute"
        style={{
          top: "-150px",
          right: "-100px",
          width: "700px",
          height: "700px",
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(255, 89, 0, 0.15) 0%, transparent 70%)`,
        }}
      />
      <div
        tw="absolute"
        style={{
          bottom: "-200px",
          left: "-150px",
          width: "600px",
          height: "600px",
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(255, 89, 0, 0.08) 0%, transparent 70%)`,
        }}
      />

      {/* Left content */}
      <div tw="flex flex-col justify-between flex-1 p-16" style={{ display: "flex" }}>
        {/* Top: logo + brand */}
        <div tw="flex items-center" style={{ display: "flex" }}>
          {logoBase64 ? (
            <img src={logoBase64} width="52" height="52" style={{ borderRadius: "14px" }} />
          ) : (
            <div
              tw="flex items-center justify-center"
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "14px",
                background: `linear-gradient(135deg, ${ORANGE} 0%, #FF8C40 100%)`,
              }}
            >
              <span tw="text-white text-3xl font-black">Z</span>
            </div>
          )}
          <span
            tw="ml-4 text-3xl font-bold text-white"
            style={{ letterSpacing: "-0.02em" }}
          >
            ZIZIYI Office
          </span>
        </div>

        {/* Center: headline */}
        <div tw="flex flex-col" style={{ display: "flex", marginTop: "-20px" }}>
          <div
            tw="text-white leading-none"
            style={{
              fontSize: "72px",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: "1.05",
            }}
          >
            {line1}
          </div>
          <div
            tw="flex items-center mt-6"
            style={{ display: "flex" }}
          >
            <div
              tw="h-1 mr-4"
              style={{
                width: "40px",
                background: ORANGE,
                borderRadius: "2px",
              }}
            />
            <span tw="text-2xl" style={{ color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
              {line2}
            </span>
          </div>
        </div>

        {/* Bottom: url */}
        <div tw="flex">
          <span tw="text-xl" style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>
            office.ziziyi.com
          </span>
        </div>
      </div>

      {/* Right: doc type cards */}
      <div
        tw="flex flex-col items-center justify-center pr-16"
        style={{ display: "flex", width: "320px", gap: "16px" }}
      >
        {docCards.map((card) => (
          <div
            key={card.letter}
            tw="flex items-center"
            style={{
              display: "flex",
              width: "240px",
              height: "100px",
              borderRadius: "20px",
              background: card.bg,
              padding: "0 28px",
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
            }}
          >
            <span
              tw="text-white"
              style={{
                fontSize: "48px",
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {card.letter}
            </span>
            <span
              tw="text-white ml-4"
              style={{
                fontSize: "22px",
                fontWeight: 600,
                opacity: 0.85,
              }}
            >
              {card.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
