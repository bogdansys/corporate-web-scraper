import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface FillRateChartProps {
  stats: {
    crawlRate: number;
    phoneRate: number;
    emailRate: number;
    socialRate: number;
    facebookRate: number;
    descriptionRate: number;
    addressRate: number;
  };
}

const COLORS = ['#FBB03B', '#00C9A7', '#0000FF', '#1a1a2e', '#6366f1', '#ec4899', '#f97316'];

export function FillRateChart({ stats }: FillRateChartProps) {
  const data = [
    { name: 'Crawled', rate: stats.crawlRate },
    { name: 'Phone', rate: stats.phoneRate },
    { name: 'Email', rate: stats.emailRate },
    { name: 'Social', rate: stats.socialRate },
    { name: 'Facebook', rate: stats.facebookRate },
    { name: 'Description', rate: stats.descriptionRate },
    { name: 'Address', rate: stats.addressRate },
  ];

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 bg-[#FBB03B] rounded-none" />
        <h3 className="text-base font-semibold text-gray-900 tracking-tight">Data Fill Rates</h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 12 }} />
          <YAxis
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fill: '#6b7280', fontSize: 12 }}
            domain={[0, 1]}
          />
          <Tooltip
            formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, 'Fill Rate']}
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 0, color: '#1a1a2e' }}
          />
          <Bar dataKey="rate" radius={[0, 0, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
