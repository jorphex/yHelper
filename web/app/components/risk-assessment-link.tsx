const assessments: Record<string, { report: string; date: string }> = {
  "0xbe53a109b494e5c9f97b9cd39fe969be68bf6204": { report: "yearn-yvusdc", date: "Jul 13, 2026" },
  "0x182863131f9a4630ff9e27830d945b1413e347e8": { report: "yearn-yvusds", date: "Jul 13, 2026" },
  "0x310b7ea7475a0b449cfd73be81522f1b88efafaa": { report: "yearn-yvusdt", date: "Sep 28, 2026" },
  "0x028ec7330ff87667b6dfb0d94b954c820195336c": { report: "yearn-yvdai", date: "Sep 14, 2026" },
  "0x696d02db93291651ed510704c9b286841d506987": { report: "yearn-yvusd", date: "Aug 8, 2026" },
  "0xd93dade7ac8b5d1687da5d074835cb4404dee8ba": { report: "flex", date: "Sep 7, 2026" },
  "0xf4996ca4190a1a3e7cf19abe2f6eb712abd4a03c": { report: "flex", date: "Sep 7, 2026" },
};

export function RiskAssessmentLink({ chainId, address, label }: { chainId: number; address: string; label: string }) {
  const assessment = chainId === 1 ? assessments[address.toLowerCase()] : null;
  return assessment ? <a className="vault-report-link" href={`https://github.com/yearn/risk-score/blob/master/reports/report/${assessment.report}.md`} target="_blank" rel="noopener noreferrer" aria-label={`Risk assessment for ${label} · ${assessment.date}`}>Risk assessment · {assessment.date} ↗</a> : null;
}
