# 对齐合并引擎 - 测试样本说明

本目录下的 CSV 用于测试 `src/core/merger.py` 的 `TableMerger`。

## 样本文件（列名一致但顺序不同）

| 文件 | 列顺序 | 说明 |
|------|--------|------|
| `ref.csv` | 姓名, 班级, 分数 | 基准表（第一个文件），3 行 |
| `table_b.csv` | 分数, 姓名, 班级 | 乱序，3 行 |
| `table_c.csv` | 班级, 分数, 姓名 | 乱序，3 行 |
| `table_d.csv` | 姓名, 分数, 班级 | 乱序，2 行 |
| `table_partial.csv` | 姓名, 班级 | 缺列「分数」，2 行（合并时补空值） |
| `table_extra.csv` | 班级, 备注, 姓名, 分数 | 多列「备注」，2 行（多余列不纳入） |

基准列序（以 ref.csv 为准）：**姓名, 班级, 分数**。

## 运行合并测试

在项目根目录执行（需安装 pandas）：

```bash
pip install pandas
cd /path/to/my-clean-demo
PYTHONPATH=src python3 -c "
from core.merger import TableMerger
from pathlib import Path
base = Path('tests')
paths = [str(base / f) for f in ['ref.csv', 'table_b.csv', 'table_c.csv', 'table_d.csv', 'table_partial.csv', 'table_extra.csv']]
merger = TableMerger()
df, report = merger.merge_and_report(paths)
print('列序:', list(df.columns))
print('行数:', len(df))
print(df.to_string())
print(merger.get_report_json())
"
```

预期：合并后列序为 `['姓名', '班级', '分数']`，共 15 行；report 中记录 table_partial 的 missing_columns、table_extra 的 extra_columns。
