/**
 * 拟人化 AI 消息生成器：根据当前阶段（上传、预审、诊断、修复完成）返回口语化描述文案。
 */

import type { HealthManifest } from '../DataFixer';
import type { SchemaReport, HeaderAnalyzeResult, ScanRules, ProposeRulesResult } from '../types/schemaReport';

export type AIMessageStage = 'upload' | 'analyzing_headers' | 'structure_confirm' | 'preview' | 'rules' | 'diagnosis' | 'complete' | 'analysis_pilot';

export interface AIMessageData {
  schema_report?: SchemaReport | null;
  health_manifest?: HealthManifest | null;
  header_report?: HeaderAnalyzeResult | null;
  scan_rules?: ScanRules | null;
  /** 专业规则确认阶段：propose-rules 返回，用于生成「异常值/日期格式」引导语 */
  propose_result?: ProposeRulesResult | null;
  merged?: { columns: string[]; rows: unknown[] };
  remainingErrorCount?: number;
}

/**
 * 根据阶段与上下文生成拟人化 AI 文案。
 * - upload: 数据刚上传/合并完成
 * - analyzing_headers: 正在扫描表头、对比差异
 * - preview: 预审工作台，展示对齐计划
 * - rules: 规则确认，展示诊断方案
 * - diagnosis: 正在诊断/修复中
 * - complete: 错误已清零，标准对齐完成
 */
export function generateAIMessage(stage: AIMessageStage, data: AIMessageData): string {
  const { schema_report, health_manifest, header_report, scan_rules, propose_result, merged, remainingErrorCount } = data;

  if (stage === 'analyzing_headers') {
    return '正在扫描表头… 正在对比差异…';
  }

  if (stage === 'structure_confirm') {
    const pk = header_report?.suggested_primary_key ?? [];
    const pkDesc = pk.length ? `「${pk.join('」「')}」` : '未推断';
    const inter = header_report?.columns_intersection?.length ?? 0;
    const union = header_report?.columns_union?.length ?? 0;
    const suggested = header_report?.suggested_merge_mode ?? 'intersection';
    const why =
      suggested === 'union'
        ? '因为各文件列差异较大，建议取并集以保留全部列；'
        : '因为各文件共有列较多，建议取交集保持简洁；';
    return `结构确认：${why} 我推断的主键为 ${pkDesc}，用于去重与补全。可选「取交集」${inter} 列、「取并集」${union} 列或「按模板」对齐；并选择重复行策略（覆盖/追加/补全）。确认后点击「确认结构」进入规则确认。`;
  }

  if (stage === 'preview') {
    const baseCount = header_report?.base_columns?.length ?? 0;
    const fileCount = header_report?.files?.length ?? 0;
    const hasDiff = header_report?.files?.some(
      (f) => (f.missing_columns?.length ?? 0) > 0 || (f.extra_columns?.length ?? 0) > 0
    );
    if (fileCount === 0) return '请先上传 CSV 文件，我会先帮你预审表头对齐情况。';
    if (baseCount === 0 && fileCount > 0) {
      return '表头读取异常（基准列为空），请检查文件编码或重试上传。';
    }
    if (hasDiff) {
      return `我已经对比了 ${fileCount} 个文件的表头，基准列共 ${baseCount} 列；部分文件有缺失或多余列，将按「缺列补空、多列忽略」处理。确认后点击「确认对齐」进入诊断规则确认。`;
    }
    return `表头已对比完成，${fileCount} 个文件列名一致，共 ${baseCount} 列。确认后点击「确认对齐」进入诊断规则确认。`;
  }

  if (stage === 'rules') {
    const proposed = propose_result?.proposed ?? [];
    const outlierCols = proposed.filter((r) => r.rule_type === 'outlier').flatMap((r) => r.columns);
    const patternCols = proposed.filter((r) => r.rule_type === 'pattern').flatMap((r) => r.columns);
    const parts: string[] = [];
    if (outlierCols.length > 0) parts.push(`对「${outlierCols.join('」「')}」的异常值监控`);
    if (patternCols.length > 0) parts.push(`对「${patternCols.join('」「')}」的格式统一`);
    if (parts.length > 0) {
      return `规则确认：我选择这些规则是因为根据表头推断需要空值检查、主键去重与数据质量校验。建议增加${parts.join('和')}以保证合并后数据标准。确认后点击「确认规则并开始扫描」执行合并与健康扫描。`;
    }
    const reqCount = scan_rules?.required_columns?.length ?? propose_result?.basic?.required_columns?.length ?? 0;
    const keyCols = scan_rules?.composite_key_columns ?? propose_result?.basic?.composite_key_columns ?? [];
    const keyDesc = keyCols.length ? keyCols.join(' + ') : '无';
    return `规则确认：我选择这些规则是因为合并后需要统一检查空值、用主键「${keyDesc}」去重并保证数据标准。将检查 ${reqCount} 列空值。确认无误后点击「确认规则并开始扫描」执行合并与健康扫描。`;
  }

  if (stage === 'upload') {
    const total = merged?.rows?.length ?? schema_report?.merged_row_count ?? 0;
    const fileCount = schema_report?.tables?.length ?? 0;
    if (fileCount === 0 && total === 0) {
      return '还没有上传数据哦，把 CSV 拖进来或点击选择文件，我帮你合并并做健康扫描～';
    }
    if (health_manifest?.errors?.length) {
      const n = health_manifest.errors.length;
      return `数据已经合并好啦，一共 ${total} 行。不过我发现了 ${n} 处需要留意的地方（缺列、空值、类型不一致等），要一起处理一下吗？`;
    }
    return `数据已经合并完成，共 ${total} 行，目前没发现异常，可以直接导出了。`;
  }

  if (stage === 'diagnosis') {
    const remaining = remainingErrorCount ?? health_manifest?.errors?.length ?? 0;
    if (remaining === 0) {
      return '当前没有待处理项了，可以导出了。';
    }
    return `当前还有 ${remaining} 处待处理（未忽略且未修复）。点击「修复下一项」我会带你跳到对应单元格，填好或忽略后数量会实时更新～`;
  }

  if (stage === 'complete') {
    const total = merged?.rows?.length ?? 0;
    return `太棒了，数据已经标准对齐啦～ 共 ${total} 行，看板已生成，可以导出一份 Excel 留底或进入分析工作台。`;
  }

  if (stage === 'analysis_pilot') {
    const colCount = merged?.columns?.length ?? 0;
    return colCount > 0
      ? `我已从 ${colCount} 个维度中发现了 8 个有趣的趋势，请挑选最多 5 个您最感兴趣的加入您的看板。`
      : '数据已标准对齐。进入分析工作台后，我将自动发现维度与指标组合并推荐给您。';
  }

  return '有需要随时叫我～';
}

/**
 * 分析工作台 AI 引导语：建议从哪个维度、哪个指标开始分析。
 */
export function getAnalysisPilotMessage(
  columns: string[],
  dimensionColumns: string[],
  metricColumns: string[]
): string {
  const dim = dimensionColumns[0];
  const met = metricColumns[0];
  if (dim && met) {
    return `太棒了！数据已标准对齐。您已选择「${dim}」为维度、「${met}」为指标。切换聚合方式（平均值/求和/占比）后，我会在侧边栏显示计算公式，并可根据结果为您生成对比图。`;
  }
  if (columns.length === 0) return '暂无列，请先完成数据合并与清洗。';
  const suggestDim = columns.find((c) => /班级|部门|类型|名称|日期/.test(c)) ?? columns[0];
  const suggestMet = columns.find((c) => /分|成绩|金额|数量|占比/.test(c)) ?? (columns[1] ?? columns[0]);
  return `太棒了！数据已标准对齐。现在，告诉我您想从哪个角度开始分析？请点击上方列名指派「维度」和「指标」。我建议先从「${suggestDim}」维度看看「${suggestMet}」。`;
}
