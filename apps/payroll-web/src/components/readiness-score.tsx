'use client';

export type ReadinessStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
export interface Readiness {
  year: number;
  month: number;
  period: string;
  checkedAt: string;
  score: number;
  overall: 'READY' | 'AT_RISK' | 'BLOCKED';
  daysToMonthEnd: number;
  employees: number;
  counts: { pass: number; warn: number; fail: number; info: number };
  checks: { id: string; area: string; title: string; status: ReadinessStatus; detail: string; count: number; items: { label: string; href?: string }[]; href?: string }[];
}

export const OVERALL = {
  READY: { label: 'Ready', tone: 'success' as const, ring: '#067a57' },
  AT_RISK: { label: 'At risk', tone: 'warning' as const, ring: '#8a5300' },
  BLOCKED: { label: 'Blocked', tone: 'danger' as const, ring: '#c0262d' },
};

export function ScoreRing({ score, colour, size = 96 }: { score: number; colour: string; size?: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Readiness ${score}%`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#e3e7ef" strokeWidth="10" />
      <circle className="fx-ring" cx="50" cy="50" r={r} fill="none" stroke={colour} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="56" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1f2937">
        {score}%
      </text>
    </svg>
  );
}

