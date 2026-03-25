'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Mail, Globe, Star, Search, TrendingUp,
  Phone, Smartphone, AlertTriangle, CheckCircle2,
  MessageCircle, XCircle, BarChart3, Zap, Target, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Area, AreaChart,
} from 'recharts';
import KPICard from '@/components/dashboard/KPICard';
import { useLeads, useKPIs, useSearches } from '@/lib/hooks';
import { LEAD_STATUS_CONFIG, LeadStatus } from '@/types';
import { timeAgo } from '@/lib/utils';

const CHART_COLORS = ['#60a5fa', '#a78bfa', '#fbbf24', '#34d399', '#f87171', '#6b7280'];

export default function OverviewPage() {
  const { leads, loading } = useLeads();
  const { searches } = useSearches();
  const kpis = useKPIs(leads);

  // Status distribution for pie chart
  const statusData = Object.entries(LEAD_STATUS_CONFIG).map(([key, config]) => ({
    name: config.label,
    value: leads.filter((l) => l.status === key).length,
    color: config.color,
  })).filter((d) => d.value > 0);

  // Leads per search for bar chart
  const searchData = searches.slice(0, 8).map((s) => ({
    name: `${s.niche} - ${s.city}`.slice(0, 20),
    leads: leads.filter((l) => l.search_id === s.id).length,
  }));

  // Leads over time (by day)
  const timelineData = (() => {
    const grouped: Record<string, number> = {};
    leads.forEach((l) => {
      const day = new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return Object.entries(grouped)
      .slice(-14)
      .map(([date, count]) => ({ date, leads: count }));
  })();

  // Recent activity
  const recentLeads = leads.slice(0, 5);

  // Pitch angle distribution
  const pitchData = (() => {
    const counts: Record<string, number> = {};
    leads.forEach((l) => {
      l.pitch_angles.forEach((a) => {
        counts[a] = (counts[a] || 0) + 1;
      });
    });
    return Object.entries(counts).map(([name, value]) => ({
      name: name.replace(/_/g, ' '),
      value,
    }));
  })();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer h-[100px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {leads.length} leads across {searches.length} searches
          </p>
        </div>
      </motion.div>

      {/* KPI Grid - Row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Total Leads" value={kpis.totalLeads} icon={Users} color="var(--accent-blue)" delay={0} />
        <KPICard label="Contacted" value={kpis.leadsContacted} icon={MessageCircle} color="var(--accent-purple)" delay={0.05} />
        <KPICard label="Response Rate" value={`${kpis.responseRate}%`} icon={TrendingUp} color="var(--accent-green)" delay={0.1} />
        <KPICard label="Conversion Rate" value={`${kpis.conversionRate}%`} icon={CheckCircle2} color="var(--accent-amber)" delay={0.15} />
      </div>

      {/* KPI Grid - Row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Emails Found" value={kpis.emailsFound} icon={Mail} color="var(--accent-blue)" delay={0.2} />
        <KPICard label="With Website" value={kpis.websitesFound} icon={Globe} color="var(--accent-green)" delay={0.25} />
        <KPICard label="No Website" value={kpis.withoutWebsite} icon={AlertTriangle} color="var(--accent-red)" delay={0.3} />
        <KPICard label="No App" value={kpis.withoutApp} icon={Smartphone} color="var(--accent-amber)" delay={0.35} />
      </div>

      {/* KPI Grid - Row 3 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Avg Rating" value={kpis.avgRating || '--'} icon={Star} color="var(--accent-amber)" delay={0.4} />
        <KPICard label="Avg Score" value={kpis.avgOpportunityScore ?? '--'} icon={Target} color="var(--accent-primary)" delay={0.45} />
        <KPICard label="Follow-ups Due" value={kpis.followUpsDue} icon={Clock} color="var(--accent-red)" delay={0.5} />
        <KPICard label="Searches" value={kpis.totalSearches} icon={Search} color="var(--accent-purple)" delay={0.55} />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="surface-card p-5"
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Leads Over Time
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timelineData}>
              <defs>
                <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-primary)',
                }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Area type="monotone" dataKey="leads" stroke="var(--accent-primary)" fill="url(#leadGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Status Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="surface-card p-5"
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Lead Status Distribution
          </h3>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: '0.75rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-primary)',
                  }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {statusData.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                  </div>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads per Search */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="surface-card p-5"
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Leads per Search
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={searchData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-primary)',
                }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="leads" fill="var(--accent-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Pitch Angles */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="surface-card p-5"
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Pitch Angle Distribution
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pitchData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '0.75rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-primary)',
                }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="value" fill="var(--accent-purple)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="surface-card p-5"
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
          Recent Leads
        </h3>
        <div className="space-y-2">
          {recentLeads.map((lead, i) => (
            <motion.div
              key={lead.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.05 }}
              className="flex items-center justify-between py-2.5 px-3 rounded-xl transition-colors"
              style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent-gradient-from), var(--accent-gradient-to))',
                    color: 'white',
                  }}
                >
                  {lead.business_name.charAt(0)}
                </div>
                <div>
                  <span className="text-sm font-medium">{lead.business_name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {lead.rating && (
                      <span className="text-[11px] flex items-center gap-0.5" style={{ color: 'var(--accent-amber)' }}>
                        <Star size={10} fill="currentColor" /> {lead.rating}
                      </span>
                    )}
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(lead.created_at)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lead.emails.length > 0 && <Mail size={13} style={{ color: 'var(--accent-blue)' }} />}
                {lead.phone && <Phone size={13} style={{ color: 'var(--accent-green)' }} />}
                {lead.has_website && <Globe size={13} style={{ color: 'var(--text-secondary)' }} />}
              </div>
            </motion.div>
          ))}
          {recentLeads.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
              No leads yet. Run the scraper to get started.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
