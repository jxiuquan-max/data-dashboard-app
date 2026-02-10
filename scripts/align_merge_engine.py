#!/usr/bin/env python3
"""
Stage 1: 对齐合并引擎基础
- TableMerger: 以第一个表为基准，对齐列序后纵向合并多表
- schema_report: 记录缺失列、多余列、行数及 Fatal Mismatch，不中断程序
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Tuple

import pandas as pd


# 支持的表格式
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


class TableMerger:
    """
    对齐合并引擎：将多个列名一致但顺序可能错乱的 CSV/Excel 表，
    以第一个表为基准对齐列序后纵向合并，并生成 schema_report 元数据。
    """

    def __init__(self):
        self.schema_report: dict = {}

    def merge_and_report(
        self,
        file_paths: List[str],
    ) -> Tuple[pd.DataFrame, dict]:
        """
        合并多个表并返回合并结果与 JSON 风格的元数据报告。

        基准：第一个文件的列顺序为绝对基准。
        对齐：所有表按基准列序重排（Reindex），缺列补 NaN，多列不纳入。
        鲁棒性：若某表与基准列交集为空，记为 Fatal Mismatch 并跳过，不中断。

        参数
        -----
        file_paths : List[str]
            待合并文件路径列表（至少一个）。

        返回
        -----
        (pd.DataFrame, dict)
            合并后的 DataFrame；schema_report 字典（可序列化为 JSON）。
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
        }
        baseline_columns: List[str] = []
        merged_dfs: List[pd.DataFrame] = []
        fatal_count = 0

        for i, fp in enumerate(file_paths):
            path = Path(fp)
            name = path.name
            entry = {
                "file": name,
                "row_count": 0,
                "missing_columns": [],
                "extra_columns": [],
                "status": "ok",
            }
            try:
                df = _read_table(fp)
            except Exception as e:
                entry["status"] = "read_error"
                entry["error"] = str(e)
                report["tables"].append(entry)
                continue

            row_count = len(df)
            entry["row_count"] = row_count
            actual_columns = list(df.columns)
            actual_set = set(actual_columns)

            if i == 0:
                # 第一个表：作为基准，列序即基准列序，禁止重复列
                if len(actual_columns) != len(actual_set):
                    report["error"] = "基准表存在重复列名，无法合并"
                    report["reference_columns"] = actual_columns
                    return pd.DataFrame(), report
                baseline_columns = actual_columns
                report["reference_columns"] = baseline_columns
                merged_dfs.append(df)
                entry["missing_columns"] = []
                entry["extra_columns"] = []
                report["tables"].append(entry)
                continue

            baseline_set = set(baseline_columns)
            missing = [c for c in baseline_columns if c not in actual_set]
            extra = [c for c in actual_columns if c not in baseline_set]
            intersection = actual_set & baseline_set

            if len(intersection) == 0:
                entry["status"] = "Fatal Mismatch"
                entry["missing_columns"] = list(baseline_columns)
                entry["extra_columns"] = list(actual_columns)
                entry["message"] = "与基准表列名无交集，已跳过该表"
                report["tables"].append(entry)
                fatal_count += 1
                continue

            entry["missing_columns"] = missing
            entry["extra_columns"] = extra
            report["tables"].append(entry)

            # 按基准列序重排，缺列补 NaN；结果仅含基准列，无重复
            aligned = df.reindex(columns=baseline_columns)
            merged_dfs.append(aligned)

        report["fatal_mismatch_count"] = fatal_count
        if not merged_dfs:
            report["merged_row_count"] = 0
            self.schema_report = report
            return pd.DataFrame(), self.schema_report

        result = pd.concat(merged_dfs, axis=0, ignore_index=True)
        report["merged_row_count"] = len(result)
        self.schema_report = report
        return result, self.schema_report

    def get_report_json(self, indent: int = 2) -> str:
        """返回 schema_report 的 JSON 字符串，供下一阶段诊断使用。"""
        return json.dumps(self.schema_report, ensure_ascii=False, indent=indent)


# ---------------------------------------------------------------------------
# 示例用法
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    merger = TableMerger()
    paths = [
        "sample_a.csv",
        "sample_b.csv",
        "sample_c.csv",
    ]
    base = Path(__file__).resolve().parent
    full_paths = [str(base / p) for p in paths if (base / p).exists()]
    if not full_paths:
        full_paths = [str(base / "sample_a.csv"), str(base / "sample_b.csv")]
    df, report = merger.merge_and_report(full_paths)
    print("合并行数:", len(df))
    print("列:", list(df.columns))
    print("\n--- schema_report (JSON) ---")
    print(merger.get_report_json())
