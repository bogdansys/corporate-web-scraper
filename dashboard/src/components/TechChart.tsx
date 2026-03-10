import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TechChartProps {
  topTech: [string, number][];
}

export function TechChart({ topTech }: TechChartProps) {
  const data = topTech.map(([name, count]) => ({ name, count }));

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 bg-[#0000FF] rounded-none" />
        <h3 className="text-base font-semibold text-gray-900 tracking-tight">Top Technologies Detected</h3>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 12 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} width={80} />
          <Tooltip
            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 0, color: '#1a1a2e' }}
          />
          <Bar dataKey="count" fill="#0000FF" radius={[0, 0, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
