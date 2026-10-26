/**
 * components/admin/insights/charts.tsx - the Overview charts. Plain SVG/HTML, no chart library.
 *
 * Colours: series 1 blue #2a78d6, series 2 orange #eb6834 (a colour-blind-safe pair that also
 * differs in lightness). Every chart has a legend or a title naming its one series, values stay in
 * text colours, and hovering shows the exact numbers.
 */

'use client';

import { useMemo, useRef, useState } from 'react';
import type { InsightsOverview } from '@/lib/adminInsightsApi';
import { INK2, shortDate } from './ui';

const BLUE = '#2a78d6';
const ORANGE = '#eb6834';
const LIGHT_BLUE = '#A9C9F0';

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= v) return m * mag;
  }
  return 10 * mag;
}

function LegendSwatch({ color, label, shape = 'line' }: { color: string; label: string; shape?: 'line' | 'box' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span
        aria-hidden="true"
        style={{ background: color, width: shape === 'line' ? 14 : 10, height: shape === 'line' ? 3 : 10, borderRadius: shape === 'line' ? 2 : 3 }}
      />
      {label}
    </span>
  );
}

// ─── Active families (line) ──────────────────────────────────────────────────

export function ActiveFamiliesChart({ activity }: { activity: InsightsOverview['activity'] }) {
  const pts = activity.points;
  const W = 660, H = 230, L = 40, R = 650, T = 20, B = 200;
  const max = niceMax(Math.max(1, ...pts.map((p) => Math.max(p.weekly, p.daily))));
  const x = (i: number) => (pts.length <= 1 ? R : L + (i * (R - L)) / (pts.length - 1));
  const y = (v: number) => B - (v / max) * (B - T);
  const line = (k: 'weekly' | 'daily') => pts.map((p, i) => `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const ticks = [0, max / 3, (2 * max) / 3, max].map((v) => Math.round(v));
  const labelIdx = pts.length ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [];

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || pts.length === 0) return;
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - L) / (R - L)) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  }

  const last = pts[pts.length - 1];
  const h = hover != null ? pts[hover] : null;
  const unit = activity.stepDays > 1 ? 'Week ending' : '';

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-4 mb-2">
        <LegendSwatch color={BLUE} label="Weekly active" />
        <LegendSwatch color={ORANGE} label="Daily active" />
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        role="img"
        aria-label={last ? `Line chart of active families. Latest: ${last.weekly} weekly active, ${last.daily} daily active.` : 'No activity yet'}
      >
        <g fontSize="11" fill="#6E6E73">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#D2D2D7' : '#EDEDF0'} />
              <text x={L - 10} y={y(t) + 4} textAnchor="end">{t}</text>
            </g>
          ))}
          {labelIdx.map((i, n) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}>
              {shortDate(pts[i].day)}
            </text>
          ))}
        </g>
        <polyline points={line('weekly')} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line('daily')} fill="none" stroke={ORANGE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last && hover == null && (
          <g fontSize="12" fontWeight={600} fill="#1D1D1F">
            <circle cx={x(pts.length - 1)} cy={y(last.weekly)} r={4} fill={BLUE} stroke="#fff" strokeWidth={2} />
            <circle cx={x(pts.length - 1)} cy={y(last.daily)} r={4} fill={ORANGE} stroke="#fff" strokeWidth={2} />
            <text x={x(pts.length - 1) - 8} y={y(last.weekly) - 10} textAnchor="end">{last.weekly}</text>
            <text x={x(pts.length - 1) - 8} y={y(last.daily) - 10} textAnchor="end">{last.daily}</text>
          </g>
        )}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={B} stroke="#C7C7CC" />
            <circle cx={x(hover)} cy={y(h.weekly)} r={4} fill={BLUE} stroke="#fff" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(h.daily)} r={4} fill={ORANGE} stroke="#fff" strokeWidth={2} />
          </g>
        )}
        <rect x={L} y={T} width={R - L} height={B - T} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-8 bg-white rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] px-3 py-2 text-[13px]"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > pts.length / 2 ? 'translateX(-110%)' : 'translateX(10%)' }}
        >
          <div className={`text-xs ${INK2} mb-1`}>{unit} {shortDate(h.day)}</div>
          <div className="flex justify-between gap-4"><span>Weekly active</span><b>{h.weekly}</b></div>
          <div className="flex justify-between gap-4"><span>Daily active</span><b>{h.daily}</b></div>
        </div>
      )}
    </div>
  );
}

// ─── New families per week (stacked bars) ────────────────────────────────────

export function SignupsChart({ weeks }: { weeks: InsightsOverview['weeklySignups'] }) {
  const max = niceMax(Math.max(1, ...weeks.map((w) => w.total)));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        <LegendSwatch color={BLUE} label="Activated in 7 days" shape="box" />
        <LegendSwatch color={LIGHT_BLUE} label="Not activated" shape="box" />
      </div>
      <div className="grid grid-cols-8 gap-2.5 items-end h-[200px] border-b border-[#D2D2D7]">
        {weeks.map((w, i) => {
          const restH = ((w.total - w.activated) / max) * 170;
          const actH = (w.activated / max) * 170;
          return (
            <div
              key={w.weekStart}
              className="relative flex flex-col justify-end h-full gap-0.5"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="text-center text-xs font-semibold tabular-nums">{w.total}</span>
              {restH > 0 && <div style={{ height: restH, background: LIGHT_BLUE }} className="rounded-t" />}
              {actH > 0 && <div style={{ height: actH, background: BLUE }} className={restH > 0 ? '' : 'rounded-t'} />}
              {hover === i && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap bg-white rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] px-3 py-2 text-[13px]">
                  <div className={`text-xs ${INK2}`}>Week of {shortDate(w.weekStart)}</div>
                  <div>{w.total} new · {w.activated} activated</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={`grid grid-cols-8 gap-2.5 mt-2 text-[11px] text-center ${INK2}`}>
        {weeks.map((w) => <span key={w.weekStart}>{shortDate(w.weekStart)}</span>)}
      </div>
    </div>
  );
}

// ─── Weekly retention grid (sequential blue) ─────────────────────────────────

function cellColor(p: number): { bg: string; fg: string } {
  const a = [232, 241, 252], b = [11, 74, 153];
  const t = Math.max(0, Math.min(1, (p - 10) / 90));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return { bg: `rgb(${c.join(',')})`, fg: t > 0.5 ? '#FFFFFF' : '#1D1D1F' };
}

export function CohortGrid({ cohorts }: { cohorts: InsightsOverview['cohorts'] }) {
  const heads = useMemo(() => Array.from({ length: cohorts[0]?.cells.length ?? 8 }, (_, i) => `W${i}`), [cohorts]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px] border-separate border-spacing-[3px] text-xs tabular-nums">
        <thead>
          <tr className={INK2}>
            <th className="text-left font-normal py-1.5">Signup week</th>
            <th className="font-normal">Size</th>
            {heads.map((h) => <th key={h} className="font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.weekStart}>
              <td className="font-medium py-2 whitespace-nowrap">{shortDate(c.weekStart)}</td>
              <td className={`text-center ${INK2}`}>{c.size}</td>
              {c.cells.map((v, i) => {
                if (v == null) return <td key={i} />;
                const { bg, fg } = cellColor(v);
                return (
                  <td key={i} className="text-center py-2 rounded-md font-medium" style={{ background: bg, color: fg }} title={`${v}% still active in week ${i}`}>
                    {Math.round(v)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
