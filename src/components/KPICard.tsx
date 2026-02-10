/**
 * 关键指标卡片：专业数据报告风格
 * 左列青蓝 (Cyan)、右列深蓝 (Royal Blue)，图标与数值同色，说明文字加粗深灰
 */

import type { ReactNode } from 'react';

const COLORS = {
  cyan: 'text-cyan-500',      // 左列 #06B6D4
  royalBlue: 'text-blue-600', // 右列 #2563EB / #3B82F6
} as const;

export interface KPICardProps {
  icon: ReactNode;
  value: string;
  label: string;
  /** 左列青蓝，右列深蓝 */
  variant?: 'cyan' | 'royalBlue';
}

export function KPICard({ icon, value, label, variant = 'royalBlue' }: KPICardProps) {
  const colorClass = COLORS[variant];
  return (
    <div className="flex flex-col items-start text-left py-4">
      <div className={`flex shrink-0 items-center justify-center mb-2 ${colorClass}`} aria-hidden>
        {icon}
      </div>
      <div className={`text-4xl font-extrabold tracking-tight sm:text-5xl ${colorClass}`}>
        {value}
      </div>
      <div className="mt-1 text-sm font-bold text-gray-700">
        {label}
      </div>
    </div>
  );
}
