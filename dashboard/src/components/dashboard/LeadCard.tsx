'use client';

import { Lead } from '@/types';
import StatusBadge from '@/components/ui/StatusBadge';
import { Star, Globe, Mail, Phone, MessageCircle, ExternalLink } from 'lucide-react';
import { getWhatsAppLink, getEmailLink, truncate } from '@/lib/utils';

interface LeadCardProps {
  lead: Lead;
  onClick?: () => void;
  isDragging?: boolean;
}

export default function LeadCard({ lead, onClick, isDragging }: LeadCardProps) {
  const primaryEmail = lead.emails?.[0];

  return (
    <div
      className="p-3.5 rounded-xl cursor-pointer transition-all duration-200"
      style={{
        background: isDragging ? 'var(--bg-hover)' : 'var(--bg-card)',
        border: `1px solid ${isDragging ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
        boxShadow: isDragging ? '0 12px 40px rgba(0,0,0,0.4)' : 'none',
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
      }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {truncate(lead.business_name, 28)}
        </h4>
        <StatusBadge status={lead.status} />
      </div>

      {/* Rating */}
      {lead.rating && (
        <div className="flex items-center gap-1 mb-2">
          <Star size={12} fill="var(--accent-amber)" style={{ color: 'var(--accent-amber)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--accent-amber)' }}>
            {lead.rating}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ({lead.review_count})
          </span>
        </div>
      )}

      {/* Pitch angle tags */}
      {lead.pitch_angles.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {lead.pitch_angles.slice(0, 2).map((angle) => (
            <span
              key={angle}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(124, 92, 252, 0.12)', color: 'var(--accent-purple)' }}
            >
              {angle.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {primaryEmail && (
          <a
            href={getEmailLink(primaryEmail, '', lead.ai_email_draft || '')}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-blue)' }}
            title={`Email: ${primaryEmail}`}
          >
            <Mail size={14} />
          </a>
        )}
        {lead.phone && (
          <a
            href={getWhatsAppLink(lead.phone)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-green)' }}
            title={`WhatsApp: ${lead.phone}`}
          >
            <MessageCircle size={14} />
          </a>
        )}
        {lead.phone && (
          <a
            href={`tel:${lead.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--accent-amber)' }}
            title={`Call: ${lead.phone}`}
          >
            <Phone size={14} />
          </a>
        )}
        {lead.website_url && (
          <a
            href={lead.website_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
            title="Visit website"
          >
            <Globe size={14} />
          </a>
        )}
        {lead.google_maps_url && (
          <a
            href={lead.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg transition-colors hover:opacity-70 ml-auto"
            style={{ color: 'var(--text-muted)' }}
            title="View on Google Maps"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
