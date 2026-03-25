'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star, Globe, Mail, Phone, MessageCircle, MapPin, ExternalLink,
  Linkedin, Instagram, Twitter, Facebook, Smartphone, Gauge,
  Copy, Check, AlertTriangle, CheckCircle2, XCircle, Code2, Send,
  RefreshCw, Sparkles, ChevronDown, ChevronUp, Loader2, Clock,
  Target, Zap,
} from 'lucide-react';
import { Lead, LeadStatus, LEAD_STATUS_CONFIG, PITCH_ANGLE_LABELS, ScoreBreakdown, SCORE_FACTOR_LABELS,
  ContactChannel, ContactOutcome, SERVICE_TYPE_LABELS, ServiceType } from '@/types';
import { updateLeadStatus, updateLeadField, logEvent, logContact, useContactLog, snoozeFollowUp } from '@/lib/hooks';
import { getWhatsAppLink, getEmailLink, getSpeedScoreColor } from '@/lib/utils';
import { getAllSettings } from '@/lib/settings';
import StatusBadge from '@/components/ui/StatusBadge';
import ScoreGauge from '@/components/ui/ScoreGauge';

interface LeadDetailProps {
  lead: Lead;
  onUpdate: () => void;
}

export default function LeadDetail({ lead, onUpdate }: LeadDetailProps) {
  const [notes, setNotes] = useState(lead.notes || '');
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [showAIControls, setShowAIControls] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedTones, setSelectedTones] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceType | ''>('');
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState<Record<string, string>>({});
  // Contact tracking
  const [showContactLog, setShowContactLog] = useState(false);
  const [contactChannel, setContactChannel] = useState<ContactChannel>('email');
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome | ''>('');
  const [contactNotes, setContactNotes] = useState('');
  const { logs: contactLogs, refetch: refetchLogs } = useContactLog(lead.id);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleStatusChange = async (status: LeadStatus) => {
    await updateLeadStatus(lead.id, status);
    onUpdate();
  };

  const handleValidityToggle = async (field: 'email_valid' | 'phone_valid' | 'website_valid', value: boolean | null) => {
    await updateLeadField(lead.id, field, value);
    await logEvent(lead.id, `${field}_changed`, { value });
    onUpdate();
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    await updateLeadField(lead.id, 'notes', notes);
    setSaving(false);
  };

  const handleRegenerate = async (channel: string) => {
    setRegenerating(channel);
    try {
      const settings = await getAllSettings();
      const res = await fetch('/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead,
          channel,
          customPrompt: customPrompt || undefined,
          toneModifiers: selectedTones.length > 0 ? selectedTones : undefined,
          serviceType: selectedService || undefined,
          settings,
        }),
      });
      const data = await res.json();
      if (data.message) {
        setGeneratedMessage(prev => ({ ...prev, [channel]: data.message }));
      }
    } catch {
      // Silently fail
    }
    setRegenerating(null);
  };

  const handleLogContact = async () => {
    await logContact(lead.id, contactChannel, contactOutcome as ContactOutcome || undefined, contactNotes || undefined);
    setContactNotes('');
    setContactOutcome('');
    refetchLogs();
  };

  const handleSnooze = async (days: number) => {
    await snoozeFollowUp(lead.id, days);
    onUpdate();
  };

  const primaryEmail = lead.emails?.[0];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{lead.business_name}</h2>
            {lead.address && (
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin size={12} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{lead.address}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lead.opportunity_score !== null && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer"
                style={{
                  background: `rgba(124, 92, 252, ${lead.opportunity_score > 60 ? 0.2 : 0.1})`,
                  border: '1px solid rgba(124, 92, 252, 0.3)',
                }}
              >
                <Target size={14} style={{ color: 'var(--accent-primary)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--accent-primary)' }}>
                  {lead.opportunity_score}
                </span>
                {showScoreBreakdown ? <ChevronUp size={12} style={{ color: 'var(--accent-primary)' }} /> : <ChevronDown size={12} style={{ color: 'var(--accent-primary)' }} />}
              </motion.button>
            )}
            {lead.rating && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg" style={{ background: 'rgba(251, 191, 36, 0.12)' }}>
                <Star size={14} fill="var(--accent-amber)" style={{ color: 'var(--accent-amber)' }} />
                <span className="text-sm font-bold" style={{ color: 'var(--accent-amber)' }}>{lead.rating}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({lead.review_count})</span>
              </div>
            )}
          </div>
        </div>

        {/* Status selector */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(LEAD_STATUS_CONFIG).map(([key, config]) => (
            <button
              key={key}
              onClick={() => handleStatusChange(key as LeadStatus)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                background: lead.status === key ? config.bgColor : 'var(--bg-input)',
                color: lead.status === key ? config.color : 'var(--text-muted)',
                border: `1px solid ${lead.status === key ? config.color + '40' : 'var(--border-subtle)'}`,
              }}
            >
              {config.label}
            </button>
          ))}
        </div>

        {/* Follow-up snooze (when in follow_up status) */}
        {lead.status === 'follow_up' && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 p-3 rounded-xl"
            style={{ background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)' }}
          >
            <Clock size={14} style={{ color: '#f97316' }} />
            <span className="text-xs font-medium" style={{ color: '#f97316' }}>
              Follow-up #{(lead.follow_up_count || 0) + 1} due
            </span>
            <div className="ml-auto flex gap-1">
              {[3, 7, 14].map(d => (
                <button key={d} onClick={() => handleSnooze(d)}
                  className="px-2 py-1 rounded text-[10px] font-medium transition-all hover:scale-105"
                  style={{ background: 'rgba(249, 115, 22, 0.15)', color: '#f97316' }}>
                  {d}d
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Score Breakdown (expandable) */}
      <AnimatePresence>
        {showScoreBreakdown && lead.score_breakdown && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <Zap size={14} style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Opportunity Diagnostic</span>
              </div>

              {/* Score gauge */}
              <div className="flex flex-col items-center py-2 gap-1">
                <ScoreGauge score={lead.opportunity_score} size={100} strokeWidth={8} label="Opportunity" highIsGood={true} />
                <span className="text-[9px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  Higher = better chance to close
                </span>
              </div>

              {/* Factor bars */}
              <div className="space-y-1.5">
                {Object.entries(lead.score_breakdown as ScoreBreakdown).map(([key, value]) => {
                  const factor = SCORE_FACTOR_LABELS[key as keyof ScoreBreakdown];
                  if (!factor) return null;
                  const pct = (value / factor.maxPoints) * 100;
                  return (
                    <div key={key} className="group" title={factor.description}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {factor.label}
                        </span>
                        <span className="text-[10px] font-bold" style={{
                          color: pct >= 70 ? 'var(--accent-green)' : pct >= 30 ? 'var(--accent-amber)' : 'var(--text-muted)',
                        }}>
                          {value}/{factor.maxPoints}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: 0.02 * Object.keys(lead.score_breakdown!).indexOf(key) }}
                          className="h-full rounded-full"
                          style={{
                            background: pct >= 70
                              ? 'var(--accent-green)'
                              : pct >= 30
                              ? 'var(--accent-amber)'
                              : 'var(--border-medium)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Service opportunities */}
              {lead.service_opportunities && lead.service_opportunities.length > 0 && (
                <div className="pt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Recommended Services
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {lead.service_opportunities.map((svc) => (
                      <span key={svc} className="badge" style={{ background: 'rgba(124, 92, 252, 0.12)', color: 'var(--accent-primary)' }}>
                        {SERVICE_TYPE_LABELS[svc as ServiceType] || svc}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glow-line" />

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 gap-2">
        {primaryEmail && (
          <a href={getEmailLink(primaryEmail, `Regarding ${lead.business_name}`, lead.ai_email_draft || '')}
            onClick={() => logEvent(lead.id, 'email_sent')}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: 'rgba(96, 165, 250, 0.12)', color: 'var(--accent-blue)', border: '1px solid rgba(96, 165, 250, 0.2)' }}>
            <Mail size={15} /> Send Email
          </a>
        )}
        {lead.phone && (
          <a href={getWhatsAppLink(lead.phone)} target="_blank" rel="noopener noreferrer"
            onClick={() => logEvent(lead.id, 'whatsapp_sent')}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: 'rgba(52, 211, 153, 0.12)', color: 'var(--accent-green)', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
            <MessageCircle size={15} /> WhatsApp
          </a>
        )}
        {lead.phone && (
          <a href={`tel:${lead.phone}`} onClick={() => logEvent(lead.id, 'call_made')}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: 'rgba(251, 191, 36, 0.12)', color: 'var(--accent-amber)', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
            <Phone size={15} /> Call
          </a>
        )}
        {lead.website_url && (
          <a href={lead.website_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            <Globe size={15} /> Website
          </a>
        )}
      </div>

      {/* Contact Info */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Contact Info</h4>
        <div className="space-y-1.5">
          {lead.emails.map((email, i) => (
            <div key={i} className="flex items-center justify-between p-2.5 rounded-xl" style={{ background: 'var(--bg-input)' }}>
              <div className="flex items-center gap-2">
                <Mail size={13} style={{ color: 'var(--accent-blue)' }} />
                <span className="text-sm">{email}</span>
              </div>
              <button onClick={() => copyToClipboard(email, `email-${i}`)} className="p-1">
                {copied === `email-${i}` ? <Check size={14} style={{ color: 'var(--accent-green)' }} /> : <Copy size={14} style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>
          ))}
          {lead.phone && (
            <div className="flex items-center justify-between p-2.5 rounded-xl" style={{ background: 'var(--bg-input)' }}>
              <div className="flex items-center gap-2">
                <Phone size={13} style={{ color: 'var(--accent-green)' }} />
                <span className="text-sm">{lead.phone}</span>
              </div>
              <button onClick={() => copyToClipboard(lead.phone!, 'phone')} className="p-1">
                {copied === 'phone' ? <Check size={14} style={{ color: 'var(--accent-green)' }} /> : <Copy size={14} style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Social links */}
      {Object.keys(lead.social_links).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Social Links</h4>
          <div className="flex gap-2">
            {lead.social_links.linkedin && (
              <a href={lead.social_links.linkedin} target="_blank" rel="noopener noreferrer"
                className="p-2.5 rounded-xl transition-all hover:scale-110"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                <Linkedin size={16} style={{ color: '#0a66c2' }} />
              </a>
            )}
            {lead.social_links.instagram && (
              <a href={lead.social_links.instagram} target="_blank" rel="noopener noreferrer"
                className="p-2.5 rounded-xl transition-all hover:scale-110"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                <Instagram size={16} style={{ color: '#e4405f' }} />
              </a>
            )}
            {lead.social_links.twitter && (
              <a href={lead.social_links.twitter} target="_blank" rel="noopener noreferrer"
                className="p-2.5 rounded-xl transition-all hover:scale-110"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                <Twitter size={16} style={{ color: '#1da1f2' }} />
              </a>
            )}
            {lead.social_links.facebook && (
              <a href={lead.social_links.facebook} target="_blank" rel="noopener noreferrer"
                className="p-2.5 rounded-xl transition-all hover:scale-110"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                <Facebook size={16} style={{ color: '#1877f2' }} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Website Analysis */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Website Analysis</h4>
        {!lead.has_website ? (
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.15)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--accent-red)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>No website found</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>This business has no web presence — strong pitch opportunity.</p>
            </div>
          </div>
        ) : lead.page_speed_score === null && lead.mobile_friendly === null ? (
          <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--bg-input)' }}>
            <Gauge size={18} style={{ color: 'var(--text-muted)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Not analyzed yet</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Speed and mobile data will appear once PageSpeed analysis completes.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <ScoreGauge score={lead.page_speed_score} label="Speed" highIsGood={false} />
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--bg-input)' }}>
                <Smartphone size={20} style={{
                  color: lead.mobile_friendly === null ? 'var(--text-muted)' : lead.mobile_friendly ? 'var(--accent-green)' : 'var(--accent-red)',
                }} />
              </div>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {lead.mobile_friendly === null ? 'Mobile' : lead.mobile_friendly ? 'Responsive' : 'Not Mobile'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--bg-input)' }}>
                <Smartphone size={20} style={{
                  color: lead.has_mobile_app ? 'var(--accent-green)' : 'var(--accent-red)',
                }} />
              </div>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {lead.has_mobile_app ? 'Has App' : 'No App'}
              </span>
            </div>
          </div>
        )}

        {lead.tech_stack.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Code2 size={13} style={{ color: 'var(--text-muted)' }} />
            {lead.tech_stack.map((tech, i) => (
              <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-md"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                {tech}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Pitch angles */}
      {lead.pitch_angles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pitch Angles</h4>
          <div className="flex flex-wrap gap-1.5">
            {lead.pitch_angles.map((angle) => (
              <span key={angle} className="badge" style={{ background: 'rgba(124, 92, 252, 0.12)', color: 'var(--accent-purple)' }}>
                {PITCH_ANGLE_LABELS[angle]}
              </span>
            ))}
          </div>
          {lead.pitch_summary && (
            <p className="text-sm p-3 rounded-xl" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {lead.pitch_summary}
            </p>
          )}
        </div>
      )}

      {/* AI Messages with Regeneration */}
      {(() => {
        const sections = parseAIDraft(lead.ai_email_draft || '');
        const hasAny = sections.email || sections.whatsapp || sections.linkedin;
        const channels = [
          { key: 'email', label: 'Email', icon: <Mail size={13} />, color: 'var(--accent-blue)', content: sections.email },
          { key: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle size={13} />, color: 'var(--accent-green)', content: sections.whatsapp },
          { key: 'linkedin', label: 'LinkedIn', icon: <Linkedin size={13} />, color: '#0a66c2', content: sections.linkedin },
        ];

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                AI-Generated Messages
              </h4>
              <Sparkles size={13} style={{ color: 'var(--accent-purple)' }} />
            </div>

            {channels.map(ch => {
              const content = generatedMessage[ch.key] || ch.content;
              if (!content && !hasAny) return null;

              return (
                <div key={ch.key} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${ch.color}20` }}>
                  <div className="flex items-center justify-between px-3 py-2" style={{ background: `${ch.color}10` }}>
                    <div className="flex items-center gap-2">
                      <span style={{ color: ch.color }}>{ch.icon}</span>
                      <span className="text-xs font-semibold" style={{ color: ch.color }}>{ch.label}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {content && (
                        <button onClick={() => copyToClipboard(content, `ai-${ch.key}`)}
                          className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded transition-colors"
                          style={{ color: 'var(--text-muted)' }}>
                          {copied === `ai-${ch.key}` ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                        </button>
                      )}
                      <button
                        onClick={() => setShowAIControls(showAIControls === ch.key ? null : ch.key)}
                        className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded transition-colors"
                        style={{ color: ch.color }}>
                        <RefreshCw size={10} /> Regenerate
                      </button>
                    </div>
                  </div>

                  {/* AI Controls (expandable) */}
                  <AnimatePresence>
                    {showAIControls === ch.key && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-3 space-y-2" style={{ background: 'var(--bg-secondary)', borderTop: `1px solid ${ch.color}15` }}>
                          {/* Custom prompt */}
                          <input
                            type="text"
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            placeholder="Custom instructions (e.g., 'pitch them a booking app')"
                            className="input-field text-xs"
                          />

                          {/* Tone toggles */}
                          <div className="flex flex-wrap gap-1">
                            {['shorter', 'longer', 'professional', 'casual', 'urgent', 'friendly'].map(tone => (
                              <button key={tone}
                                onClick={() => setSelectedTones(prev =>
                                  prev.includes(tone) ? prev.filter(t => t !== tone) : [...prev, tone]
                                )}
                                className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                                style={{
                                  background: selectedTones.includes(tone) ? `${ch.color}20` : 'var(--bg-input)',
                                  color: selectedTones.includes(tone) ? ch.color : 'var(--text-muted)',
                                  border: `1px solid ${selectedTones.includes(tone) ? `${ch.color}40` : 'var(--border-subtle)'}`,
                                }}>
                                {tone}
                              </button>
                            ))}
                          </div>

                          {/* Service type */}
                          <select
                            value={selectedService}
                            onChange={e => setSelectedService(e.target.value as ServiceType | '')}
                            className="input-field text-xs"
                          >
                            <option value="">Auto-detect service</option>
                            {Object.entries(SERVICE_TYPE_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>

                          <button
                            onClick={() => handleRegenerate(ch.key)}
                            disabled={regenerating === ch.key}
                            className="gradient-btn text-xs w-full flex items-center justify-center gap-2"
                          >
                            {regenerating === ch.key ? (
                              <><Loader2 size={12} className="animate-spin" /> Generating...</>
                            ) : (
                              <><Sparkles size={12} /> Generate {ch.label} Message</>
                            )}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Message content */}
                  {content ? (
                    <motion.div
                      key={content}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm p-3 whitespace-pre-wrap overflow-y-auto"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)', lineHeight: 1.6, maxHeight: '240px' }}
                    >
                      {content}
                    </motion.div>
                  ) : (
                    <div className="text-xs p-3 text-center" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                      No message generated yet. Click Regenerate to create one.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Contact Tracking */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Contact Tracking
          </h4>
          <button onClick={() => setShowContactLog(!showContactLog)}
            className="text-[10px] font-medium px-2 py-0.5 rounded"
            style={{ color: 'var(--accent-primary)', background: 'rgba(124, 92, 252, 0.1)' }}>
            {showContactLog ? 'Hide Log' : `Log (${contactLogs.length})`}
          </button>
        </div>

        {/* Quick log entry */}
        <div className="flex gap-2">
          <select value={contactChannel} onChange={e => setContactChannel(e.target.value as ContactChannel)}
            className="input-field text-xs w-auto">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="linkedin">LinkedIn</option>
            <option value="phone">Phone</option>
            <option value="other">Other</option>
          </select>
          <select value={contactOutcome} onChange={e => setContactOutcome(e.target.value as ContactOutcome | '')}
            className="input-field text-xs w-auto">
            <option value="">Outcome...</option>
            <option value="sent">Sent</option>
            <option value="replied">Replied</option>
            <option value="no_reply">No Reply</option>
            <option value="bounced">Bounced</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
          <button onClick={handleLogContact} className="gradient-btn text-xs flex-shrink-0">
            Log
          </button>
        </div>

        {/* Contact log history */}
        <AnimatePresence>
          {showContactLog && contactLogs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1.5 overflow-hidden"
            >
              {contactLogs.map((log, i) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-2 rounded-lg text-xs"
                  style={{ background: 'var(--bg-input)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-medium" style={{ color: 'var(--text-secondary)' }}>{log.channel}</span>
                    {log.outcome && (
                      <span className="badge text-[10px]" style={{
                        background: log.outcome === 'replied' || log.outcome === 'positive' ? 'rgba(52, 211, 153, 0.12)' : 'rgba(107, 114, 128, 0.12)',
                        color: log.outcome === 'replied' || log.outcome === 'positive' ? 'var(--accent-green)' : 'var(--text-muted)',
                      }}>
                        {log.outcome}
                      </span>
                    )}
                  </div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {new Date(log.contacted_at).toLocaleDateString()}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Feedback / Validity */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Data Quality</h4>
        <div className="space-y-2">
          {primaryEmail && (
            <ValidityRow label="Email Valid?" value={lead.email_valid}
              onToggle={(v) => handleValidityToggle('email_valid', v)} />
          )}
          {lead.phone && (
            <ValidityRow label="Phone Valid?" value={lead.phone_valid}
              onToggle={(v) => handleValidityToggle('phone_valid', v)} />
          )}
          {lead.website_url && (
            <ValidityRow label="Website Working?" value={lead.website_valid}
              onToggle={(v) => handleValidityToggle('website_valid', v)} />
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Notes</h4>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about this lead..."
          rows={3}
          className="input-field resize-none"
        />
        <button onClick={handleSaveNotes} disabled={saving} className="gradient-btn text-xs">
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──

function ValidityRow({ label, value, onToggle }: { label: string; value: boolean | null; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl" style={{ background: 'var(--bg-input)' }}>
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex gap-1">
        <button onClick={() => onToggle(true)}
          className="p-1.5 rounded-lg transition-all" style={{
            background: value === true ? 'rgba(52, 211, 153, 0.15)' : 'transparent',
            color: value === true ? 'var(--accent-green)' : 'var(--text-muted)',
          }}><CheckCircle2 size={16} /></button>
        <button onClick={() => onToggle(false)}
          className="p-1.5 rounded-lg transition-all" style={{
            background: value === false ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
            color: value === false ? 'var(--accent-red)' : 'var(--text-muted)',
          }}><XCircle size={16} /></button>
      </div>
    </div>
  );
}

// ── Helpers ──

function parseAIDraft(draft: string): { email: string | null; whatsapp: string | null; linkedin: string | null } {
  const result = { email: null as string | null, whatsapp: null as string | null, linkedin: null as string | null };
  if (!draft) return result;

  const emailMatch = draft.match(/---\s*EMAIL\s*---\n([\s\S]*?)(?=---\s*(?:WHATSAPP|LINKEDIN)\s*---|$)/i);
  const whatsappMatch = draft.match(/---\s*WHATSAPP\s*---\n([\s\S]*?)(?=---\s*(?:EMAIL|LINKEDIN)\s*---|$)/i);
  const linkedinMatch = draft.match(/---\s*LINKEDIN\s*---\n([\s\S]*?)(?=---\s*(?:EMAIL|WHATSAPP)\s*---|$)/i);

  if (emailMatch) result.email = emailMatch[1].trim();
  if (whatsappMatch) result.whatsapp = whatsappMatch[1].trim();
  if (linkedinMatch) result.linkedin = linkedinMatch[1].trim();

  if (!result.email && !result.whatsapp && !result.linkedin) {
    result.email = draft;
  }

  return result;
}
