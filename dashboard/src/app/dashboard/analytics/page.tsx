'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, RadarChart,
  PolarGrid, PolarAngleAxis, Radar,
} from 'recharts';
import {
  TrendingUp, Target, Mail, Phone, Globe, Smartphone,
  CheckCircle2, XCircle, AlertTriangle, BarChart3,
} from 'lucide-react';
import { useLeads, useSearches } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { LEAD_STATUS_CONFIG, LeadStatus } from '@/types';

const tooltipStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-medium)',
  borderRadius: '0.75rem',
  fontSize: '0.75rem',
  color: 'var(--text-primary)',
};

export default function AnalyticsPage() {
  const { leads, loading } = useLeads();
  const { searches } = useSearches();
  const [events, setEvents] = useState<{ event_type: string; created_at: string }[]>([]);

  useEffect(() => {
    supabase
      .from('ms_analytics_events')
      .select('event_type, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (data) setEvents(data);
      });
  }, []);

  // Scraping quality metrics
  const scrapingMetrics = useMemo(() => {
    const total = leads.length || 1;
    return {
      emailFoundRate: Math.round((leads.filter((l) => l.emails.length > 0).length / total) * 100),
      phoneFoundRate: Math.round((leads.filter((l) => l.phone).length / total) * 100),
      websiteFoundRate: Math.round((leads.filter((l) => l.has_website).length / total) * 100),
      appFoundRate: Math.round((leads.filter((l) => l.has_mobile_app).length / total) * 100),
      emailValidRate: (() => {
        const validated = leads.filter((l) => l.email_valid !== null);
        if (!validated.length) return null;
        return Math.round((validated.filter((l) => l.email_valid).length / validated.length) * 100);
      })(),
      phoneValidRate: (() => {
        const validated = leads.filter((l) => l.phone_valid !== null);
        if (!validated.length) return null;
        return Math.round((validated.filter((l) => l.phone_valid).length / validated.length) * 100);
      })(),
    };
  }, [leads]);

  // Response rate by niche
  const nichePerformance = useMemo(() => {
    const niches: Record<string, { total: number; contacted: number; replied: number; converted: number }> = {};
    leads.forEach((l) => {
      const search = searches.find((s) => s.id === l.search_id);
      if (!search) return;
      const key = search.niche;
      if (!niches[key]) niches[key] = { total: 0, contacted: 0, replied: 0, converted: 0 };
      niches[key].total++;
      if (l.status !== 'new') niches[key].contacted++;
      if (l.status === 'replied' || l.status === 'converted') niches[key].replied++;
      if (l.status === 'converted') niches[key].converted++;
    });
    return Object.entries(niches)
      .map(([niche, data]) => ({
        niche,
        ...data,
        responseRate: data.contacted ? Math.round((data.replied / data.contacted) * 100) : 0,
        conversionRate: data.total ? Math.round((data.converted / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.responseRate - a.responseRate);
  }, [leads, searches]);

  // City performance
  const cityPerformance = useMemo(() => {
    const cities: Record<string, { total: number; replied: number; converted: number }> = {};
    leads.forEach((l) => {
      const search = searches.find((s) => s.id === l.search_id);
      if (!search) return;
      const key = search.city;
      if (!cities[key]) cities[key] = { total: 0, replied: 0, converted: 0 };
      cities[key].total++;
      if (l.status === 'replied' || l.status === 'converted') cities[key].replied++;
      if (l.status === 'converted') cities[key].converted++;
    });
    return Object.entries(cities)
      .map(([city, data]) => ({
        city,
        ...data,
        responseRate: data.total ? Math.round((data.replied / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [leads, searches]);

  // Pitch angle effectiveness
  const pitchEffectiveness = useMemo(() => {
    const angles: Record<string, { total: number; replied: number }> = {};
    leads.forEach((l) => {
      l.pitch_angles.forEach((angle) => {
        if (!angles[angle]) angles[angle] = { total: 0, replied: 0 };
        angles[angle].total++;
        if (l.status === 'replied' || l.status === 'converted') angles[angle].replied++;
      });
    });
    return Object.entries(angles)
      .map(([angle, data]) => ({
        angle: angle.replace(/_/g, ' '),
        total: data.total,
        responseRate: data.total ? Math.round((data.replied / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.responseRate - a.responseRate);
  }, [leads]);

  // Tech stack distribution
  const techDistribution = useMemo(() => {
    const techs: Record<string, number> = {};
    leads.forEach((l) => {
      l.tech_stack.forEach((t) => {
        techs[t] = (techs[t] || 0) + 1;
      });
    });
    return Object.entries(techs)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [leads]);

  // Speed score distribution
  const speedDistribution = useMemo(() => {
    const buckets = { Fast: 0, Average: 0, Slow: 0, Unknown: 0 };
    leads.forEach((l) => {
      if (l.page_speed_score === null) buckets.Unknown++;
      else if (l.page_speed_score >= 90) buckets.Fast++;
      else if (l.page_speed_score >= 50) buckets.Average++;
      else buckets.Slow++;
    });
    return [
      { name: 'Fast (90+)', value: buckets.Fast, color: 'var(--accent-green)' },
      { name: 'Average (50-89)', value: buckets.Average, color: 'var(--accent-amber)' },
      { name: 'Slow (<50)', value: buckets.Slow, color: 'var(--accent-red)' },
      { name: 'Unknown', value: buckets.Unknown, color: 'var(--text-muted)' },
    ].filter((d) => d.value > 0);
  }, [leads]);

  // Radar chart data for scraping quality
  const radarData = [
    { metric: 'Email', value: scrapingMetrics.emailFoundRate },
    { metric: 'Phone', value: scrapingMetrics.phoneFoundRate },
    { metric: 'Website', value: scrapingMetrics.websiteFoundRate },
    { metric: 'App', value: scrapingMetrics.appFoundRate },
    { metric: 'Email Valid', value: scrapingMetrics.emailValidRate ?? 0 },
    { metric: 'Phone Valid', value: scrapingMetrics.phoneValidRate ?? 0 },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 shimmer rounded-xl w-48" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-[280px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Track scraping quality, outreach performance, and identify winning niches.
        </p>
      </motion.div>

      {/* Scraping Quality Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Email Found', value: `${scrapingMetrics.emailFoundRate}%`, icon: Mail, color: 'var(--accent-blue)' },
          { label: 'Phone Found', value: `${scrapingMetrics.phoneFoundRate}%`, icon: Phone, color: 'var(--accent-green)' },
          { label: 'Website Found', value: `${scrapingMetrics.websiteFoundRate}%`, icon: Globe, color: 'var(--accent-purple)' },
          { label: 'Has App', value: `${scrapingMetrics.appFoundRate}%`, icon: Smartphone, color: 'var(--accent-amber)' },
          { label: 'Email Valid', value: scrapingMetrics.emailValidRate !== null ? `${scrapingMetrics.emailValidRate}%` : 'N/A', icon: CheckCircle2, color: 'var(--accent-green)' },
          { label: 'Phone Valid', value: scrapingMetrics.phoneValidRate !== null ? `${scrapingMetrics.phoneValidRate}%` : 'N/A', icon: CheckCircle2, color: 'var(--accent-green)' },
        ].map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="surface-card p-3 text-center"
          >
            <metric.icon size={16} style={{ color: metric.color, margin: '0 auto 6px' }} />
            <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{metric.value}</div>
            <div className="text-[10px] font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>{metric.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Niche Performance */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Response Rate by Niche
          </h3>
          {nichePerformance.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={nichePerformance.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <YAxis type="category" dataKey="niche" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="responseRate" name="Response %" fill="var(--accent-green)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-sm" style={{ color: 'var(--text-muted)' }}>
              Contact some leads to see niche performance data
            </div>
          )}
        </motion.div>

        {/* City Performance */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Leads by City
          </h3>
          {cityPerformance.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={cityPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="city" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="total" name="Total" fill="var(--accent-blue)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="replied" name="Replied" fill="var(--accent-green)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-sm" style={{ color: 'var(--text-muted)' }}>
              Run searches to see city data
            </div>
          )}
        </motion.div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pitch Effectiveness */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Pitch Angle Effectiveness
          </h3>
          <div className="space-y-3">
            {pitchEffectiveness.length > 0 ? pitchEffectiveness.map((p) => (
              <div key={p.angle}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{p.angle}</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.responseRate}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${p.responseRate}%` }}
                    transition={{ duration: 0.8, delay: 0.5 }}
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, var(--accent-gradient-from), var(--accent-gradient-to))' }}
                  />
                </div>
              </div>
            )) : (
              <div className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>No pitch data yet</div>
            )}
          </div>
        </motion.div>

        {/* Speed Distribution */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Website Speed Distribution
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={speedDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                {speedDistribution.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            {speedDistribution.map((item) => (
              <div key={item.name} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                {item.name} ({item.value})
              </div>
            ))}
          </div>
        </motion.div>

        {/* Scraping Quality Radar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Data Quality Radar
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border-subtle)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Radar dataKey="value" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Tech Stack Distribution */}
      {techDistribution.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="surface-card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>
            Tech Stack Distribution (Top 10)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={techDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="count" fill="var(--accent-amber)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </div>
  );
}
