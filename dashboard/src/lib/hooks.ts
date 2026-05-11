'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import type { Lead, Search, KPIData, LeadStatus, SearchRequest, SearchPreset, ContactLog, ContactChannel, ContactOutcome } from '@/types';

// ── Leads ──
export function useLeads(filters?: { status?: LeadStatus; searchId?: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('ms_leads')
      .select('*, search:ms_searches(*)')
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.searchId) query = query.eq('search_id', filters.searchId);

    const { data, error } = await query;
    if (error) {
      console.error('[useLeads] supabase error:', error);
    } else if (data) {
      setLeads(data as Lead[]);
    }
    setLoading(false);
  }, [filters?.status, filters?.searchId]);

  useEffect(() => {
    fetchLeads();
    const handler = () => fetchLeads();
    window.addEventListener('ms-data-refresh', handler);
    return () => window.removeEventListener('ms-data-refresh', handler);
  }, [fetchLeads]);

  // Real-time subscription - stream individual changes instead of refetching all
  useEffect(() => {
    const channel = supabase
      .channel('ms_leads_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ms_leads' }, async (payload) => {
        // Fetch the full lead with joined search data
        const { data } = await supabase
          .from('ms_leads')
          .select('*, search:ms_searches(*)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setLeads(prev => {
            if (prev.some(l => l.id === data.id)) return prev;
            return [data as Lead, ...prev];
          });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ms_leads' }, async (payload) => {
        const { data } = await supabase
          .from('ms_leads')
          .select('*, search:ms_searches(*)')
          .eq('id', payload.new.id)
          .single();
        if (data) {
          setLeads(prev => prev.map(l => l.id === data.id ? data as Lead : l));
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ms_leads' }, (payload) => {
        setLeads(prev => prev.filter(l => l.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return { leads, loading, refetch: fetchLeads };
}

// ── Searches ──
export function useSearches() {
  const [searches, setSearches] = useState<Search[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSearches = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ms_searches')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[useSearches] supabase error:', error);
    } else if (data) {
      setSearches(data as Search[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSearches();
    const handler = () => fetchSearches();
    window.addEventListener('ms-data-refresh', handler);
    return () => window.removeEventListener('ms-data-refresh', handler);
  }, [fetchSearches]);

  useEffect(() => {
    const channel = supabase
      .channel('ms_searches_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ms_searches' }, () => {
        fetchSearches();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchSearches]);

  return { searches, loading, refetch: fetchSearches };
}

// ── Search Requests ──
export function useSearchRequests() {
  const [requests, setRequests] = useState<SearchRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ms_search_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[useSearchRequests] supabase error:', error);
    } else if (data) {
      setRequests(data as SearchRequest[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
    const channel = supabase
      .channel('ms_search_requests_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ms_search_requests' }, () => {
        fetchRequests();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchRequests]);

  return { requests, loading, refetch: fetchRequests };
}

// ── Search Presets ──
export function useSearchPresets() {
  const [presets, setPresets] = useState<SearchPreset[]>([]);

  const fetchPresets = useCallback(async () => {
    const { data } = await supabase
      .from('ms_search_presets')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setPresets(data as SearchPreset[]);
  }, []);

  useEffect(() => { fetchPresets(); }, [fetchPresets]);

  return { presets, refetch: fetchPresets };
}

// ── Contact Log ──
export function useContactLog(leadId: string) {
  const [logs, setLogs] = useState<ContactLog[]>([]);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from('ms_contact_log')
      .select('*')
      .eq('lead_id', leadId)
      .order('contacted_at', { ascending: false });
    if (data) setLogs(data as ContactLog[]);
  }, [leadId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return { logs, refetch: fetchLogs };
}

// ── KPIs ──
export function useKPIs(leads: Lead[]): KPIData {
  const scoredLeads = leads.filter(l => l.opportunity_score !== null);
  return {
    totalLeads: leads.length,
    leadsContacted: leads.filter((l) => l.status !== 'new').length,
    responseRate: leads.length
      ? Math.round(
          (leads.filter((l) => l.status === 'replied' || l.status === 'converted').length /
            Math.max(leads.filter((l) => l.status !== 'new').length, 1)) *
            100
        )
      : 0,
    conversionRate: leads.length
      ? Math.round(
          (leads.filter((l) => l.status === 'converted').length / Math.max(leads.length, 1)) * 100
        )
      : 0,
    emailsFound: leads.filter((l) => l.emails.length > 0).length,
    websitesFound: leads.filter((l) => l.has_website).length,
    avgRating: leads.length
      ? Math.round(
          (leads.reduce((sum, l) => sum + (l.rating || 0), 0) /
            leads.filter((l) => l.rating).length) *
            10
        ) / 10
      : 0,
    totalSearches: new Set(leads.map((l) => l.search_id)).size,
    badLeads: leads.filter((l) => l.status === 'bad_lead').length,
    noResponse: leads.filter((l) => l.status === 'no_response').length,
    withoutWebsite: leads.filter((l) => !l.has_website).length,
    withoutApp: leads.filter((l) => !l.has_mobile_app).length,
    avgOpportunityScore: scoredLeads.length
      ? Math.round(scoredLeads.reduce((sum, l) => sum + (l.opportunity_score || 0), 0) / scoredLeads.length)
      : 0,
    followUpsDue: leads.filter((l) => l.follow_up_at && new Date(l.follow_up_at) <= new Date()).length,
  };
}

// ── Actions ──
export async function updateLeadStatus(id: string, status: LeadStatus) {
  const updates: Record<string, unknown> = { status };
  if (status === 'contacted') {
    updates.contacted_at = new Date().toISOString();
    updates.last_contacted_at = new Date().toISOString();
    // Set follow-up reminder (default 7 days)
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 7);
    updates.follow_up_at = followUpDate.toISOString();
    updates.follow_up_count = 0;
  }
  if (status === 'replied') updates.replied_at = new Date().toISOString();
  if (status === 'converted') {
    updates.converted_at = new Date().toISOString();
    updates.follow_up_at = null; // Clear follow-up
  }
  if (status === 'bad_lead' || status === 'no_response') {
    updates.follow_up_at = null; // Clear follow-up
  }

  const { error } = await supabase.from('ms_leads').update(updates).eq('id', id);
  if (!error) {
    await supabase.from('ms_analytics_events').insert({
      lead_id: id,
      event_type: 'status_changed',
      metadata: { new_status: status },
    });
  }
  return !error;
}

export async function updateLeadField(id: string, field: string, value: unknown) {
  const { error } = await supabase.from('ms_leads').update({ [field]: value }).eq('id', id);
  return !error;
}

export async function bulkUpdateLeadStatus(ids: string[], status: LeadStatus) {
  const updates: Record<string, unknown> = { status };
  if (status === 'contacted') {
    updates.contacted_at = new Date().toISOString();
    updates.last_contacted_at = new Date().toISOString();
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 7);
    updates.follow_up_at = followUpDate.toISOString();
  }
  if (status === 'bad_lead' || status === 'no_response') {
    updates.follow_up_at = null;
  }

  const { error } = await supabase.from('ms_leads').update(updates).in('id', ids);
  if (!error) {
    const events = ids.map(id => ({
      lead_id: id,
      event_type: 'status_changed',
      metadata: { new_status: status, bulk: true },
    }));
    await supabase.from('ms_analytics_events').insert(events);
  }
  return !error;
}

export async function logEvent(leadId: string | null, eventType: string, metadata?: Record<string, unknown>) {
  await supabase.from('ms_analytics_events').insert({
    lead_id: leadId,
    event_type: eventType,
    metadata: metadata || {},
  });
}

export async function logContact(leadId: string, channel: ContactChannel, outcome?: ContactOutcome, notes?: string) {
  await supabase.from('ms_contact_log').insert({
    lead_id: leadId,
    channel,
    outcome: outcome || null,
    notes: notes || null,
  });
  // Also update lead's contact tracking fields
  await supabase.from('ms_leads').update({
    contact_channel: channel,
    contact_outcome: outcome || null,
    last_contacted_at: new Date().toISOString(),
  }).eq('id', leadId);
}

export async function createSearchRequest(niche: string, city: string, options?: {
  country?: string;
  maxResults?: number;
  skipCrawl?: boolean;
  skipAnalysis?: boolean;
  skipAi?: boolean;
}) {
  const { data, error } = await supabase
    .from('ms_search_requests')
    .insert({
      niche,
      city,
      country: options?.country || null,
      max_results: options?.maxResults || 100,
      skip_crawl: options?.skipCrawl || false,
      skip_analysis: options?.skipAnalysis || false,
      skip_ai: options?.skipAi || false,
    })
    .select()
    .single();

  return { data: data as SearchRequest | null, error };
}

export async function saveSearchPreset(name: string, niche: string, city: string, country?: string, maxResults?: number) {
  const { error } = await supabase.from('ms_search_presets').insert({
    name,
    niche,
    city,
    country: country || null,
    max_results: maxResults || 100,
  });
  return !error;
}

export async function deleteSearchPreset(id: string) {
  const { error } = await supabase.from('ms_search_presets').delete().eq('id', id);
  return !error;
}

// ── Follow-up System ──
export async function processFollowUps() {
  const now = new Date().toISOString();
  // Find leads that need follow-up
  const { data } = await supabase
    .from('ms_leads')
    .select('id, follow_up_count, follow_up_interval_days')
    .eq('status', 'contacted')
    .lte('follow_up_at', now);

  if (!data || data.length === 0) return 0;

  // Move them to follow_up status
  const ids = data.map(l => l.id);
  await supabase
    .from('ms_leads')
    .update({ status: 'follow_up' as LeadStatus })
    .in('id', ids);

  // Log events
  const events = ids.map(id => ({
    lead_id: id,
    event_type: 'follow_up_triggered',
    metadata: {},
  }));
  await supabase.from('ms_analytics_events').insert(events);

  return ids.length;
}

export async function snoozeFollowUp(id: string, days: number = 7) {
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + days);

  // Get current follow-up count
  const { data: lead } = await supabase
    .from('ms_leads')
    .select('follow_up_count')
    .eq('id', id)
    .single();

  await supabase.from('ms_leads').update({
    status: 'contacted' as LeadStatus,
    follow_up_at: followUpDate.toISOString(),
    follow_up_count: (lead?.follow_up_count || 0) + 1,
    follow_up_interval_days: days,
  }).eq('id', id);
}
