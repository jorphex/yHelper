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
    blurb: "Compare active markets, rates, and available liquidity.",
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
    noActive: "No active markets are available right now.",
    headers: {
      market: "Market",
      status: "Status",
      deposits: "Deposits",
      debt: "Debt",
      liquidity: "Liquidity",
      utilization: "Utilization",
      lenderApr: "Lender APR",
      borrowerRate: "Borrower rate",
      age: "Age",
    },
    mobile: {
      deposits: "Deposits",
      debt: "Debt",
      liquidity: "Available",
      utilization: "Used",
      lenderApr: "Lender APR",
      borrowerRate: "Borrower rate",
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
    availableLiquidity: "Available liquidity",
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
    title: "Redemption priority",
    description: "Debt at lower rates would redeem first. None sits below the lowest official rate, and the last official tier is the highest rate shown.",
    freshness: {
      ready: "Current",
      delayed: "Delayed",
      sourceBlock: "Ethereum block {block}",
      sourceTime: "As of {time}",
    },
    empty: {
      title: "No active debt to rank",
      description: "This market has no debt in the redemption queue.",
    },
    unavailable: {
      title: "Redemption priority is unavailable right now.",
      retry: "Try again",
    },
    axes: {
      annualRate: "Annual interest rate",
      debtAhead: "Debt ahead in {symbol}",
    },
    chart: {
      ariaLabel: "Redemption priority by annual interest rate",
      interaction: "Use touch, pointer, or arrow keys to inspect rates.",
    },
    tooltip: {
      annualRate: "Annual rate",
      debtAhead: "Debt ahead",
      shareOfTotal: "Share of total",
    },
    summary: "At {rate}, {debtAhead} at strictly lower rates would be redeemed first. That is {share} of total debt.",
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
    title: "Flex data is unavailable right now.",
    description: "Please try again shortly.",
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
