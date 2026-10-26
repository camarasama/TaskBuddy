/**
 * components/admin/insights/ui.tsx - building blocks for the admin Overview and Re-engagement
 * pages (design approved 2026-10-26): white rounded cards on a light grey ground, system font,
 * one blue accent, status colours only with an icon and a word.
 */

'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, AlertCircle, CheckCircle2 } from 'lucide-react';

export const INK = 'text-[#1D1D1F]';
export const INK2 = 'text-[#6E6E73]';

export const TONE = {
  good: 'text-[#1A7F37]',
  bad: 'text-[#B42318]',
  warn: 'text-[#A05A00]',
  neutral: 'text-[#6E6E73]',
} as const;
export type Tone = keyof typeof TONE;

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function fmtPct(v: number | null | undefined): string {
  return v == null ? 'No data' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-[18px] p-5 sm:p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className={`text-[19px] font-semibold leading-tight ${INK}`}>{title}</h2>
        {subtitle && <p className={`mt-1 text-[13px] ${INK2}`}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Delta({ text, tone, direction }: { text: string; tone: Tone; direction?: 'up' | 'down' }) {
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${TONE[tone]}`}>
      {Icon && <Icon className="w-3 h-3" strokeWidth={2.6} aria-hidden="true" />}
      {text}
    </span>
  );
}

export function KpiTile(props: { label: string; value: string; delta?: ReactNode; note?: string }) {
  return (
    <div className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-w-0">
      <span className={`text-[13px] font-medium ${INK2}`}>{props.label}</span>
      <span className={`text-[30px] font-bold tracking-tight leading-[1.1] ${INK}`}>{props.value}</span>
      {props.delta}
      {props.note && <span className={`text-xs ${INK2}`}>{props.note}</span>}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex bg-[#E8E8ED] rounded-[9px] p-0.5">
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => props.onChange(o.value)}
            className={`text-[13px] font-medium px-3.5 min-h-[32px] rounded-[7px] ${INK} ${
              on ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'hover:bg-white/50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const styles = {
    good: 'text-[#1A7F37] bg-[#E8F5EC]',
    warn: 'text-[#A05A00] bg-[#FDF1E0]',
    bad: 'text-[#B42318] bg-[#FDECEA]',
  }[tone];
  const Icon = tone === 'good' ? CheckCircle2 : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles}`}>
      <Icon className="w-3 h-3" strokeWidth={2.4} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Meter({ pct, color = '#2a78d6', height = 8 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="bg-[#F0F0F3] rounded" style={{ height }}>
      <div className="rounded" style={{ height, width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className={`max-w-[1240px] mx-auto flex flex-col gap-6 ${INK}`}>{children}</div>
  );
}

export function PageTitle({ eyebrow, title, subtitle, right }: { eyebrow: string; title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className={`text-[13px] ${INK2}`}>{eyebrow}</span>
        <h1 className="text-[34px] leading-[1.15] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className={`text-[15px] ${INK2} max-w-[640px]`}>{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-3">{right}</div>}
    </header>
  );
}

export function LoadingBlock() {
  return <div className={`text-sm ${INK2} animate-pulse py-16 text-center`}>Loading…</div>;
}

export function ErrorBlock({ message }: { message: string }) {
  return <div className="bg-[#FDECEA] text-[#B42318] rounded-[14px] px-4 py-3 text-sm">{message}</div>;
}
