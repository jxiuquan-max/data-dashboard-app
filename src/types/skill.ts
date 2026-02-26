/**
 * 技能实验室：持久化合并配置
 */

import type { IntentType } from './agentTask';

export interface SavedSkill {
  id: string;
  name: string;
  /** 锚点列（如 商品名称） */
  anchorColumn: string;
  /** 新表列 -> 底表列 映射 */
  mapping: Record<string, string>;
  /** 合并逻辑：追加 or 扩展 */
  intent: IntentType;
  /** 扩展时：新商品是否新增行 */
  addNewRows: boolean;
  /** 期望的新表列名，用于上传时匹配 */
  expectedColumns: string[];
}
