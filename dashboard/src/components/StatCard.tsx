interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: string;
}

export function StatCard({ title, value, subtitle, icon, color, trend }: StatCardProps) {
  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm font-medium tracking-wide uppercase">{title}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          {subtitle && <p className="text-gray-400 text-xs mt-1">{subtitle}</p>}
          {trend && <p className="text-emerald-600 text-xs mt-1">{trend}</p>}
        </div>
        <div className={`p-2.5 rounded-none bg-white ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
