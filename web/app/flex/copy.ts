export const flexCopy = {
  nav: {
    label: "Flex",
  },
  metadata: {
    title: "Flex Markets | yHelper",
    description: "A clear view of Flex lending markets on Ethereum.",
  },
  social: {
    activeDeposits: "Active market deposits",
  },
  hero: {
    title: "Flex Markets",
    accent: "Ethereum lending",
    blurb: "Lending rates and borrowing capacity.",
    officialLink: "Open Flex",
  },
  markets: {
    title: "Markets",
    description: "Active, endorsed lending markets.",
    noActive: "No active markets.",
    headers: {
      market: "Market",
      age: "Age",
    },
  },
  status: {
    deprecated: "Deprecated",
    unendorsed: "Unendorsed",
  },
  detail: {
    title: "Market detail",
    selectLabel: "Choose a market",
    risk: {
      title: "Market terms",
      primary: {
        minimumDebt: "Minimum debt",
        maximumLtv: "Maximum LTV",
      },
      secondary: {
        safeLtv: "Safe LTV",
        maximumFeeThreshold: "Max fee at",
        liquidationFeeRange: "Liquidation fee",
      },
    },
  },
  history: {
    title: "Market history",
    rangeLabel: "History range",
    utilization: {
      title: "Utilization",
      description: "Share of supplied assets currently borrowed.",
    },
    rates: {
      title: "Rates",
      description: "Expected lender APR and weighted borrower rate.",
      lenderApr: "Expected lender APR",
      borrowerRate: "Borrower rate",
    },
    inspection: {
      summary: "{timestamp}. Utilization {utilization}. Expected lender APR {lenderApr}. Borrower rate {borrowerRate}.",
      keyboardHint: "Use left and right arrow keys to inspect points.",
    },
    unavailable: "History is not available for this period.",
  },
  redemptionPriority: {
    title: "Estimated borrowing capacity by rate",
    description: "Estimated capacity = idle {symbol} + lower-rate debt that could be redeemed. Capacity may remain when idle {symbol} is zero. Redemptions can affect existing borrowers.",
    freshness: {
      ready: "Current",
      delayed: "Delayed",
      sourceBlock: "Ethereum block {block}",
      sourceTime: "As of {time}",
    },
    empty: {
      title: "No active trove rates",
      description: "No active borrowing positions.",
    },
    unavailable: {
      title: "Borrowing capacity unavailable.",
      retry: "Try again",
    },
    axes: {
      annualRate: "Annual interest rate",
      capacity: "Estimated borrowing capacity ({symbol})",
    },
    legend: {
      idle: "Idle {symbol}",
      redeemable: "Redeemable lower-rate debt",
    },
    chart: {
      ariaLabel: "Estimated borrowing capacity by annual rate",
      interaction: "Use touch, pointer, or arrow keys to inspect rates.",
    },
    tooltip: {
      annualRate: "Annual rate",
      idle: "Idle {symbol}",
      redeemed: "Lower-rate debt potentially redeemed",
      total: "Estimated borrowing capacity",
      shareOfTotal: "Debt share potentially affected",
    },
    summary: "At {rate} annual rate, {idle} idle {symbol} plus {redeemed} of lower-rate debt potentially redeemed gives {total} estimated borrowing capacity; {share} of trove debt may be affected.",
  },
  troveHealth: {
    title: "Borrowing position health",
    description: "A trove is a borrowing position.",
    definition: "Near max LTV: within 1 percentage point of the limit. Debt shares use total active-trove debt.",
    ltvDefinition: "LTV means loan-to-value, the borrowed amount relative to collateral value.",
    metrics: {
      activeTroves: "Active troves",
      medianLtv: "Median LTV",
      minimumBuffer: "Smallest max-LTV buffer",
      debtNearMax: "Debt share near max LTV",
      largestDebtShare: "Largest single-trove debt share",
    },
    loading: "Loading trove metrics…",
    empty: "No active troves in this market.",
    unavailable: "Position metrics unavailable.",
  },
  activity: {
    title: "Protocol activity",
    empty: "No recent activity to show.",
    loadMore: "Show more activity",
    loadingMore: "Loading more activity",
    headers: {
      time: "Time",
      event: "Event",
      market: "Market",
      amount: "Amount",
    },
    mobile: {
      time: "When",
      event: "Activity",
      market: "Market",
      amount: "Amount",
    },
  },
  values: {
    unavailable: "Not available",
  },
  loading: {
    page: "Loading Flex markets",
  },
  accessibility: {
    transaction: "View transaction {hash}",
  },
} as const;

export function flexA11y(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
