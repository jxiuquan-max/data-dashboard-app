"""
数据健康扫描：基于合并后的 DataFrame 与 schema_report，
区分结构性错误（合并缺列等）与业务性错误（空值、类型异常、重复、异常值、正则不匹配、逻辑约束违反）。
专业级：异常值（Outlier）、正则校验（pattern）、列间逻辑约束。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd


def _row_index_to_file_index(row_index: int, schema_report: dict) -> int:
    """根据行下标推断该行来自第几个文件（0-based）。"""
    tables = schema_report.get("tables") or []
    cum = 0
    for i, t in enumerate(tables):
        n = t.get("row_count", 0)
        if row_index < cum + n:
            return i
        cum += n
    return 0


def _get_missing_columns_by_file(schema_report: dict) -> Dict[int, Set[str]]:
    """返回 file_index -> set(missing_columns)。"""
    tables = schema_report.get("tables") or []
    out: Dict[int, Set[str]] = {}
    for i, t in enumerate(tables):
        out[i] = set(t.get("missing_columns") or [])
    return out


def _is_empty(value: Any) -> bool:
    """NaN 或空字符串视为空。"""
    if pd.isna(value):
        return True
    s = str(value).strip()
    return s == "" or s.lower() == "nan"


def _is_numeric_value(value: Any) -> bool:
    """是否可视为数值（用于类型检测）。支持纯数字与百分比（如 50%、50.5%）。"""
    if pd.isna(value) or str(value).strip() == "":
        return True
    s = str(value).strip()
    try:
        float(s)
        return True
    except ValueError:
        pass
    if s.endswith("%"):
        try:
            float(s.rstrip("%").strip())
            return True
        except ValueError:
            pass
    return False


def _to_float(value: Any) -> Optional[float]:
    """转为 float，空或非法返回 None。支持百分比（如 50% 转为 50.0）。"""
    if pd.isna(value) or str(value).strip() == "":
        return None
    s = str(value).strip()
    try:
        return float(s)
    except ValueError:
        pass
    if s.endswith("%"):
        try:
            return float(s.rstrip("%").strip())
        except ValueError:
            pass
    return None


def _build_row_ranges(schema_report: dict) -> List[Tuple[int, int]]:
    """返回 [(start_row, end_row)] 每个文件在合并表中的行范围（左闭右开）。"""
    tables = schema_report.get("tables") or []
    out: List[Tuple[int, int]] = []
    start = 0
    for t in tables:
        n = t.get("row_count", 0)
        out.append((start, start + n))
        start += n
    return out


def _outlier_bounds_iqr(series: pd.Series, k: float = 1.5) -> Tuple[Optional[float], Optional[float]]:
    """IQR 法：返回 (lower, upper)，超出为异常值。空列返回 (None, None)。"""
    numeric = series.apply(_to_float).dropna()
    if len(numeric) < 4:
        return (None, None)
    q1 = numeric.quantile(0.25)
    q3 = numeric.quantile(0.75)
    iqr = q3 - q1
    if iqr == 0:
        return (float(q1), float(q3))
    lower = float(q1 - k * iqr)
    upper = float(q3 + k * iqr)
    return (lower, upper)


# 约束运算符：左列与右列比较
def _eval_constraint(left_val: Optional[float], op: str, right_val: Optional[float]) -> bool:
    """返回 True 表示约束满足。"""
    if left_val is None or right_val is None:
        return True
    if op == ">":
        return left_val > right_val
    if op == "<":
        return left_val < right_val
    if op == ">=":
        return left_val >= right_val
    if op == "<=":
        return left_val <= right_val
    if op == "==":
        return left_val == right_val
    return True


class DataHealthScanner:
    """
    数据健康扫描：空值、类型、重复、异常值、正则、逻辑约束。
    输出 health_manifest：errors + summary。
    """

    def __init__(
        self,
        composite_key_columns: Optional[List[str]] = None,
        numeric_columns: Optional[List[str]] = None,
        outlier_columns: Optional[List[str]] = None,
        pattern_columns: Optional[Dict[str, str]] = None,
        constraints: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """
        composite_key_columns: 组合主键，默认 ["姓名", "班级"]。
        numeric_columns: 数值列（类型+可选异常值），默认 ["分数"]。
        outlier_columns: 额外做异常值检测的列（可与 numeric_columns 重叠）。
        pattern_columns: 列名 -> 正则 pattern，不匹配且非空则报错。
        constraints: [{ "left": "A", "op": ">", "right": "B" }]，A列需大于B列等。
        """
        self.composite_key_columns = composite_key_columns or ["姓名", "班级"]
        self.numeric_columns = numeric_columns or ["分数"]
        self.outlier_columns = list(outlier_columns) if outlier_columns else []
        self.pattern_columns = dict(pattern_columns) if pattern_columns else {}
        self.constraints = list(constraints) if constraints else []

    def scan(
        self,
        df: pd.DataFrame,
        schema_report: dict,
    ) -> dict:
        """
        执行完整健康扫描，返回 health_manifest。
        包含：空值、类型、重复、异常值(outlier)、正则(pattern_mismatch)、逻辑约束(constraint_violation)。
        """
        errors: List[dict] = []
        missing_by_file = _get_missing_columns_by_file(schema_report)

        # ---- 1. 空值定位 ----
        for row_index in range(len(df)):
            file_idx = _row_index_to_file_index(row_index, schema_report)
            missing_cols = missing_by_file.get(file_idx, set())
            for col in df.columns:
                val = df.iloc[row_index][col]
                if not _is_empty(val):
                    continue
                if col in missing_cols:
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": col,
                        "error_type": "null_structural",
                        "severity": "structural",
                        "message": "合并时该列在源表中缺失，已补空",
                    })
                else:
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": col,
                        "error_type": "null_business",
                        "severity": "business",
                        "message": "空值或空字符串",
                    })

        # ---- 2. 类型不一致 ----
        for col in self.numeric_columns:
            if col not in df.columns:
                continue
            for row_index in range(len(df)):
                val = df.iloc[row_index][col]
                if _is_empty(val):
                    continue
                if not _is_numeric_value(val):
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": col,
                        "error_type": "type_inconsistent",
                        "severity": "business",
                        "message": f"期望数值，实际为: {str(val)[:50]}",
                    })

        # ---- 3. 重复项 ----
        key_cols = [c for c in self.composite_key_columns if c in df.columns]
        if key_cols:
            seen: Set[Tuple[str, ...]] = set()
            for row_index in range(len(df)):
                key = tuple(str(df.iloc[row_index][c]) if pd.notna(df.iloc[row_index][c]) else "" for c in key_cols)
                if key in seen:
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": ",".join(key_cols),
                        "error_type": "duplicate",
                        "severity": "business",
                        "message": f"与组合主键 {key_cols} 重复",
                    })
                else:
                    seen.add(key)

        # ---- 4. 异常值（IQR）----
        all_outlier_cols = list(set(self.numeric_columns) | set(self.outlier_columns))
        for col in all_outlier_cols:
            if col not in df.columns:
                continue
            ser = df[col].apply(lambda v: _to_float(v))
            lower, upper = _outlier_bounds_iqr(ser)
            if lower is None and upper is None:
                continue
            for row_index in range(len(df)):
                val = df.iloc[row_index][col]
                if _is_empty(val):
                    continue
                f = _to_float(val)
                if f is None:
                    continue
                if (lower is not None and f < lower) or (upper is not None and f > upper):
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": col,
                        "error_type": "outlier",
                        "severity": "business",
                        "message": f"数值 {val} 超出该列正常范围（异常值），建议确认",
                    })

        # ---- 5. 正则校验 ----
        for col, pattern_str in self.pattern_columns.items():
            if col not in df.columns:
                continue
            try:
                pat = re.compile(pattern_str)
            except re.error:
                continue
            for row_index in range(len(df)):
                val = df.iloc[row_index][col]
                if _is_empty(val):
                    continue
                if not pat.search(str(val).strip()):
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": col,
                        "error_type": "pattern_mismatch",
                        "severity": "business",
                        "message": f"格式不符合规则（预期匹配: {pattern_str[:30]}…）",
                    })

        # ---- 6. 逻辑约束 ----
        for c in self.constraints:
            left_col = c.get("left")
            right_col = c.get("right")
            op = c.get("op", ">")
            if not left_col or not right_col or left_col not in df.columns or right_col not in df.columns:
                continue
            for row_index in range(len(df)):
                left_val = _to_float(df.iloc[row_index][left_col])
                right_val = _to_float(df.iloc[row_index][right_col])
                if not _eval_constraint(left_val, op, right_val):
                    errors.append({
                        "row_index": int(row_index),
                        "col_name": f"{left_col} vs {right_col}",
                        "error_type": "constraint_violation",
                        "severity": "business",
                        "message": f"列「{left_col}」应与「{right_col}」满足 {op} 关系",
                    })

        # ---- 7. 汇总 ----
        n_structural = sum(1 for e in errors if e.get("severity") == "structural")
        n_business_null = sum(1 for e in errors if e.get("error_type") == "null_business")
        n_type = sum(1 for e in errors if e.get("error_type") == "type_inconsistent")
        n_dup = sum(1 for e in errors if e.get("error_type") == "duplicate")
        n_outlier = sum(1 for e in errors if e.get("error_type") == "outlier")
        n_pattern = sum(1 for e in errors if e.get("error_type") == "pattern_mismatch")
        n_constraint = sum(1 for e in errors if e.get("error_type") == "constraint_violation")
        parts = []
        if n_structural > 0:
            parts.append(f"{n_structural} 处结构性空值（合并缺列）")
        if n_business_null > 0:
            parts.append(f"{n_business_null} 处业务空值")
        if n_type > 0:
            parts.append(f"{n_type} 处类型不一致")
        if n_dup > 0:
            parts.append(f"{n_dup} 处重复项")
        if n_outlier > 0:
            parts.append(f"{n_outlier} 处异常值")
        if n_pattern > 0:
            parts.append(f"{n_pattern} 处格式不匹配")
        if n_constraint > 0:
            parts.append(f"{n_constraint} 处逻辑约束违反")
        summary = "发现 " + "，".join(parts) if parts else "未发现异常"

        health_manifest = {
            "errors": errors,
            "summary": summary,
            "counts": {
                "structural_nulls": n_structural,
                "business_nulls": n_business_null,
                "type_errors": n_type,
                "duplicates": n_dup,
                "outliers": n_outlier,
                "pattern_mismatch": n_pattern,
                "constraint_violation": n_constraint,
                "total": len(errors),
            },
        }
        return health_manifest


def scan_health(
    df: pd.DataFrame,
    schema_report: dict,
    composite_key_columns: Optional[List[str]] = None,
    numeric_columns: Optional[List[str]] = None,
    outlier_columns: Optional[List[str]] = None,
    pattern_columns: Optional[Dict[str, str]] = None,
    constraints: Optional[List[Dict[str, Any]]] = None,
) -> dict:
    """
    便捷函数：对合并后的 DataFrame 执行健康扫描，返回 health_manifest。
    """
    scanner = DataHealthScanner(
        composite_key_columns=composite_key_columns,
        numeric_columns=numeric_columns,
        outlier_columns=outlier_columns,
        pattern_columns=pattern_columns,
        constraints=constraints,
    )
    return scanner.scan(df, schema_report)
