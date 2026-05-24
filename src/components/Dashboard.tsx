"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Stats {
  totals: {
    total: number;
    errors: number;
    blocked: number;
    avgLatency: number;
    p95Latency: number;
    avgTtfb: number;
    totalTokens: number;
  };
  series: { bucket: string; requests: number; errors: number; avgLatency: number }[];
  byModel: {
    model: string;
    provider: string;
    requests: number;
    avgLatency: number;
    tokens: number;
  }[];
  recent: {
    id: string;
    model: string;
    provider: string;
    status: string;
    latencyMs: number | null;
    totalTokens: number | null;
    inputPreview: string | null;
    outputPreview: string | null;
    errorMessage: string | null;
    createdAt: string;
  }[];
}

const fmt = (n: number) => new Intl.NumberFormat().format(n);
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const TT = {
  contentStyle: {
    background: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#a1a1aa" },
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [hours, setHours] = useState(24);

  const load = (h: number) =>
    fetch(`/api/stats?hours=${h}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

  useEffect(() => {
    load(hours);
    const t = setInterval(() => load(hours), 5000); // near real-time refresh
    return () => clearInterval(t);
  }, [hours]);

  if (!stats?.totals) {
    return (
      <div className="p-8 text-zinc-500">Loading metrics…</div>
    );
  }

  const { totals } = stats;
  const errorRate = totals.total
    ? ((totals.errors / totals.total) * 100).toFixed(1)
    : "0.0";
  const series = stats.series.map((s) => ({ ...s, t: hour(s.bucket) }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inference observability</h1>
          <p className="text-sm text-zinc-500">
            Latency · throughput · errors — refreshed every 5s from the ingestion store.
          </p>
        </div>
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
        >
          <option value={1}>Last 1h</option>
          <option value={24}>Last 24h</option>
          <option value={168}>Last 7d</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card label="Requests" value={fmt(totals.total)} />
        <Card
          label="Error rate"
          value={`${errorRate}%`}
          sub={`${fmt(totals.errors)} errors · ${fmt(totals.blocked)} blocked`}
        />
        <Card label="Avg latency" value={`${fmt(totals.avgLatency)} ms`} />
        <Card label="p95 latency" value={`${fmt(totals.p95Latency)} ms`} />
        <Card label="Avg TTFB" value={`${fmt(totals.avgTtfb)} ms`} />
        <Card label="Tokens" value={fmt(totals.totalTokens)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">
            Throughput &amp; errors / hour
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="t" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
              <Tooltip {...TT} />
              <Area
                type="monotone"
                dataKey="requests"
                stroke="#10b981"
                fill="#10b98133"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="errors"
                stroke="#ef4444"
                fill="#ef444433"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">
            Avg latency / hour (ms)
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="t" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip {...TT} />
              <Line
                type="monotone"
                dataKey="avgLatency"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Requests by model</h2>
          <ResponsiveContainer width="100%" height={Math.max(120, stats.byModel.length * 44)}>
            <BarChart data={stats.byModel} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" stroke="#71717a" fontSize={11} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="model"
                stroke="#71717a"
                fontSize={10}
                width={130}
              />
              <Tooltip {...TT} />
              <Bar dataKey="requests" radius={[0, 4, 4, 0]}>
                {stats.byModel.map((_, i) => (
                  <Cell key={i} fill="#10b981" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">By model</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="pb-2">Model</th>
                <th className="pb-2 text-right">Reqs</th>
                <th className="pb-2 text-right">Avg ms</th>
                <th className="pb-2 text-right">Tokens</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {stats.byModel.map((m) => (
                <tr key={m.model} className="border-t border-zinc-800/60">
                  <td className="py-2">
                    <span className="text-zinc-100">{m.model}</span>
                  </td>
                  <td className="py-2 text-right">{fmt(m.requests)}</td>
                  <td className="py-2 text-right">{fmt(m.avgLatency)}</td>
                  <td className="py-2 text-right">{fmt(m.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Recent inference logs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="pb-2">Time</th>
                <th className="pb-2">Model</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Latency</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2">Preview (redacted)</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {stats.recent.map((r) => (
                <tr key={r.id} className="border-t border-zinc-800/60 align-top">
                  <td className="py-2 whitespace-nowrap text-zinc-500">
                    {hour(r.createdAt)}
                  </td>
                  <td className="py-2 whitespace-nowrap">{r.model}</td>
                  <td className="py-2">
                    <span
                      className={
                        r.status === "success"
                          ? "text-emerald-400"
                          : r.status === "blocked"
                            ? "text-amber-400"
                            : "text-red-400"
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {r.latencyMs ? `${fmt(r.latencyMs)} ms` : "—"}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {r.totalTokens ? fmt(r.totalTokens) : "—"}
                  </td>
                  <td className="max-w-xs py-2 text-zinc-500">
                    <span className="line-clamp-2">
                      {r.errorMessage ?? r.outputPreview ?? r.inputPreview ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
