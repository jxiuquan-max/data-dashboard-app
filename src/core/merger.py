"""
Stage 1: 对齐合并引擎
- TableMerger: 以第一个表为基准，对齐列序后纵向合并多表
- schema_report: 记录缺失列、多余列、行数及 Fatal Mismatch，不中断程序
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import List, Optional, Set, Tuple

import pandas as pd


CSV_EXTENSIONS = {".csv"}
EXCEL_EXTENSIONS = {".xlsx", ".xls"}


def _read_table(path: str | Path) -> pd.DataFrame:
    """根据扩展名读取 CSV 或 Excel（第一个工作表）。"""
    path = Path(path).resolve()
    suffix = path.suffix.lower()
    if suffix in CSV_EXTENSIONS:
        return pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    if suffix in EXCEL_EXTENSIONS:
        return pd.read_excel(path, sheet_name=0, dtype=str)
    raise ValueError(f"不支持的文件格式: {suffix}")


def _read_header_columns(path: str | Path) -> List[str]:
    """仅读取表头列名，不读数据行。用于轻量级表头对比。"""
    path = Path(path).resolve()
    suffix = path.suffix.lower()
    if suffix in CSV_EXTENSIONS:
        df = pd.read_csv(path, encoding="utf-8-sig", nrows=0)
        return list(df.columns)
    if suffix in EXCEL_EXTENSIONS:
        df = pd.read_excel(path, sheet_name=0, nrows=0)
        return list(df.columns)
    raise ValueError(f"不支持的文件格式: {suffix}")


def _read_header_columns_from_bytes(content: bytes, filename: str = "") -> List[str]:
    """从内存字节仅读取表头列名，不写磁盘，避免临时文件过早释放导致 FileNotFound。"""
    suffix = Path(filename).suffix.lower() if filename else ".csv"
    if suffix in CSV_EXTENSIONS:
        df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig", nrows=0)
        return list(df.columns)
    if suffix in EXCEL_EXTENSIONS:
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, nrows=0)
        return list(df.columns)
    raise ValueError(f"不支持的文件格式: {suffix}")


def _read_table_from_bytes(content: bytes, filename: str = "", nrows: Optional[int] = None) -> pd.DataFrame:
    """从内存字节读取 CSV/Excel（可选仅前 nrows 行），用于合并预览。"""
    suffix = Path(filename).suffix.lower() if filename else ".csv"
    if suffix in CSV_EXTENSIONS:
        df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig", dtype=str, nrows=nrows)
        return df
    if suffix in EXCEL_EXTENSIONS:
        df = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=str, nrows=nrows)
        return df
    raise ValueError(f"不支持的文件格式: {suffix}")


def analyze_headers_only(file_paths: List[str]) -> dict:
    """
    仅分析各文件表头差异，不进行实际合并。
    返回格式适配前端 HeaderPreview：base_columns、files（含 missing_columns、extra_columns）。
    以第一个成功读取的文件为基准；若首文件读失败则用下一个成功文件，确保 base_columns 不为空。
    """
    if not file_paths:
        return {"base_columns": [], "files": []}

    baseline_columns: Optional[List[str]] = None
    base_columns: List[str] = []
    file_entries: List[dict] = []

    for fp in sorted(file_paths, key=lambda p: Path(p).name):
        path = Path(fp)
        name = path.name
        entry = {"file": name, "missing_columns": [], "extra_columns": []}
        try:
            headers = _read_header_columns(path)
        except Exception as e:
            entry["error"] = str(e)
            file_entries.append(entry)
            continue

        if baseline_columns is None:
            baseline_columns = headers
            base_columns = list(baseline_columns)
            file_entries.append(entry)
            continue

        base_set = set(baseline_columns)
        actual_set = set(headers)
        entry["missing_columns"] = [c for c in baseline_columns if c not in actual_set]
        entry["extra_columns"] = [c for c in headers if c not in base_set]
        file_entries.append(entry)

    return {"base_columns": base_columns, "files": file_entries}


def _row_count_from_content(content: bytes, filename: str = "") -> int:
    """从内存字节快速估算行数（表头+数据行），用于合并效果小结。"""
    suffix = Path(filename).suffix.lower() if filename else ".csv"
    try:
        if suffix in CSV_EXTENSIONS:
            df = pd.read_csv(io.BytesIO(content), encoding="utf-8-sig", dtype=str)
            return len(df)
        if suffix in EXCEL_EXTENSIONS:
            df = pd.read_excel(io.BytesIO(content), sheet_name=0, dtype=str)
            return len(df)
    except Exception:
        pass
    return 0


def analyze_headers_only_from_contents(
    file_entries: List[Tuple[str, bytes]],
) -> dict:
    """
    从内存中的 (filename, content) 分析表头，不写磁盘，避免临时目录释放导致 FileNotFound。
    返回格式与 analyze_headers_only 一致；并为每个文件附加 row_count 供合并效果小结使用。
    """
    if not file_entries:
        return {"base_columns": [], "files": []}

    baseline_columns: Optional[List[str]] = None
    base_columns: List[str] = []
    out_files: List[dict] = []

    for name, content in file_entries:
        entry = {"file": name, "missing_columns": [], "extra_columns": [], "row_count": 0}
        try:
            headers = _read_header_columns_from_bytes(content, name)
            entry["row_count"] = _row_count_from_content(content, name)
        except Exception as e:
            entry["error"] = str(e)
            out_files.append(entry)
            continue

        if baseline_columns is None:
            baseline_columns = headers
            base_columns = list(baseline_columns)
            out_files.append(entry)
            continue

        base_set = set(baseline_columns)
        actual_set = set(headers)
        entry["missing_columns"] = [c for c in baseline_columns if c not in actual_set]
        entry["extra_columns"] = [c for c in headers if c not in base_set]
        out_files.append(entry)

    return {"base_columns": base_columns, "files": out_files}


PREVIEW_MAX_ROWS = 3


def build_merge_preview_from_contents(
    file_entries: List[Tuple[str, bytes]],
    extend_extra: bool = False,
    max_rows: int = PREVIEW_MAX_ROWS,
) -> dict:
    """
    从内存中的 (filename, content) 生成合并缩略预览（基准左连接风格）。
    返回 { columns: [...], rows: [ {col: val}, ... ] }，供「确认对齐」前展示。
    """
    base = analyze_headers_only_from_contents(file_entries)
    base_columns = base["base_columns"]
    files = base["files"]
    if not base_columns:
        return {"columns": [], "rows": []}

    if extend_extra:
        all_cols: Set[str] = set(base_columns)
        for ent in files:
            if ent.get("error"):
                continue
            extra = set(ent.get("extra_columns") or [])
            all_cols |= extra
        cols = list(base_columns) + sorted(all_cols - set(base_columns))
    else:
        cols = list(base_columns)

    rows_out: List[dict] = []
    for idx, (name, content) in enumerate(file_entries):
        try:
            df = _read_table_from_bytes(content, name, nrows=max_rows)
        except Exception:
            continue
        aligned = df.reindex(columns=cols)
        for _, row in aligned.iterrows():
            rows_out.append({c: (None if pd.isna(row.get(c)) else str(row.get(c))) for c in cols})

    return {"columns": cols, "rows": rows_out}


# 同义列候选：列名可能表示同一含义（用于策略透明化展示）
SYNONYM_PAIRS: List[List[str]] = [
    ["分数", "成绩"],
    ["姓名", "名字"],
    ["日期", "时间"],
]
# 主键候选关键词（用于推断最佳主键）
PRIMARY_KEY_KEYWORDS = ["姓名", "班级", "id", "编号", "学号", "代码"]


def _strategy_from_base(base: dict) -> dict:
    """根据 base_columns、files 计算策略相关字段（交集、并集、主键等）。"""
    base_columns = base["base_columns"]
    files = base["files"]
    if not base_columns and not files:
        return {
            **base,
            "columns_intersection": [],
            "columns_union": [],
            "synonym_candidates": [],
            "suggested_primary_key": [],
            "type_conflicts": [],
            "suggested_merge_mode": "intersection",
            "duplicate_column_groups": [],
        }

    all_sets: List[Set[str]] = []
    for i, ent in enumerate(files):
        if ent.get("error"):
            continue
        if i == 0:
            all_sets.append(set(base_columns))
            continue
        # 该文件实际列 = 基准列 - 缺失 + 多余
        missing = set(ent.get("missing_columns") or [])
        extra = set(ent.get("extra_columns") or [])
        file_cols = (set(base_columns) - missing) | extra
        all_sets.append(file_cols)

    if not all_sets:
        inter = set(base_columns)
        union = set(base_columns)
    else:
        inter = all_sets[0].copy()
        for s in all_sets[1:]:
            inter &= s
        union = set()
        for s in all_sets:
            union |= s

    columns_intersection = sorted(inter, key=lambda c: (base_columns.index(c) if c in base_columns else 999, c))
    # 并集顺序：基准列优先，其余按出现顺序
    extra_in_union = union - set(base_columns)
    columns_union = list(base_columns) + sorted(extra_in_union)

    synonym_candidates: List[List[str]] = []
    for pair in SYNONYM_PAIRS:
        in_union = [p for p in pair if p in union]
        if len(in_union) >= 2:
            synonym_candidates.append(in_union)

    suggested_primary_key: List[str] = []
    for kw in PRIMARY_KEY_KEYWORDS:
        for col in columns_intersection:
            if kw in col and col not in suggested_primary_key:
                suggested_primary_key.append(col)
    if not suggested_primary_key and len(columns_intersection) >= 2:
        suggested_primary_key = columns_intersection[:2]
    elif not suggested_primary_key and columns_intersection:
        suggested_primary_key = columns_intersection[:1]

    # 建议的合并模式：列差异大时建议并集，否则建议交集
    union_only = set(columns_union) - set(columns_intersection)
    suggested_merge_mode = "union" if len(union_only) > 2 else "intersection"

    # 潜在重复列名（同义列）：供前端展示与 AI 文案
    duplicate_column_groups = synonym_candidates

    return {
        **base,
        "columns_intersection": columns_intersection,
        "columns_union": columns_union,
        "synonym_candidates": synonym_candidates,
        "suggested_primary_key": suggested_primary_key,
        "type_conflicts": [],
        "suggested_merge_mode": suggested_merge_mode,
        "duplicate_column_groups": duplicate_column_groups,
    }


def analyze_headers_with_strategy(file_paths: List[str]) -> dict:
    """扩展表头分析（从路径读取）。"""
    base = analyze_headers_only(file_paths)
    return _strategy_from_base(base)


def analyze_headers_with_strategy_from_contents(
    file_entries: List[Tuple[str, bytes]],
    with_preview: bool = True,
    preview_extend_extra: bool = True,
) -> dict:
    """扩展表头分析（从内存字节读取），避免临时文件释放导致 FileNotFound。可选返回合并缩略预览。"""
    base = analyze_headers_only_from_contents(file_entries)
    out = _strategy_from_base(base)
    if with_preview and base.get("base_columns") and file_entries:
        try:
            out["preview"] = build_merge_preview_from_contents(
                file_entries, extend_extra=preview_extend_extra, max_rows=PREVIEW_MAX_ROWS
            )
        except Exception:
            out["preview"] = {"columns": base["base_columns"], "rows": []}
    return out


MATCH_RATE_WARN_THRESHOLD = 0.8


def _strip_primary_key_columns(df: pd.DataFrame, key_columns: List[str]) -> pd.DataFrame:
    """对主键列执行 .str.strip()，剔除不可见字符。"""
    out = df.copy()
    for col in key_columns:
        if col not in out.columns:
            continue
        out[col] = out[col].astype(str).str.strip()
    return out


class TableMerger:
    """
    对齐合并引擎：以第一个表为基准，支持纵向堆叠或基准左连接（行数=首表）。
    主键列会强制 strip，左连接时计算匹配率并低于 80% 时写入 merge_warning。
    """

    def __init__(self) -> None:
        self.schema_report: dict = {}

    def merge_and_report(
        self,
        file_paths: List[str],
        baseline_columns: Optional[List[str]] = None,
        template_incremental: bool = False,
        primary_key_columns: Optional[List[str]] = None,
    ) -> Tuple[pd.DataFrame, dict]:
        """
        合并多个表并返回合并结果与 JSON 风格的元数据报告。

        当 primary_key_columns 非空时：对主键列 strip，并执行真正的左连接（结果行数=首表行数）。
        否则：纵向 concat（原逻辑）。
        """
        if not file_paths:
            empty = pd.DataFrame()
            self.schema_report = {
                "error": "file_paths 为空",
                "merged_row_count": 0,
            }
            return empty, self.schema_report

        report: dict = {
            "reference_file": str(Path(file_paths[0]).name),
            "reference_columns": [],
            "tables": [],
            "merged_row_count": 0,
            "fatal_mismatch_count": 0,
            "merge_warning": None,
        }
        merged_dfs: List[pd.DataFrame] = []
        fatal_count = 0
        cols_to_use: Optional[List[str]] = baseline_columns if baseline_columns else None
        key_cols: List[str] = list(primary_key_columns) if primary_key_columns else []

        if template_incremental:
            all_cols: Set[str] = set()
            for fp in file_paths:
                try:
                    df = _read_table(fp)
                    all_cols |= set(df.columns)
                except Exception:
                    continue
            baseline_list: List[str] = list(cols_to_use) if cols_to_use else []
            if not baseline_list and file_paths:
                try:
                    first_df = _read_table(file_paths[0])
                    baseline_list = list(first_df.columns)
                    all_cols |= set(baseline_list)
                except Exception:
                    pass
            base_set = set(baseline_list)
            extra_sorted = sorted(all_cols - base_set)
            cols_to_use = baseline_list + extra_sorted

        for i, fp in enumerate(file_paths):
            path = Path(fp)
            name = path.name
            entry = {
                "file": name,
                "row_count": 0,
                "missing_columns": [],
                "extra_columns": [],
                "status": "ok",
                "match_rate": None,
            }
            try:
                df = _read_table(fp)
            except Exception as e:
                entry["status"] = "read_error"
                entry["error"] = str(e)
                report["tables"].append(entry)
                continue

            if key_cols:
                df = _strip_primary_key_columns(df, key_cols)

            row_count = len(df)
            entry["row_count"] = row_count
            actual_columns = list(df.columns)
            actual_set = set(actual_columns)

            if i == 0:
                if len(actual_columns) != len(actual_set):
                    report["error"] = "基准表存在重复列名，无法合并"
                    report["reference_columns"] = actual_columns
                    return pd.DataFrame(), report
                if cols_to_use is None or len(cols_to_use) == 0:
                    cols_to_use = actual_columns
                report["reference_columns"] = cols_to_use
                # 左连接 + 增量列时：基准表只保留自身列，不扩展为 cols_to_use，否则 right_only 会为空，第二张表增量列无法带入
                if key_cols and template_incremental:
                    merged_dfs.append(df.copy())
                else:
                    merged_dfs.append(df.reindex(columns=cols_to_use))
                entry["missing_columns"] = [c for c in cols_to_use if c not in actual_set]
                entry["extra_columns"] = [c for c in actual_columns if c not in set(cols_to_use)]
                report["tables"].append(entry)
                continue

            baseline_set = set(cols_to_use)
            missing = [c for c in cols_to_use if c not in actual_set]
            extra = [c for c in actual_columns if c not in baseline_set]
            intersection = actual_set & baseline_set

            if len(intersection) == 0:
                entry["status"] = "Fatal Mismatch"
                entry["missing_columns"] = list(cols_to_use)
                entry["extra_columns"] = list(actual_columns)
                entry["message"] = "与基准表列名无交集，已跳过该表"
                report["tables"].append(entry)
                fatal_count += 1
                continue

            entry["missing_columns"] = missing
            entry["extra_columns"] = extra
            report["tables"].append(entry)

            aligned = df.reindex(columns=cols_to_use)
            merged_dfs.append(aligned)

        report["fatal_mismatch_count"] = fatal_count
        if not merged_dfs:
            report["merged_row_count"] = 0
            self.schema_report = report
            return pd.DataFrame(), self.schema_report

        if key_cols and len(merged_dfs) > 0:
            key_cols_use = [c for c in key_cols if c in merged_dfs[0].columns]
            if key_cols_use:
                left = merged_dfs[0].copy()
                for idx in range(1, len(merged_dfs)):
                    right = merged_dfs[idx]
                    merge_on = [c for c in key_cols_use if c in left.columns and c in right.columns]
                    if not merge_on:
                        continue
                    right_only = [c for c in right.columns if c not in left.columns]
                    if right_only:
                        right_merge = right[merge_on + right_only].copy()
                    else:
                        right_merge = right[merge_on].copy()
                    right_merge = right_merge.drop_duplicates(subset=merge_on, keep="first")
                    left = left.merge(right_merge, on=merge_on, how="left", suffixes=("", "_dup"))
                    dup_cols = [c for c in left.columns if c.endswith("_dup")]
                    left = left.drop(columns=dup_cols, errors="ignore")
                    total_left = len(merged_dfs[0])
                    right_keys = set(map(tuple, right[merge_on].drop_duplicates().values.tolist()))
                    left_keys = set(map(tuple, merged_dfs[0][merge_on].values.tolist()))
                    matched = len(left_keys & right_keys)
                    rate = matched / total_left if total_left else 1.0
                    if len(report["tables"]) > idx:
                        report["tables"][idx]["match_rate"] = round(rate, 4)
                    if rate < MATCH_RATE_WARN_THRESHOLD and report.get("merge_warning") is None:
                        report["merge_warning"] = "发现大量主键无法匹配，请检查是否存在同名异义或格式问题。"
                # 左连接后按基准列顺序输出（cols_to_use），保证与 reference_columns 一致
                result = left.reindex(columns=report["reference_columns"])
            else:
                result = pd.concat(merged_dfs, axis=0, ignore_index=True)
        else:
            result = pd.concat(merged_dfs, axis=0, ignore_index=True)

        report["merged_row_count"] = len(result)
        self.schema_report = report
        return result, self.schema_report

    def get_report_json(self, indent: int = 2) -> str:
        """返回 schema_report 的 JSON 字符串，供下一阶段诊断使用。"""
        return json.dumps(self.schema_report, ensure_ascii=False, indent=indent)
