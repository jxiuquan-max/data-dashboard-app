"""
多表合并函数：以第一个表为基准，校验列一致性、对齐列序后纵向合并。

核心逻辑：
1. 获取基准：第一个表的列顺序作为「标准列序」
2. 列一致性校验：后续表列名集合必须与基准完全一致（顺序无关），否则抛出明确错误
3. 对齐与重排：按标准列序重排每张表的列
4. 纵向合并：对齐后的表做 concat，结果表无重复列名
5. 类型检查：同列在不同表中类型需兼容，不兼容时抛出错误或给出提示
"""

from __future__ import annotations

from typing import List, Optional

import pandas as pd


def _check_column_consistency(
    standard_columns: List[str],
    df: pd.DataFrame,
    table_index: int,
) -> None:
    """
    校验单表列名集合与基准是否完全一致（顺序无关）。
    不一致时抛出包含缺失列、多余列等具体信息的错误。
    """
    standard_set = set(standard_columns)
    actual_set = set(df.columns)
    if standard_set == actual_set:
        return
    missing = standard_set - actual_set
    extra = actual_set - standard_set
    parts = []
    if missing:
        parts.append(f"缺失列（基准有而本表无）: {sorted(missing)}")
    if extra:
        parts.append(f"多余列（本表有而基准无）: {sorted(extra)}")
    raise ValueError(
        f"第 {table_index + 1} 张表（0-based 索引={table_index}）列名与基准表不一致：{'；'.join(parts)}。"
        f"基准列（共 {len(standard_columns)} 列）: {standard_columns}"
    )


def _check_type_compatibility(
    standard_columns: List[str],
    tables: List[pd.DataFrame],
) -> Optional[str]:
    """
    检查相同列名在不同表中的数据类型是否兼容。
    兼容规则：同一列在各表中要么都是数值型，要么都是对象/字符串型；数值与对象混用视为不兼容。
    返回 None 表示兼容；否则返回错误描述字符串。
    """
    for col in standard_columns:
        kinds = set()
        for i, df in enumerate(tables):
            if col not in df.columns:
                continue
            dtype = df[col].dtype
            if pd.api.types.is_numeric_dtype(dtype):
                kinds.add("numeric")
            else:
                kinds.add("object")
        if len(kinds) > 1:
            return f"列「{col}」在不同表中类型不一致（同时存在数值型与对象型），请先统一类型后再合并。"
    return None


def merge_tables_with_alignment(
    tables: List[pd.DataFrame],
    *,
    ignore_index: bool = True,
    copy: bool = True,
    check_types: bool = True,
) -> pd.DataFrame:
    """
    按「标准列序」对齐多表后纵向合并，确保结果表无重复列名且列序一致。

    参数
    -----
    tables : List[pd.DataFrame]
        待合并的数据表列表，至少包含一张表。
    ignore_index : bool, 默认 True
        合并后是否重置行索引（0, 1, 2, ...）。
    copy : bool, 默认 True
        False 时在重排列时尽量不复制数据（仅当列序已一致时生效），True 时保证不修改输入表。
    check_types : bool, 默认 True
        是否检查同列在不同表中的类型兼容性；不兼容时抛出 ValueError。

    返回
    -----
    pd.DataFrame
        列顺序与第一张表一致、无重复列名、行数为各表行数之和的结果表。

    异常
    -----
    ValueError
        - 表列表为空
        - 某表列名集合与第一张表不一致（会指出缺失列、多余列）
        - 开启 check_types 时同列类型不兼容
    """
    if not tables:
        raise ValueError("表列表不能为空，至少需要一张表。")

    # ---------- 1. 获取基准：第一张表的列顺序作为标准列序 ----------
    standard_columns: List[str] = list(tables[0].columns)
    if len(standard_columns) != len(set(standard_columns)):
        raise ValueError(
            f"基准表（第一张表）存在重复列名，无法作为标准。列名: {standard_columns}"
        )

    # ---------- 2. 列一致性校验：后续表列名集合必须与基准完全一致 ----------
    for i in range(1, len(tables)):
        _check_column_consistency(standard_columns, tables[i], i)

    # ---------- 3. 对齐与重排：按标准列序重排每张表的列 ----------
    aligned: List[pd.DataFrame] = []
    for i, df in enumerate(tables):
        if list(df.columns) == standard_columns:
            # 列序已一致，仅做拷贝（若需要）避免修改原表
            aligned.append(df.copy() if copy else df)
        else:
            aligned.append(df[standard_columns].copy() if copy else df[standard_columns])

    # ---------- 4. 类型检查（可选）：同列在不同表中类型需兼容 ----------
    if check_types:
        err = _check_type_compatibility(standard_columns, aligned)
        if err is not None:
            raise ValueError(err)

    # ---------- 5. 纵向合并：concat，确保结果无重复列名 ----------
    # 对齐后各表列名、列序完全一致，concat(axis=0) 不会产生重复列
    result = pd.concat(aligned, axis=0, ignore_index=ignore_index, copy=False)
    assert list(result.columns) == standard_columns, "合并后列序应与标准列序一致"
    assert result.columns.is_unique, "合并后不应存在重复列名"

    return result


# ---------------------------------------------------------------------------
# 示例用法
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # 示例 1：列序不同但列名一致，合并后以第一表列序为准
    df1 = pd.DataFrame({"A": [1, 2], "B": [3, 4], "C": [5, 6]})
    df2 = pd.DataFrame({"C": [7, 8], "A": [9, 10], "B": [11, 12]})  # 列序 C, A, B
    merged = merge_tables_with_alignment([df1, df2])
    print("示例 1 - 列序对齐后合并:")
    print(merged)
    # 列序为 A, B, C；行数为 4

    # 示例 2：列名不一致时抛出明确错误
    df3 = pd.DataFrame({"A": [1], "B": [2]})
    df4 = pd.DataFrame({"A": [3], "C": [4]})  # 缺 B，多 C
    try:
        merge_tables_with_alignment([df3, df4])
    except ValueError as e:
        print("\n示例 2 - 列名不一致时的错误提示:")
        print(e)

    # 示例 3：类型不兼容时抛出错误（可选）
    df5 = pd.DataFrame({"x": [1, 2], "y": ["a", "b"]})
    df6 = pd.DataFrame({"x": ["c", "d"], "y": ["e", "f"]})  # x 在 df5 为数值，在 df6 为对象
    try:
        merge_tables_with_alignment([df5, df6], check_types=True)
    except ValueError as e:
        print("\n示例 3 - 类型不兼容时的错误提示:")
        print(e)

    # 示例 4：忽略类型检查仍可合并（由调用方保证或接受混合类型）
    merged4 = merge_tables_with_alignment([df5, df6], check_types=False)
    print("\n示例 4 - check_types=False 时合并结果:")
    print(merged4)
