import { useState } from 'react';
import { Search, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface MatchResult {
  company_name: string;
  website_domain: string;
  primary_phone: string | null;
  primary_email: string | null;
  facebook_url: string | null;
  short_description: string | null;
  match_details: {
    confidence_score: number;
    match_quality: string;
    matched_on: string[];
    attributes: Record<string, { confidence_score: number; match_type: string; value: string }>;
  };
}

export function MatchTester() {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [facebook, setFacebook] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMatch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          website,
          phone_number: phone,
          facebook_profile: facebook,
        }),
      });

      if (res.status === 404) {
        setError('No matching company found');
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch {
      setError('API request failed. Make sure the API server is running on port 3000.');
    } finally {
      setLoading(false);
    }
  };

  const qualityColor: Record<string, string> = {
    VERIFIED: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
    HIGH: 'text-blue-700 bg-blue-50 border border-blue-200',
    MEDIUM: 'text-amber-700 bg-amber-50 border border-amber-200',
    LOW: 'text-orange-700 bg-orange-50 border border-orange-200',
    UNCERTAIN: 'text-red-700 bg-red-50 border border-red-200',
  };

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 bg-[#FBB03B] rounded-none" />
        <h3 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
          <Search size={18} className="text-gray-600" />
          Match & Enrich API Tester
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <input
          type="text"
          placeholder="Company name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-white border border-gray-300 rounded-none px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FBB03B] focus:border-[#FBB03B]"
        />
        <input
          type="text"
          placeholder="Website URL..."
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="bg-white border border-gray-300 rounded-none px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FBB03B] focus:border-[#FBB03B]"
        />
        <input
          type="text"
          placeholder="Phone number..."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="bg-white border border-gray-300 rounded-none px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FBB03B] focus:border-[#FBB03B]"
        />
        <input
          type="text"
          placeholder="Facebook profile..."
          value={facebook}
          onChange={(e) => setFacebook(e.target.value)}
          className="bg-white border border-gray-300 rounded-none px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FBB03B] focus:border-[#FBB03B]"
        />
      </div>

      <button
        onClick={handleMatch}
        disabled={loading || (!name && !website && !phone && !facebook)}
        className="bg-[#0000FF] hover:bg-[#0000cc] disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-none text-sm font-medium transition-colors flex items-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        Match Company
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-none flex items-center gap-2 text-red-700 text-sm">
          <XCircle size={16} />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-600" />
            <span className="text-lg font-semibold text-gray-900">{result.company_name}</span>
            <span className={`px-2 py-0.5 rounded-none text-xs font-semibold ${qualityColor[result.match_details.match_quality] || 'text-gray-500 bg-gray-100 border border-gray-200'}`}>
              {result.match_details.match_quality}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-none p-3">
              <p className="text-gray-500 text-xs uppercase tracking-wide">Confidence</p>
              <p className="text-gray-900 font-bold text-lg">{(result.match_details.confidence_score * 100).toFixed(0)}%</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-none p-3">
              <p className="text-gray-500 text-xs uppercase tracking-wide">Domain</p>
              <p className="text-[#0000FF] text-sm font-mono">{result.website_domain || '—'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-none p-3">
              <p className="text-gray-500 text-xs uppercase tracking-wide">Phone</p>
              <p className="text-gray-900 text-sm">{result.primary_phone || '—'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-none p-3">
              <p className="text-gray-500 text-xs uppercase tracking-wide">Email</p>
              <p className="text-gray-900 text-sm truncate">{result.primary_email || '—'}</p>
            </div>
          </div>

          {result.short_description && (
            <p className="text-gray-700 text-sm bg-white border border-gray-200 rounded-none p-3">
              {result.short_description}
            </p>
          )}

          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">Matched On</p>
            <div className="flex flex-wrap gap-1">
              {result.match_details.matched_on.map((field) => (
                <span key={field} className="px-2 py-0.5 bg-[#FBB03B]/10 text-[#b87a00] border border-[#FBB03B]/30 rounded-none text-xs font-medium">{field}</span>
              ))}
            </div>
          </div>

          {Object.keys(result.match_details.attributes).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-none p-3">
              <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Attribute Confidence Breakdown</p>
              {Object.entries(result.match_details.attributes).map(([attr, info]) => (
                <div key={attr} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span className="text-gray-700">{attr}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{info.match_type}</span>
                    <span className="text-gray-900 font-mono font-semibold">{(info.confidence_score * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
