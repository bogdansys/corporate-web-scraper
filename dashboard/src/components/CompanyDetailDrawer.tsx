import { useEffect, useState } from 'react';
import {
  X, Loader2, ExternalLink, Phone, Mail, MapPin, Globe, Calendar,
  Cpu, Eye, ShieldCheck, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { Company, ProvenanceRecord } from '../lib/supabase';
import { fetchProvenance } from '../lib/supabase';

interface Props {
  company: Company;
  onClose: () => void;
}

function confidenceColor(c: number | null): string {
  if (c === null) return 'bg-gray-200 text-gray-600';
  if (c >= 0.9) return 'bg-emerald-100 text-emerald-700';
  if (c >= 0.7) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function confidenceLabel(c: number | null): string {
  if (c === null) return '—';
  return `${Math.round(c * 100)}%`;
}

export function CompanyDetailDrawer({ company, onClose }: Props) {
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchProvenance(company.id)
      .then(setProvenance)
      .catch(() => setProvenance([]))
      .finally(() => setLoading(false));
  }, [company.id]);

  // Group provenance by field_name
  const grouped = provenance.reduce((acc, r) => {
    (acc[r.field_name] = acc[r.field_name] || []).push(r);
    return acc;
  }, {} as Record<string, ProvenanceRecord[]>);

  const statusColor: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    timeout: 'bg-amber-100 text-amber-700',
    pending: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-xl bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-start justify-between z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {company.commercial_name || company.legal_name || company.domain}
            </h2>
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#0000FF] hover:underline flex items-center gap-1"
            >
              {company.domain} <ExternalLink size={12} />
            </a>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 text-xs font-medium rounded-none ${statusColor[company.crawl_status] || statusColor.pending}`}>
                {company.crawl_status}
              </span>
              {company.crawl_timestamp && (
                <span className="text-xs text-gray-400">
                  {new Date(company.crawl_timestamp).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-none">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Names */}
          {(company.commercial_name || company.legal_name) && (
            <Section title="Company Names">
              {company.commercial_name && (
                <InfoRow label="Commercial" value={company.commercial_name} />
              )}
              {company.legal_name && (
                <InfoRow label="Legal" value={company.legal_name} />
              )}
              {company.all_names.length > 0 && (
                <InfoRow label="All Names" value={company.all_names.join(' | ')} />
              )}
            </Section>
          )}

          {/* Contact */}
          <Section title="Contact Information">
            {company.emails.length > 0 ? (
              <div className="space-y-1">
                {company.emails.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Mail size={14} className="text-gray-400 shrink-0" />
                    <span className="text-gray-700">{e}</span>
                    {i === 0 && <span className="text-xs bg-[#FBB03B]/20 text-[#b87a00] px-1.5">primary</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No emails found</p>
            )}

            {company.phone_numbers.length > 0 ? (
              <div className="space-y-1 mt-2">
                {company.phone_numbers.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Phone size={14} className="text-gray-400 shrink-0" />
                    <span className="text-gray-700 font-mono">{p}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic mt-2">No phones found</p>
            )}

            {company.addresses.length > 0 ? (
              <div className="space-y-1 mt-2">
                {company.addresses.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <MapPin size={14} className="text-gray-400 shrink-0" />
                    <span className="text-gray-700">{a.raw || [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic mt-2">No addresses found</p>
            )}
          </Section>

          {/* Social Links */}
          {Object.keys(company.social_links || {}).length > 0 && (
            <Section title="Social Links">
              <div className="space-y-1">
                {Object.entries(company.social_links).map(([platform, url]) => (
                  <div key={platform} className="flex items-center gap-2 text-sm">
                    <Globe size={14} className="text-gray-400 shrink-0" />
                    <span className="text-gray-500 capitalize w-20">{platform}</span>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="text-[#0000FF] hover:underline truncate">
                      {url}
                    </a>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Technologies */}
          {company.technologies.length > 0 && (
            <Section title="Technologies">
              <div className="flex flex-wrap gap-1.5">
                {company.technologies.map((t) => (
                  <span key={t} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 border border-gray-200 rounded-none flex items-center gap-1">
                    <Cpu size={10} /> {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Metadata */}
          <Section title="Metadata">
            {company.short_description && (
              <InfoRow label="Description" value={company.short_description} />
            )}
            {company.year_founded && (
              <InfoRow label="Year Founded" value={String(company.year_founded)} icon={<Calendar size={14} className="text-gray-400" />} />
            )}
            {company.logo_url && (
              <div className="flex items-center gap-2 text-sm">
                <Eye size={14} className="text-gray-400" />
                <span className="text-gray-500 w-20">Logo</span>
                <a href={company.logo_url.startsWith('http') ? company.logo_url : `https://${company.domain}/${company.logo_url}`}
                  target="_blank" rel="noopener noreferrer" className="text-[#0000FF] hover:underline truncate">
                  {company.logo_url.length > 50 ? company.logo_url.slice(0, 50) + '...' : company.logo_url}
                </a>
              </div>
            )}
          </Section>

          {/* Provenance */}
          <div className="border border-gray-200 rounded-none">
            <button
              onClick={() => setProvenanceOpen(!provenanceOpen)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-[#0000FF]" />
                <span className="text-sm font-semibold text-gray-900">Data Provenance</span>
                <span className="text-xs text-gray-400">({provenance.length} records)</span>
              </div>
              {provenanceOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            {provenanceOpen && (
              <div className="border-t border-gray-200 p-3">
                {loading ? (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <Loader2 size={14} className="animate-spin" /> Loading provenance...
                  </div>
                ) : provenance.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No provenance data available. Run the pipeline to populate.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(grouped).map(([field, records]) => (
                      <div key={field}>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{field}</p>
                        <div className="space-y-1">
                          {records.map((r) => (
                            <div key={r.id} className="bg-gray-50 border border-gray-100 p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-900 font-medium truncate">{r.field_value}</span>
                                <span className={`px-1.5 py-0.5 rounded-none text-xs font-mono shrink-0 ${confidenceColor(r.confidence)}`}>
                                  {confidenceLabel(r.confidence)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-gray-400">
                                <span>{r.extraction_method || '—'}</span>
                                <span>{r.source_element || '—'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm mb-1">
      {icon || <div className="w-3.5" />}
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}
