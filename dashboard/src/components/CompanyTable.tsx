import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, ChevronRight } from 'lucide-react';
import type { Company } from '../lib/supabase';
import { CompanyDetailDrawer } from './CompanyDetailDrawer';

interface CompanyTableProps {
  companies: Company[];
}

type SortField = 'domain' | 'commercial_name' | 'crawl_status' | 'phone_numbers' | 'technologies';
type SortDir = 'asc' | 'desc';

export function CompanyTable({ companies }: CompanyTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('domain');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const perPage = 15;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies.filter(
      (c) =>
        c.domain.toLowerCase().includes(q) ||
        (c.commercial_name || '').toLowerCase().includes(q) ||
        (c.legal_name || '').toLowerCase().includes(q),
    );
  }, [companies, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'domain':
          cmp = a.domain.localeCompare(b.domain);
          break;
        case 'commercial_name':
          cmp = (a.commercial_name || '').localeCompare(b.commercial_name || '');
          break;
        case 'crawl_status':
          cmp = a.crawl_status.localeCompare(b.crawl_status);
          break;
        case 'phone_numbers':
          cmp = (a.phone_numbers?.length || 0) - (b.phone_numbers?.length || 0);
          break;
        case 'technologies':
          cmp = (a.technologies?.length || 0) - (b.technologies?.length || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const paged = sorted.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(sorted.length / perPage);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  const statusColor: Record<string, string> = {
    success: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
    failed: 'text-red-700 bg-red-50 border border-red-200',
    timeout: 'text-amber-700 bg-amber-50 border border-amber-200',
    pending: 'text-gray-500 bg-gray-100 border border-gray-200',
  };

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 bg-[#FBB03B] rounded-none" />
          <h3 className="text-base font-semibold text-gray-900 tracking-tight">Company Database ({filtered.length})</h3>
        </div>
        <input
          type="text"
          placeholder="Search companies..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="bg-white border border-gray-300 rounded-none px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FBB03B] w-64"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300">
              {[
                { field: 'domain' as SortField, label: 'Domain' },
                { field: 'commercial_name' as SortField, label: 'Company Name' },
                { field: 'crawl_status' as SortField, label: 'Status' },
                { field: 'phone_numbers' as SortField, label: 'Phones' },
                { field: 'technologies' as SortField, label: 'Tech' },
              ].map(({ field, label }) => (
                <th
                  key={field}
                  className="text-left py-2 px-3 text-gray-500 font-medium uppercase text-xs tracking-wide cursor-pointer hover:text-gray-900 select-none"
                  onClick={() => toggleSort(field)}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    <SortIcon field={field} />
                  </span>
                </th>
              ))}
              <th className="text-left py-2 px-3 text-gray-500 font-medium uppercase text-xs tracking-wide">Email</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((c) => (
              <tr
                key={c.domain}
                onClick={() => setSelectedCompany(c)}
                className="border-b border-gray-200 hover:bg-white transition-colors cursor-pointer group"
              >
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1">
                    <ChevronRight size={12} className="text-gray-300 group-hover:text-[#0000FF] transition-colors shrink-0" />
                    <a
                      href={`https://${c.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#0000FF] hover:text-[#0000cc] flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.domain}
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </td>
                <td className="py-2 px-3 text-gray-900 max-w-48 truncate">{c.commercial_name || c.legal_name || '—'}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded-none text-xs font-medium ${statusColor[c.crawl_status] || statusColor.pending}`}>
                    {c.crawl_status}
                  </span>
                </td>
                <td className="py-2 px-3 text-gray-700 font-mono text-xs">
                  {c.phone_numbers?.length > 0 ? c.phone_numbers[0] : '—'}
                </td>
                <td className="py-2 px-3 text-gray-500 text-xs">{c.technologies?.length || 0}</td>
                <td className="py-2 px-3 text-gray-700 text-xs truncate max-w-40">{c.primary_email || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-gray-500 text-xs">
            Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, sorted.length)} of {sorted.length}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded-none disabled:opacity-30 hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded-none disabled:opacity-30 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Company detail drawer */}
      {selectedCompany && (
        <CompanyDetailDrawer
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}
    </div>
  );
}
