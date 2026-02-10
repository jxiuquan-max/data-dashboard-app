/**
 * AI 数据协作舱 - 主框架
 * 响应式：大屏侧边栏 / 小屏顶部导航；4 步：录入 → 清洗 → 看板 → 导出
 * 步骤切换使用 framer-motion 丝滑平移
 */

import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, Sparkles, LayoutDashboard, Download, Check } from 'lucide-react';

export type StepId = 1 | 2 | 3 | 4;

const STEPS: { id: StepId; label: string; icon: typeof FileUp }[] = [
  { id: 1, label: '录入', icon: FileUp },
  { id: 2, label: '清洗', icon: Sparkles },
  { id: 3, label: '看板', icon: LayoutDashboard },
  { id: 4, label: '导出', icon: Download },
];

export interface AppLayoutProps {
  currentStep: StepId;
  onStepChange: (step: StepId) => void;
  /** 步骤是否可点击（2 需有数据，3/4 需错误为 0） */
  isStepUnlocked: (step: StepId) => boolean;
  children: ReactNode;
}

const contentTransition = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
  transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
};

export function AppLayout({ currentStep, onStepChange, isStepUnlocked, children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-[var(--bg-page)] text-[var(--text-primary)]">
      {/* 侧边栏：md 及以上 */}
      <aside className="hidden md:flex md:w-52 md:shrink-0 md:flex-col md:border-r md:border-[var(--border)] md:bg-[var(--bg-header)]">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            AI 数据协作舱
          </h1>
        </div>
        <nav className="flex flex-col gap-0.5 p-3" aria-label="步骤导航">
          {STEPS.map(({ id, label, icon: Icon }) => {
            const unlocked = isStepUnlocked(id);
            const active = currentStep === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => unlocked && onStepChange(id)}
                disabled={!unlocked}
                className="flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: active ? 'var(--accent)' : unlocked ? 'transparent' : 'transparent',
                  color: active ? '#fff' : unlocked ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-black/10">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span>{label}</span>
                {active && <Check className="ml-auto h-4 w-4" aria-hidden />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* 顶部导航：小屏 */}
      <header className="md:hidden flex flex-col border-b border-[var(--border)] bg-[var(--bg-header)]">
        <div className="p-3">
          <h1 className="text-base font-semibold">AI 数据协作舱</h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="步骤导航">
          {STEPS.map(({ id, label, icon: Icon }) => {
            const unlocked = isStepUnlocked(id);
            const active = currentStep === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => unlocked && onStepChange(id)}
                disabled={!unlocked}
                className="flex shrink-0 items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors disabled:opacity-50"
                style={{
                  background: active ? 'var(--accent)' : unlocked ? 'var(--bg-card)' : 'var(--bg-card)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  boxShadow: active ? 'var(--shadow)' : 'none',
                }}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* 主内容区：丝滑切换 */}
      <main className="flex-1 min-w-0 flex flex-col p-4 md:p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            {...contentTransition}
            className="flex-1 min-h-0 flex flex-col"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
