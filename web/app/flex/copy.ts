export const flexCopy = {
  nav: {
    label: "Flex",
    ariaLabel: "Flex markets",
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
    blurb: "USDC lending rates and borrowing capacity.",
    officialLink: "Open Flex",
  },
  freshness: {
    label: "Updated",
    unavailable: "Update time unavailable",
    stale: "Updates are taking longer than usual",
    latest: "Latest value",
  },
  protocol: {
    label: "Protocol overview",
    markets: "Markets",
    deposits: "Deposits",
    debt: "Debt",
    utilization: "Utilization",
    activity: "Recent activity",
  },
  markets: {
    title: "Markets",
    description: "Active, endorsed lending markets.",
    noActive: "No active markets.",
    headers: {
      market: "Market",
      status: "Status",
      deposits: "Deposits",
      debt: "Debt",
      liquidity: "Idle USDC",
      utilization: "Utilization",
      lenderApr: "Lender APR",
      borrowerRate: "Debt-weighted rate",
      age: "Age",
    },
    mobile: {
      deposits: "Deposits",
      debt: "Debt",
      liquidity: "Idle USDC",
      utilization: "Used",
      lenderApr: "Lender APR",
      borrowerRate: "Debt-weighted rate",
    },
  },
  status: {
    active: "Active",
    deprecated: "Deprecated",
    unendorsed: "Unendorsed",
    explanations: {
      active: "Endorsed for current use.",
      deprecated: "An older market.",
      unendorsed: "Not endorsed by Flex.",
    },
  },
  detail: {
    title: "Market detail",
    selectLabel: "Choose a market",
    selectPlaceholder: "Select a market",
    selectedLabel: "Selected market",
    collateral: "Collateral",
    borrowAsset: "Borrow asset",
    availableLiquidity: "Idle lender USDC",
    lenderApr: "Lender APR",
    borrowerRate: "Borrower rate",
    utilization: "Utilization",
    depositCap: "Deposit cap",
    borrowCap: "Borrow cap",
    risk: {
      title: "Market terms",
      description: "Key borrowing and liquidation limits.",
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
    description: "Utilization and rates over time.",
    rangeLabel: "History range",
    coverageLabel: "History available",
    deploymentLabel: "Market deployed",
    latestLabel: "Latest",
    ranges: {
      seven: "7 days",
      thirty: "30 days",
      ninety: "90 days",
    },
    utilization: {
      title: "Utilization",
      description: "Share of supplied assets currently borrowed.",
      ariaLabel: "Utilization history",
    },
    rates: {
      title: "Rates",
      description: "Lender APR and weighted borrower rate.",
      ariaLabel: "Lender APR and weighted borrower rate history",
      lenderApr: "Lender APR",
      borrowerRate: "Borrower rate",
    },
    inspection: {
      label: "Chart details",
      summary: "{timestamp}. Utilization {utilization}. Lender APR {lenderApr}. Borrower rate {borrowerRate}.",
      unavailable: "No value at this time.",
      keyboardHint: "Use left and right arrow keys to inspect points.",
    },
    unavailable: "History is not available for this period.",
    noResults: "No history was recorded in this period.",
  },
  redemptionPriority: {
    title: "Estimated borrowing capacity by rate",
    description: "Estimated capacity = idle USDC + lower-rate debt that could be redeemed. Capacity may remain when idle USDC is zero. Redemptions can affect existing borrowers.",
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
      idle: "Idle USDC",
      redeemable: "Redeemable lower-rate debt",
    },
    chart: {
      ariaLabel: "Estimated borrowing capacity by annual rate",
      interaction: "Use touch, pointer, or arrow keys to inspect rates.",
    },
    tooltip: {
      annualRate: "Annual rate",
      idle: "Idle USDC",
      redeemed: "Lower-rate debt potentially redeemed",
      total: "Estimated borrowing capacity",
      shareOfTotal: "Debt share potentially affected",
    },
    summary: "At {rate} annual rate, {idle} idle USDC plus {redeemed} of lower-rate debt potentially redeemed gives {total} estimated borrowing capacity; {share} of trove debt may be affected.",
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
    description: "Recent activity across Flex markets.",
    empty: "No recent activity to show.",
    loadMore: "Show more activity",
    loadingMore: "Loading more activity",
    end: "You are up to date.",
    transaction: "View transaction",
    eventTypes: {
      open_trove: "Position opened",
      close_trove: "Position closed",
      close_zombie_trove: "Dormant position closed",
      bad_debt: "Bad debt recorded",
      redeem_trove: "Position redeemed",
      lender_deposit: "Deposited",
      lender_withdrawal: "Withdrawn",
      auction_kick: "Auction started",
      auction_take: "Auction filled",
      market_deployed: "Market deployed",
      market_endorsed: "Market endorsed",
      market_unendorsed: "Market unendorsed",
    },
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
  events: {
    openTrove: "Position opened",
    addCollateral: "Collateral added",
    removeCollateral: "Collateral removed",
    adjust: "Position adjusted",
    borrow: "Borrowed",
    repay: "Repaid",
    close: "Position closed",
    closeTrove: "Position closed",
    closeZombieTrove: "Dormant position closed",
    badDebt: "Bad debt recorded",
    redeemTrove: "Position redeemed",
    lenderDeposit: "Deposited",
    lenderWithdrawal: "Withdrawn",
    deposit: "Deposited",
    withdrawal: "Withdrawn",
    liquidation: "Liquidated",
    redemption: "Redeemed",
    auctionKick: "Auction started",
    auctionTake: "Auction filled",
    marketDeployed: "Market deployed",
    marketEndorsed: "Market endorsed",
    marketUnendorsed: "Market unendorsed",
    adjustInterestRate: "Interest rate adjusted",
  },
  values: {
    unavailable: "Not available",
  },
  loading: {
    page: "Loading Flex markets",
    table: "Loading markets",
    history: "Loading history",
    activity: "Loading activity",
  },
  error: {
    title: "Flex data unavailable.",
    description: "Try again in a moment.",
    retry: "Try again",
  },
  accessibility: {
    tableSort: "Sort by {column}",
    sortedAscending: "Sorted ascending by {column}",
    sortedDescending: "Sorted descending by {column}",
    openMarket: "Open {market} market detail",
    chartPoint: "{date}: {value}",
    transaction: "View transaction {hash}",
  },
} as const;

export type FlexCopy = typeof flexCopy;

export function flexMarketCount(count: number): string {
  return `${count} ${count === 1 ? "market" : "markets"}`;
}

export function flexUpdatedAt(timestamp: string): string {
  return `${flexCopy.freshness.label} ${timestamp}`;
}

export function flexHistoryFor(market: string): string {
  return `${flexCopy.history.title}: ${market}`;
}

export function flexActivityCount(count: number): string {
  return `${count} ${count === 1 ? "activity" : "activities"}`;
}

export function flexA11y(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
