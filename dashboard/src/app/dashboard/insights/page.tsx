'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, Calendar, Target, Zap, Star, Mail, Phone,
  Globe, Users, BarChart3, Trophy, Flame, ArrowUpRight,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, RadarChart,
  Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useLeads, useSearches } from '@/lib/hooks';
import { LEAD_STATUS_CONFIG } from '@/types';

const CHART_COLORS = ['#7c5cfc', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#06b6d4', '#f97316'];

export default function InsightsPage() {
  const { leads, loading } = useLeads();
  const { searches } = useSearches();

  const stats = useMemo(() => {
    const now = new Date();
    const today = leads.filter(l => new Date(l.created_at).toDateString() === now.toDateString());
    const thisWeek = leads.filter(l => {
      const d = new Date(l.created_at);
      const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
      return d >= weekAgo;
    });
    const thisMonth = leads.filter(l => {
      const d = new Date(l.created_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const contacted = leads.filter(l => l.status !== 'new');
    const replied = leads.filter(l => l.status === 'replied' || l.status === 'converted');
    const converted = leads.filter(l => l.status === 'converted');

    const avgScore = leads.filter(l => l.opportunity_score).length > 0
      ? Math.round(leads.filter(l => l.opportunity_score).reduce((s, l) => s + (l.opportunity_score || 0), 0) / leads.filter(l => l.opportunity_score).length)
      : 0;

    const topLead = [...leads].sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0))[0];

    // Best performing niche
    const nicheStats: Record<string, { total: number; converted: number; avgScore: number; scores: number[] }> = {};
    leads.forEach(l => {
      const niche = l.search?.niche || 'Unknown';
      if (!nicheStats[niche]) nicheStats[niche] = { total: 0, converted: 0, avgScore: 0, scores: [] };
      nicheStats[niche].total++;
      if (l.status === 'converted') nicheStats[niche].converted++;
      if (l.opportunity_score) nicheStats[niche].scores.push(l.opportunity_score);
    });
    Object.values(nicheStats).forEach(n => {
      n.avgScore = n.scores.length > 0 ? Math.round(n.scores.reduce((s, v) => s + v, 0) / n.scores.length) : 0;
    });

    // Channel effectiveness
    const channelStats: Record<string, number> = {};
    leads.forEach(l => { if (l.contact_channel) channelStats[l.contact_channel] = (channelStats[l.contact_channel] || 0) + 1; });

    // Speed distribution
    const speedBuckets = { 'Fast (90+)': 0, 'Average (50-89)': 0, 'Slow (<50)': 0, 'Unknown': 0 };
    leads.forEach(l => {
      if (l.page_speed_score === null) speedBuckets['Unknown']++;
      else if (l.page_speed_score >= 90) speedBuckets['Fast (90+)']++;
      else if (l.page_speed_score >= 50) speedBuckets['Average (50-89)']++;
      else speedBuckets['Slow (<50)']++;
    });

    // Score distribution
    const scoreBuckets: Record<string, number> = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
    leads.forEach(l => {
      const s = l.opportunity_score || 0;
      if (s <= 20) scoreBuckets['0-20']++;
      else if (s <= 40) scoreBuckets['21-40']++;
      else if (s <= 60) scoreBuckets['41-60']++;
      else if (s <= 80) scoreBuckets['61-80']++;
      else scoreBuckets['81-100']++;
    });

    // Weekly trend
    const weeklyData: { week: string; leads: number; contacted: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - (i * 7));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
      const weekLeads = leads.filter(l => { const d = new Date(l.created_at); return d >= weekStart && d < weekEnd; });
      weeklyData.push({
        week: `W${4 - i}`,
        leads: weekLeads.length,
        contacted: weekLeads.filter(l => l.status !== 'new').length,
      });
    }

    return {
      today, thisWeek, thisMonth, contacted, replied, converted,
      avgScore, topLead, nicheStats, channelStats, speedBuckets, scoreBuckets, weeklyData,
    };
  }, [leads]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 shimmer rounded-xl w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-24 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const StatCard = ({ label, value, sub, icon: Icon, color, delay }: { label: string; value: string | number; sub?: string; icon: typeof TrendingUp; color: string; delay: number }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="surface-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon size={15} style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </motion.div>
  );

  const tooltipStyle = {
    background: 'var(--bg-elevated)', border: '1px solid var(--border-medium)',
    borderRadius: '0.75rem', fontSize: '0.75rem', color: 'var(--text-primary)',
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Insights</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Your lead generation performance at a glance
        </p>
      </motion.div>

      {/* Time-based stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today" value={stats.today.length} icon={Calendar} color="var(--accent-blue)" delay={0} />
        <StatCard label="This Week" value={stats.thisWeek.length} icon={Flame} color="var(--accent-amber)" delay={0.05} />
        <StatCard label="This Month" value={stats.thisMonth.length} icon={BarChart3} color="var(--accent-green)" delay={0.1} />
        <StatCard label="All Time" value={leads.length} icon={Users} color="var(--accent-purple)" delay={0.15} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Contacted" value={stats.contacted.length}
          sub={`${leads.length ? Math.round(stats.contacted.length / leads.length * 100) : 0}% of total`}
          icon={Mail} color="var(--accent-blue)" delay={0.2} />
        <StatCard label="Replied" value={stats.replied.length}
          sub={`${stats.contacted.length ? Math.round(stats.replied.length / stats.contacted.length * 100) : 0}% reply rate`}
          icon={ArrowUpRight} color="var(--accent-green)" delay={0.25} />
        <StatCard label="Converted" value={stats.converted.length}
          sub={`${leads.length ? Math.round(stats.converted.length / leads.length * 100) : 0}% conversion`}
          icon={Trophy} color="var(--accent-amber)" delay={0.3} />
        <StatCard label="Avg Score" value={stats.avgScore}
          sub="opportunity score"
          icon={Target} color="var(--accent-primary)" delay={0.35} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Weekly Trend */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>Weekly Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.weeklyData}>
              <defs>
                <linearGradient id="insightGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Area type="monotone" dataKey="leads" stroke="var(--accent-primary)" fill="url(#insightGrad)" strokeWidth={2} name="Leads" />
              <Area type="monotone" dataKey="contacted" stroke="var(--accent-green)" fill="none" strokeWidth={2} strokeDasharray="5 5" name="Contacted" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Score Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>Score Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={Object.entries(stats.scoreBuckets).map(([name, value]) => ({ name, value }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {Object.keys(stats.scoreBuckets).map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Niche Performance */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>Niche Performance</h3>
          <div className="space-y-3">
            {Object.entries(stats.nicheStats).sort((a, b) => b[1].total - a[1].total).slice(0, 6).map(([niche, data], i) => (
              <motion.div key={niche}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
                className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>{niche}</span>
                  <div className="flex items-center gap-3">
                    <span style={{ color: 'var(--text-muted)' }}>{data.total} leads</span>
                    {data.avgScore > 0 && (
                      <span className="font-bold" style={{ color: 'var(--accent-primary)' }}>Avg {data.avgScore}</span>
                    )}
                  </div>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (data.total / Math.max(...Object.values(stats.nicheStats).map(n => n.total))) * 100)}%` }}
                    transition={{ duration: 0.8, delay: 0.5 + i * 0.05 }}
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${CHART_COLORS[i % CHART_COLORS.length]}, ${CHART_COLORS[(i + 1) % CHART_COLORS.length]})` }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Speed Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>Speed Distribution</h3>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={Object.entries(stats.speedBuckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }))}
                  cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {Object.entries(stats.speedBuckets).filter(([, v]) => v > 0).map((_, i) => (
                    <Cell key={i} fill={['var(--accent-green)', 'var(--accent-amber)', 'var(--accent-red)', 'var(--text-muted)'][i]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {Object.entries(stats.speedBuckets).map(([name, value], i) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{
                      background: ['var(--accent-green)', 'var(--accent-amber)', 'var(--accent-red)', 'var(--text-muted)'][i],
                    }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
                  </div>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Top Lead */}
      {stats.topLead && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="surface-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} style={{ color: 'var(--accent-amber)' }} />
            <h3 className="text-sm font-semibold">Top Opportunity</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold">{stats.topLead.business_name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {stats.topLead.address || 'No address'} - {stats.topLead.rating} stars ({stats.topLead.review_count} reviews)
              </p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold" style={{ color: 'var(--accent-primary)' }}>
                {stats.topLead.opportunity_score || '--'}
              </span>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>opportunity score</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
