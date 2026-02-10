/**
 * 与 merger.py 的 schema_report 结构对齐，供前端 AIController 等使用
 */

/** /api/analyze-headers 返回的轻量对比结果（仅表头）；row_count 供合并效果小结使用 */
export interface HeaderAnalyzeFileEntry {
  file: string;
  missing_columns: string[];
  extra_columns: string[];
  error?: string;
  row_count?: number;
}

/** 合并缩略预览（确认对齐前展示 Row 1, Row 2... + New Columns） */
export interface MergePreview {
  columns: string[];
  rows: Record<string, string | null>[];
}

export interface HeaderAnalyzeResult {
  base_columns: string[];
  files: HeaderAnalyzeFileEntry[];
  /** 扩展：策略透明化（analyze-headers 升级后返回） */
  columns_intersection?: string[];
  columns_union?: string[];
  synonym_candidates?: string[][];
  suggested_primary_key?: string[];
  type_conflicts?: unknown[];
  /** 合并提案：建议的合并模式 Union/Intersection */
  suggested_merge_mode?: 'union' | 'intersection';
  /** 潜在重复列名（同义列）分组，用于 AI 文案与展示 */
  duplicate_column_groups?: string[][];
  /** 合并缩略预览（基准左连接风格），确认对齐前展示 */
  preview?: MergePreview;
  /** 文件内容缓存键，merge-and-scan 时优先传此键避免 GC 销毁 */
  cache_key?: string;
}

/** 合并策略：取交集 / 取并集 / 按模板（首文件列为基准） */
export type MergeStrategy = 'intersection' | 'union' | 'template';

/** 合并重复行策略：覆盖（后覆盖前）/ 追加（全部保留）/ 补全（按主键合并填空） */
export type DuplicateRowStrategy = 'overwrite' | 'append' | 'fill';

/** /api/get-scan-rules 返回的扫描规则，供 RuleConfirmation 透明化展示 */
export interface ScanRules {
  required_columns: string[];
  numeric_columns: string[];
  composite_key_columns: string[];
}

/** /api/propose-rules 返回的单条专业规则 */
export interface ProposedRule {
  rule_type: string;
  columns: string[];
  description: string;
  severity: string;
  handling: string;
}

/** /api/propose-rules 返回：basic 基础规则 + proposed 专业规则列表 */
export interface ProposeRulesResult {
  basic: ScanRules;
  proposed: ProposedRule[];
}

export interface SchemaReportTable {
  file: string;
  row_count: number;
  missing_columns: string[];
  extra_columns: string[];
  status: string;
  message?: string;
  error?: string;
}

export interface SchemaReport {
  reference_file?: string;
  reference_columns?: string[];
  tables: SchemaReportTable[];
  merged_row_count?: number;
  fatal_mismatch_count?: number;
  error?: string;
  /** 主键匹配率低于 80% 时的 AI 警告 */
  merge_warning?: string | null;
}
