/**
 * 数据体检：类型识别器
 * 扫描新表中应为数字的列，识别无法转换成数字的脏数据
 * 排除人民币格式干扰：带￥符号的金额列，只要能转成数字则不视为脏数据
 */

import { sanitizeValue } from './diffUtils';

/** 应为数字的列名（含库存、采购、数量、价格等） */
const NUMERIC_COLUMN_NAMES = new Set([
  '商品采购入库数',
  '剩余库存数',
  '销售数量',
  '成本价',
  '售价',
  '销售总额',
  '商品总成本',
  '销售利润',
]);

/** 列名包含这些关键词的也视为数字列 */
const NUMERIC_KEYWORDS = ['数', '价', '额', '成本', '利润', '库存'];

function isNumericColumn(colName: string): boolean {
  if (NUMERIC_COLUMN_NAMES.has(colName)) return true;
  return NUMERIC_KEYWORDS.some((kw) => colName.includes(kw));
}

/**
 * 判断值能否解析为有效数字
 * - 空字符串、null、undefined -> 视为有效（缺失值，非脏数据）
 * - 先 sanitize（去￥、逗号、空格），再 parseFloat
 * - ￥79.00 -> 79.00 有效
 * - aaa、bbb、待查 -> 无效
 */
function canParseAsNumber(value: string | null | undefined): boolean {
  const s = sanitizeValue(value);
  if (s === '') return true; // 空视为有效
  const n = parseFloat(s);
  return !Number.isNaN(n) && isFinite(n);
}

export interface HealthAnomaly {
  productName: string;
  colKey: string;
  rawValue: string | null;
  rowIndex: number;
}

export interface HealthCheckResult {
  anomalies: HealthAnomaly[];
  totalCount: number;
}

/**
 * 对新表（mapped 后的行）执行数据体检
 * @param rows 新表行数据（已按 mapping 转换后的列名）
 * @param anchorColumn 关联键列名，用于获取商品名
 * @param numericColumns 可选：指定要检查的数字列，不传则自动识别
 */
export function runHealthCheck(
  rows: Record<string, string | null>[],
  anchorColumn: string = '商品名称',
  numericColumns?: string[]
): HealthCheckResult {
  const anomalies: HealthAnomaly[] = [];
  if (rows.length === 0) return { anomalies, totalCount: 0 };

  const cols = numericColumns ?? Object.keys(rows[0] ?? {}).filter(isNumericColumn);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    const productName = String(row[anchorColumn] ?? `行${i + 1}`);

    for (const col of cols) {
      const val = row[col];
      if (val == null) continue; // 空值不报错
      const s = String(val).trim();
      if (s === '') continue;

      if (!canParseAsNumber(val)) {
        anomalies.push({
          productName,
          colKey: col,
          rawValue: val,
          rowIndex: i,
        });
      }
    }
  }

  return { anomalies, totalCount: anomalies.length };
}
