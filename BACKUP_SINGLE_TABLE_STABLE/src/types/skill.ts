/**
 * 技能实验室：持久化合并配置
 */

import type { IntentType } from './agentTask';

/** 名称映射：新表商品名 -> 底表商品名，用于零人工干预的 100% 匹配 */
export type NameMapping = Record<string, string>;

/** 历史纠错：商品+列+原值 -> 修正值，复用 Skill 时自动应用 */
export interface HistoryFix {
  productName: string;
  colKey: string;
  originalValue: string;
  correctedValue: string;
}

/** 流水线单步：多表链式合并中的一轮合并配方 */
export interface SkillStep {
  /** 表名/阶段名，如：库存表、成本表 */
  name: string;
  /** 新表列 -> 底表列 映射 */
  mapping: Record<string, string>;
  /** 名称替换关系：新表名 -> 底表名 */
  nameMapping?: NameMapping;
  /** 历史纠错：错误原值 -> 修正后值 */
  historyFixes?: HistoryFix[];
  /** 期望的新表列名，用于上传时匹配 */
  expectedColumns?: string[];
}

export interface SavedSkill {
  id: string;
  name: string;
  /** 锚点列（如 商品名称） */
  anchorColumn: string;
  /** 新表列 -> 底表列 映射（单表或最后一轮） */
  mapping: Record<string, string>;
  /** 合并逻辑：追加 or 扩展 */
  intent: IntentType;
  /** 扩展时：新商品是否新增行 */
  addNewRows: boolean;
  /** 期望的新表列名，用于上传时匹配 */
  expectedColumns: string[];
  /** 名称替换关系：新表名 -> 底表名，如 VR头盔 -> VR 虚拟现实头盔，复用 Skill 时自动应用 */
  nameMapping?: NameMapping;
  /** 历史纠错：错误原值 -> 修正后值 的映射，按 商品名+列+原值 匹配后自动替换 */
  historyFixes?: HistoryFix[];
  /** 流水线单步：多表链式合并时，每轮合并的配方 */
  steps?: SkillStep[];
}
