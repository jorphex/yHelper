/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import { chainLabel, formatPct } from "./format";

type RegimesPayload = {
  summary?: Array<{
    regime?: string | null;
    tvl_usd?: number | null;
    vaults?: number | null;
  }> | null;
};

type PreviewStats = {
  trackedTvlActiveUsd: number | null;
  highestApyVault: {
    name: string | null;
    chainId: number | null;
    tvlUsd: number | null;
    apy30d: number | null;
  } | null;
  regimeCounts: Array<{
    regime: string;
    vaults: number;
    tvlUsd: number | null;
  }>;
};

type SocialPreviewPayload = {
  summary?: {
    tracked_tvl_active_usd?: number | null;
    total_vaults?: number | null;
    active_vaults?: number | null;
  } | null;
  highest_apy_vault?: {
    name?: string | null;
    symbol?: string | null;
    chain_id?: number | null;
    tvl_usd?: number | null;
    safe_apy_30d?: number | null;
  } | null;
};
type PreviewFont = {
  name: string;
  data: ArrayBuffer;
  style?: "normal" | "italic";
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
};

const YEARN_LOGO_DATA_URI =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDI2LjQuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDYuMDAgQnVpbGQgMCkgIC0tPgo8c3ZnIHZlcnNpb249IjEuMSIgaWQ9IkxheWVyXzEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHg9IjBweCIgeT0iMHB4IgoJIHZpZXdCb3g9IjAgMCA5MjkuNyAyNTYuMSIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgOTI5LjcgMjU2LjE7IiB4bWw6c3BhY2U9InByZXNlcnZlIj4KPHN0eWxlIHR5cGU9InRleHQvY3NzIj4KCS5zdDB7ZmlsbDojRkZGRkZGO30KPC9zdHlsZT4KPGc+Cgk8cGF0aCBjbGFzcz0ic3QwIiBkPSJNODc2LjgsNDEuMWMtOS4zLDAtMTcuMSwxLjUtMjMuNCw0LjZjLTYuMywzLjEtMTEuNyw3LjQtMTYuMiwxMi44bC0zLjItMTZoLTMwLjd2MTI4LjJoMzUuMnYtNjUuNgoJCWMwLTExLjEsMi41LTE5LjgsNy41LTI1LjljNS02LjEsMTIuMS05LjIsMjEuMi05LjJjMTcuMywwLDI1LjksMTEuMSwyNS45LDMzLjJ2NjcuNmgzNS4ydi02OS42YzAtMjEuNC00LjgtMzYuOC0xNC41LTQ2LjEKCQlDOTA0LjEsNDUuOCw4OTEuNyw0MS4xLDg3Ni44LDQxLjEgTTc4My42LDQyLjZjLTkuNSwwLTE3LDEuNi0yMi43LDQuOWMtNS43LDMuMi0xMC40LDgtMTQuMiwxNC4zbC0zLjItMTkuMmgtMzEuOXYxMjguMmgzNS4yVjEwOAoJCWMwLTEwLjMsMi4zLTE4LjUsNy0yNC40YzQuNy02LDEyLTksMjEuOS05aDE0VjQyLjZINzgzLjZ6IE02MzAuOCwxNDYuOWMtNS44LDAtMTAuNC0xLjMtMTMuOC00Yy0zLjQtMi43LTUuMS02LjItNS4xLTEwLjcKCQljMC01LjMsMi05LjQsNi4xLTEyLjNjNC4xLTIuOSw5LjgtNC40LDE3LjEtNC40aDI1Ljd2Mi41Yy0wLjIsOC44LTIuOSwxNS44LTguMiwyMS4xQzY0Ny4yLDE0NC4zLDY0MCwxNDYuOSw2MzAuOCwxNDYuOQoJCSBNNjM4LjYsNDEuMWMtMTcuMywwLTMxLjIsMy42LTQxLjYsMTAuOGMtMTAuNSw3LjItMTYuMywxNy40LTE3LjUsMzAuNWgzMy45YzAuOC00LjgsMy40LTguNiw3LjYtMTEuNWM0LjItMi44LDkuNy00LjIsMTYuMy00LjIKCQljNy4xLDAsMTIuOCwxLjcsMTcuMSw1YzQuMiwzLjMsNi40LDcuOSw2LjQsMTMuN1Y5MmgtMjUuMmMtMTkuMywwLTM0LDMuNy00NCwxMWMtMTAuMSw3LjMtMTUuMSwxNy44LTE1LjEsMzEuNAoJCWMwLDEyLDQuMiwyMS4zLDEyLjYsMjcuOWM4LjQsNi43LDE5LjcsMTAsMzMuOCwxMGM4LjYsMCwxNi4xLTEuNSwyMi4zLTQuNWM2LjItMywxMS44LTcuNCwxNi42LTEzLjJsMi43LDE2LjJoMzAuOVY4Ny41CgkJYzAtMTUuMS00LjktMjYuNi0xNC44LTM0LjVDNjcwLjcsNDUuMSw2NTYuNyw0MS4xLDYzOC42LDQxLjEgTTQ3Miw5MS44YzEtNy41LDQuMS0xMy40LDkuNC0xNy44YzUuMi00LjQsMTEuNy02LjYsMTkuMy02LjYKCQljOCwwLDE0LjYsMi4xLDE5LjgsNi40YzUuMiw0LjIsOC40LDEwLjMsOS42LDE4LjFINDcyeiBNNDM0LjYsMTA3YzAsMTMuMSwyLjgsMjQuNiw4LjQsMzQuNWM1LjYsOS45LDEzLjUsMTcuNSwyMy45LDIyLjgKCQljMTAuNCw1LjMsMjIuNyw4LDM3LDhjMTEsMCwyMC43LTIsMjkuMi01LjljOC41LTMuOSwxNS4zLTkuMywyMC40LTE2LjFjNS4yLTYuOCw4LjQtMTQuNSw5LjctMjIuOWgtMzQuN2MtMS41LDYtNC42LDEwLjUtOS40LDEzLjYKCQljLTQuNywzLjEtMTAuNyw0LjYtMTcuOCw0LjZjLTksMC0xNi0yLjctMjEuMi04Yy01LjItNS4zLTguMS0xMi42LTktMjEuOXYtMWg5M2MwLjctMy41LDEtNy41LDEtMTJjLTAuMi0xMi41LTMtMjMuMy04LjYtMzIuNQoJCWMtNS42LTkuMi0xMy4zLTE2LjQtMjMuMi0yMS40Yy05LjktNS4xLTIxLjMtNy42LTM0LjMtNy42Yy0xMi44LDAtMjQuMSwyLjctMzMuOCw4LjFjLTkuNyw1LjQtMTcuMywxMy4xLTIyLjcsMjIuOQoJCUM0MzcuMyw4Mi4xLDQzNC42LDkzLjcsNDM0LjYsMTA3IE0zMDAuMiw0Mi42bDQ5LjQsMTI4LjlsLTMuMiw4LjVjLTEuOCw0LjMtMy43LDcuMi01LjcsOC43Yy0yLDEuNS01LjIsMi4yLTkuNywyLjJoLTE5LjV2MjkuNwoJCWgzNC4yYzYuNSwwLDExLjgtMS4xLDE1LjgtMy40YzQuMS0yLjIsNy40LTUuNiwxMC4xLTEwYzIuNy00LjQsNS41LTEwLjUsOC41LTE4LjNsNTYuOS0xNDYuNGgtMzcuN2wtMzAuNCw5MmwtMzEuMi05MkgzMDAuMnoiLz4KPC9nPgo8Zz4KCTxwYXRoIGNsYXNzPSJzdDAiIGQ9Ik0yMDEuOSw5OC41bC0zMi40LDMyLjRjMS44LDUuOSwyLjcsMTIuMiwyLjcsMTguNWMwLDE3LjEtNi43LDMzLjItMTguNyw0NS4zYy0xMi4xLDEyLjEtMjguMiwxOC43LTQ1LjMsMTguNwoJCXMtMzMuMi02LjctNDUuMy0xOC43Yy0xMi4xLTEyLjEtMTguNy0yOC4yLTE4LjctNDUuM2MwLTYuNCwwLjktMTIuNiwyLjctMTguNUwxNC40LDk4LjVjLTguMiwxNS4xLTEyLjksMzIuNS0xMi45LDUxCgkJYzAsNTguOSw0Ny44LDEwNi43LDEwNi43LDEwNi43czEwNi43LTQ3LjgsMTA2LjctMTA2LjdDMjE0LjksMTMxLDIxMC4yLDExMy42LDIwMS45LDk4LjV6Ii8+Cgk8cG9seWdvbiBjbGFzcz0ic3QwIiBwb2ludHM9Ijg2LjgsMTcwLjcgMTI5LjUsMTcwLjcgMTI5LjUsMTAyLjkgMjAyLjIsMzAuMiAxNzIsMCAxMDguMiw2My44IDQ0LjQsMCAxNC4yLDMwLjIgODYuOCwxMDIuOCAJIi8+CjwvZz4KPC9zdmc+Cg==";
function normalizeSiteUrl(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/+$/, "");
  return `https://${raw.replace(/\/+$/, "")}`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPctCompact(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return formatPct(value, digits);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function shortLabel(value: string | null | undefined, max = 28): string {
  if (!value) return "n/a";
  const text = value.trim();
  if (!text) return "n/a";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(3, max - 1))}…`;
}

function regimeLabel(value: string): string {
  const key = value.toLowerCase();
  if (key === "rising") return "Rising";
  if (key === "stable") return "Stable";
  if (key === "falling") return "Falling";
  if (key === "choppy") return "Choppy";
  return value;
}

async function fetchFromCandidates<T>(urls: string[]): Promise<T | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) continue;
      return (await response.json()) as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchPreviewStats(): Promise<PreviewStats> {
  const publicSite = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || "https://yhelper.app");
  const internalApiBase = (process.env.YHELPER_API_INTERNAL_URL || "http://yhelper-api:8000").replace(/\/+$/, "");
  const socialPayload = await fetchFromCandidates<SocialPreviewPayload>([
    `${internalApiBase}/api/meta/social-preview`,
    `${publicSite}/api/meta/social-preview`,
  ]);
  const regimesPayload = await fetchFromCandidates<RegimesPayload>([
    `${internalApiBase}/api/regimes?universe=raw&min_tvl_usd=0&min_points=0&limit=1`,
    `${publicSite}/api/regimes?universe=raw&min_tvl_usd=0&min_points=0&limit=1`,
  ]);
  const regimeRows = regimesPayload?.summary ?? [];
  const byRegime = new Map<string, { vaults: number; tvlUsd: number | null }>();
  for (const row of regimeRows) {
    const key = String(row?.regime ?? "unknown").toLowerCase();
    if (!key || key === "unknown") continue;
    byRegime.set(key, {
      vaults: Number(row?.vaults ?? 0),
      tvlUsd: row?.tvl_usd === null || row?.tvl_usd === undefined ? null : Number(row.tvl_usd),
    });
  }

  const regimeCounts = ["rising", "stable", "falling", "choppy"].map((key) => {
    const regime = byRegime.get(key);
    return {
      regime: regimeLabel(key),
      vaults: regime ? regime.vaults : 0,
      tvlUsd: regime ? regime.tvlUsd : null,
    };
  });

  const summary = socialPayload?.summary ?? {};
  const highest = socialPayload?.highest_apy_vault;
  return {
    trackedTvlActiveUsd: toFiniteNumber(summary.tracked_tvl_active_usd),
    highestApyVault: highest
      ? {
          name: (highest.name || highest.symbol || null) as string | null,
          chainId: toFiniteNumber(highest.chain_id),
          tvlUsd: toFiniteNumber(highest.tvl_usd),
          apy30d: toFiniteNumber(highest.safe_apy_30d),
        }
      : null,
    regimeCounts,
  };
}

export async function renderSocialPreviewImage({
  width,
  height,
  fonts,
}: {
  width: number;
  height: number;
  fonts?: PreviewFont[];
}) {
  const yearnLogoSrc = YEARN_LOGO_DATA_URI;
  const stats = await fetchPreviewStats();
  const regimeCards = stats.regimeCounts.length > 0
    ? stats.regimeCounts
    : [
        { regime: "Rising", vaults: 0, tvlUsd: null },
        { regime: "Stable", vaults: 0, tvlUsd: null },
        { regime: "Falling", vaults: 0, tvlUsd: null },
        { regime: "Choppy", vaults: 0, tvlUsd: null },
      ];
  const topCards = [
    {
      key: "tracked-tvl",
      label: "Tracked TVL",
      value: formatUsdCompact(stats.trackedTvlActiveUsd),
    },
    {
      key: "highest-apy",
      label: "Highest APY Vault",
      value: shortLabel(stats.highestApyVault?.name ?? null, 24),
      note: stats.highestApyVault
        ? `${chainLabel(stats.highestApyVault.chainId)} • APY ${formatPctCompact(stats.highestApyVault.apy30d, 1)} • TVL ${formatUsdCompact(stats.highestApyVault.tvlUsd)}`
        : "No active vault with APY metrics.",
    },
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          color: "#f4f8ff",
          fontFamily: "Aeonik, Inter, system-ui, sans-serif",
          background:
            "linear-gradient(150deg, #060c1f 0%, #10285a 30%, #281081 56%, #102a72 77%, #09235a 100%)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "-120px auto auto -180px",
            width: 760,
            height: 620,
            opacity: 0.44,
            background:
              "radial-gradient(closest-side, rgba(80,95,255,0.62) 0%, rgba(80,95,255,0.12) 48%, rgba(80,95,255,0) 76%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "auto -220px -120px auto",
            width: 700,
            height: 500,
            opacity: 0.34,
            background:
              "radial-gradient(closest-side, rgba(58,174,195,0.52) 0%, rgba(58,174,195,0.1) 42%, rgba(58,174,195,0) 74%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.12,
            background:
              "radial-gradient(100% 85% at 68% 22%, rgba(78,114,255,0.24) 0%, rgba(78,114,255,0.06) 42%, rgba(78,114,255,0) 74%), radial-gradient(75% 80% at 84% 54%, rgba(61,153,189,0.2) 0%, rgba(61,153,189,0.05) 38%, rgba(61,153,189,0) 71%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.2)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.1,
            background:
              "radial-gradient(120% 100% at 18% 22%, rgba(95,130,255,0.18) 0%, rgba(95,130,255,0) 58%), radial-gradient(95% 85% at 84% 46%, rgba(89,80,246,0.2) 0%, rgba(89,80,246,0) 61%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.12,
            background:
              "radial-gradient(120% 95% at 50% 48%, rgba(0,0,0,0) 56%, rgba(0,0,0,0.48) 100%), linear-gradient(17deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 9%, rgba(0,0,0,0) 34%, rgba(255,255,255,0.03) 55%, rgba(0,0,0,0) 76%, rgba(255,255,255,0.02) 100%)",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "46px 56px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 22 }}>
              <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>yHelper</div>
              <img
                src={yearnLogoSrc}
                alt="Yearn"
                width={180}
                height={52}
                style={{ objectFit: "contain", opacity: 0.95 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <div style={{ fontSize: 27, color: "#d5e6ff", maxWidth: 960 }}>
                Track yield shifts, spot vault trends, and find your next move.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12 }}>
              {topCards.map((item) => (
                <StatCard key={item.key} label={item.label} value={item.value} note={item.note} featured />
              ))}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {regimeCards.map((item) => (
                <StatCard
                  key={`regime-${item.regime}`}
                  label={item.regime}
                  value={compactNumber(item.vaults)}
                  note={`TVL ${formatUsdCompact(item.tvlUsd)}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      fonts,
      headers: {
        "cache-control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}

function StatCard({
  label,
  value,
  note,
  featured = false,
}: {
  label: string;
  value: string;
  note?: string;
  featured?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: featured ? 8 : 6,
        minHeight: featured ? 188 : 168,
        borderRadius: featured ? 16 : 14,
        border: featured ? "1px solid rgba(146,190,255,0.5)" : "1px solid rgba(122,170,255,0.34)",
        background: featured
          ? "linear-gradient(180deg, rgba(26,54,106,0.86) 0%, rgba(10,24,52,0.94) 100%)"
          : "linear-gradient(180deg, rgba(18,40,79,0.82) 0%, rgba(9,20,41,0.92) 100%)",
        padding: featured ? "16px 18px" : "15px 16px",
      }}
    >
      <div
        style={{
          fontSize: featured ? 29 : 24,
          color: featured ? "#dcecff" : "#b9d4fb",
          textTransform: "none",
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: featured ? 58 : 40,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1,
          color: featured ? "#f7fbff" : "#f4f8ff",
        }}
      >
        {value}
      </div>
      {note ? (
        <div
          style={{
            fontSize: featured ? 24 : 22,
            color: featured ? "#deebff" : "#cfe0ff",
            letterSpacing: "0.01em",
            lineHeight: 1.1,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
