"""
合并与健康扫描 API：接收多个 CSV 上传，执行 merge_and_report + DataHealthScanner，返回 JSON。
运行: uvicorn server:app --reload --port 8000
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

# 项目根目录，保证可导入 src.core
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from core.merger import TableMerger
from core.scanner import scan_health

app = FastAPI(title="Merge & Health Scan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def df_to_merged_json(df):
    """DataFrame 转前端 MergedData 格式：columns + rows，NaN 为 null。"""
    import pandas as pd
    records = json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
    # 确保值为 str | null
    out = []
    for row in records:
        out.append({k: (None if v is None else str(v)) for k, v in row.items()})
    return {"columns": list(df.columns), "rows": out}


@app.post("/merge-and-scan")
async def merge_and_scan(files: list[UploadFile] = File(..., description="多个 CSV 文件")):
    """接收多个 CSV，执行合并与健康扫描，返回 schema_report、health_manifest、merged。"""
    csv_files = [f for f in files if f.filename and f.filename.lower().endswith(".csv")]
    if not csv_files:
        raise HTTPException(400, "请至少上传一个 CSV 文件")

    with tempfile.TemporaryDirectory(prefix="merge_scan_") as tmpdir:
        paths = []
        for f in csv_files:
            path = Path(tmpdir) / (f.filename or "upload.csv")
            content = await f.read()
            path.write_bytes(content)
            paths.append(str(path))

        # 按文件名排序，保证顺序稳定（可选）
        paths.sort(key=lambda p: Path(p).name)

        merger = TableMerger()
        df, schema_report = merger.merge_and_report(paths)

        if "error" in schema_report and schema_report.get("merged_row_count", 0) == 0:
            return {
                "schema_report": schema_report,
                "health_manifest": {
                    "errors": [],
                    "summary": "合并未产生数据",
                    "counts": {"structural_nulls": 0, "business_nulls": 0, "type_errors": 0, "duplicates": 0, "total": 0},
                },
                "merged": {"columns": [], "rows": []},
            }

        health_manifest = scan_health(df, schema_report)
        merged = df_to_merged_json(df)

        return {
            "schema_report": schema_report,
            "health_manifest": health_manifest,
            "merged": merged,
        }
