/**
 * Agent 任务驱动型状态机
 */

export type AgentTask =
  | 'IDLE'
  | 'INTENT_CONFIRM'
  | 'JOIN_LOGIC_CONFIRM'   // 维度合入：显式合并逻辑确认
  | 'MAPPING_ALIGN'
  | 'AUDIT_REPORT'        // 全能审计：ERROR/IDENTITY_GAP 阻塞，强制拦截
  | 'HEALTH_CHECK'        // 数据体检：发现脏数据时拦截（兼容）
  | 'DIFF_PREVIEW'        // 维度合入：交互式差异对比
  | 'CONFLICT_RESOLVE'
  | 'FINAL_PREVIEW'
  | 'SKILL_SAVE_PROMPT'    // 任务结项：是否保存为技能
  | 'SKILL_APPLY_CONFIRM'; // 上传后：检测到匹配技能，是否应用

export type IntentType = 'append' | 'expand';

/** 维度合入时的匹配统计 */
export interface DiffMatchStats {
  matchedCount: number;      // 匹配成功行数
  newOnlyCount: number;      // 新表独有（将新增行）
  baseOnlyCount: number;     // 底表独有（保持原样）
  matchedRows: Array<{ baseRowIndex: number; productName: string }>;
  newOnlyProducts: string[];
  baseOnlyProductNames: string[];
}

export interface FieldMapping {
  newCol: string;
  baseCol: string;
}

export interface ConflictItem {
  rowIndex: number;
  colKey: string;
  baseValue: string | null;
  newValue: string | null;
  primaryKeyValues: Record<string, string>;
}
