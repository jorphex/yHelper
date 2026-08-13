import { ImageResponse } from "next/og";
import { SocialImageFrame, socialImageAssets, socialImageFonts, socialImageSize } from "./social-image-frame";

export type YlockerCycleImageData = {
  product_label: string;
  native_week: number;
  cycle_start: string;
  cycle_end: string;
  event_count: number;
  reward_shares: number;
  value_crvusd_at_deposit: number;
};

const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const shares = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function renderYlockerCycleImage(cycle: YlockerCycleImageData) {
  const assets = await socialImageAssets();
  const hasDeposits = cycle.event_count > 0;
  return new ImageResponse(
    <SocialImageFrame assets={assets}>
      <div style={{ position: "relative", display: "flex", flex: 1, margin: "0 56px", borderTop: "1px solid rgba(255,255,255,.16)" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 520, justifyContent: "center", padding: "34px 48px 34px 0" }}>
          <div style={{ display: "flex", color: "#9b958c", fontSize: 26, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>{cycle.product_label} · Week {cycle.native_week}</div>
          <div style={{ display: "flex", marginTop: 22, color: "#faf8f3", fontSize: 46, fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1.05 }}>{hasDeposits ? "Rewards deposited" : "No deposits this week"}</div>
          <div style={{ display: "flex", marginTop: 24, color: "#9b958c", fontSize: 25, lineHeight: 1.3 }}>{date.format(new Date(cycle.cycle_start))} to {date.format(new Date(cycle.cycle_end))} UTC</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 568, justifyContent: "center", padding: "34px 0 34px 48px", borderLeft: "1px solid rgba(255,255,255,.10)" }}>
          <div style={{ display: "flex", color: "#9b958c", fontSize: 25, letterSpacing: ".09em", lineHeight: 1.25, textTransform: "uppercase" }}>Value at deposit</div>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 14 }}>
            <span style={{ fontSize: 66, fontWeight: 700, letterSpacing: "-.045em", lineHeight: 1 }}>{amount.format(cycle.value_crvusd_at_deposit)}</span>
            <span style={{ marginLeft: 14, color: "#9b958c", fontSize: 28 }}>crvUSD</span>
          </div>
          {hasDeposits ? <div style={{ display: "flex", flexDirection: "column", marginTop: 26, color: "#9b958c", fontSize: 25, lineHeight: 1.35 }}>
            <span>{shares.format(cycle.reward_shares)} yvcrvUSD-2</span>
            <span style={{ marginTop: 7 }}>{cycle.event_count} {cycle.event_count === 1 ? "deposit" : "deposits"}</span>
          </div> : null}
        </div>
      </div>
    </SocialImageFrame>,
    { ...socialImageSize, fonts: socialImageFonts(assets) },
  );
}
