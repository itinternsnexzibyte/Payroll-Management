'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@nexzi/ui';

/** Single-series bar chart in the brand blue, with hover tooltip and an accessible table fallback. */
export function SimpleBarChart({ data, valueLabel, money = false }: { data: { label: string; value: number }[]; valueLabel: string; money?: boolean }) {
  const fmt = (v: number) => (money ? formatMoney(v.toFixed(2), 0) : String(v));
  return (
    <figure>
      <div className="h-56 w-full" aria-hidden>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
            <defs>
              <linearGradient id="fx-bar-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0cb884" />
                <stop offset="0.35" stopColor="#3b86d1" />
                <stop offset="1" stopColor="#1e40af" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e3e7ef" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e3e7ef' }} tick={{ fill: '#6c7293', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6c7293', fontSize: 12 }} tickFormatter={fmt} width={money ? 80 : 32} allowDecimals={!money ? false : undefined} />
            <Tooltip cursor={{ fill: 'rgba(59,134,209,0.10)' }} formatter={(v) => [fmt(Number(v)), valueLabel]} contentStyle={{ borderRadius: 8, borderColor: '#e3e7ef', fontSize: 12 }} />
            <Bar dataKey="value" fill="url(#fx-bar-fill)" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{valueLabel}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.label}</th>
              <td>{fmt(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
