'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@nexzi/ui';

/** Single-series bar chart in the brand wine colour, with hover tooltip and an accessible table fallback. */
export function SimpleBarChart({ data, valueLabel, money = false }: { data: { label: string; value: number }[]; valueLabel: string; money?: boolean }) {
  const fmt = (v: number) => (money ? formatMoney(v.toFixed(2), 0) : String(v));
  return (
    <figure>
      <div className="h-56 w-full" aria-hidden>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#ead7da" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#ead7da' }} tick={{ fill: '#6b5a5e', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6b5a5e', fontSize: 12 }} tickFormatter={fmt} width={money ? 80 : 32} allowDecimals={!money ? false : undefined} />
            <Tooltip cursor={{ fill: 'rgba(240,217,220,0.45)' }} formatter={(v) => [fmt(Number(v)), valueLabel]} contentStyle={{ borderRadius: 8, borderColor: '#ead7da', fontSize: 12 }} />
            <Bar dataKey="value" fill="#7a2b36" radius={[4, 4, 0, 0]} maxBarSize={44} />
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
