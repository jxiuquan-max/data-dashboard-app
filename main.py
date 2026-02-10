"""
FastAPI 后端：封装 TableMerger + DataHealthScanner，提供 /merge-and-scan，默认运行在 5001 端口（避免与系统占用 5000 冲突）。
启动: uvicorn main:app --reload --host 0.0.0.0 --port 5001
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from core.merger import TableMerger, analyze_headers_with_strategy_from_contents
from core.scanner import scan_health

app = FastAPI(title="Merge & Health Scan API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 当前处理文件的指纹（merge-and-scan 成功后更新），供 /api/check-status 对比
_last_merge_fingerprint: str | None = None

# analyze-headers 与 merge-and-scan 之间的内存缓存，避免文件对象被 GC 提前销毁
_upload_cache: Dict[str, List[Tuple[str, bytes]]] = {}
_CACHE_MAX_ENTRIES = 20


def df_to_merged_json(df):
    """DataFrame 转前端 MergedData：columns + rows，NaN 为 null。"""
    records = json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
    out = []
    for row in records:
        out.append({k: (None if v is None else str(v)) for k, v in row.items()})
    return {"columns": list(df.columns), "rows": out}


@app.get("/")
def root():
    return {
        "service": "Merge & Health Scan API",
        "docs": "/docs",
        "analyze_headers": "POST /api/analyze-headers",
        "merge_and_scan": "POST /api/merge-and-scan",
        "check_status": "GET /api/check-status",
    }


@app.get("/api/check-status")
def check_status():
    """
    返回当前系统内存中记录的合并指纹。
    前端轮询对比：若与本地保存的指纹不一致，则提示「源文档已更新」并展示「同步更新」。
    """
    global _last_merge_fingerprint
    return {"fingerprint": _last_merge_fingerprint}


@app.get("/health")
def health():
    """健康检查，供前端或代理确认后端已启动。"""
    return {"status": "ok", "port": 5001}


# 与 DataHealthScanner 默认规则一致
DEFAULT_NUMERIC_COLUMNS = ["分数"]
DEFAULT_COMPOSITE_KEY_COLUMNS = ["姓名", "班级"]
# 根据列名关键词推断：异常值监控、日期/邮箱格式、数值类型（如楼层）
OUTLIER_KEYWORDS = ["分数", "面积", "数量", "座位数", "金额", "价格", "数值"]
DATE_KEYWORDS = ["日期", "时间", "启用日期", "创建日期"]
EMAIL_KEYWORDS = ["邮箱", "邮件", "email"]
# 语义上应为数值的列（类型校验：非数字如「一楼」会标为类型不一致）
NUMERIC_TYPE_KEYWORDS = ["楼层", "层", "楼", "编号", "序号"]
# 明确为文本/名称列：不做数值、日期、异常值规则，避免误标（如「学校名称」）
TEXT_NAME_KEYWORDS = ["名称", "名字", "标题", "说明", "备注", "描述", "学校名称"]
# 比重/比例列：只做数值类型校验，不做 IQR 异常值（如「占办公与教室的室内面积比重」）
PROPORTION_KEYWORDS = ["比重", "比例", "率"]


def _is_text_name_column(col_name: str) -> bool:
    """判定是否为文本/名称类列，此类列不施加数值、日期、异常值规则。"""
    c = col_name.strip()
    return any(kw in c for kw in TEXT_NAME_KEYWORDS)


def _is_proportion_column(col_name: str) -> bool:
    """判定是否为比重/比例类列，此类列只做类型校验，不做 IQR 异常值。"""
    c = col_name.strip()
    return any(kw in c for kw in PROPORTION_KEYWORDS)


def _infer_rules_from_columns(base_columns: list) -> dict:
    """
    根据表头名称推断专业清洗规则，供 propose-rules 与 merge-and-scan 共用。
    加强字段类型分析：文本/名称列不施加数值/日期/异常值；比重列不做 IQR 异常值。
    返回：required_columns, numeric_columns, composite_key_columns,
          outlier_columns, pattern_columns, constraints, proposed_rules(前端展示用)。
    """
    base_set = set(base_columns)
    required_columns = list(base_columns)
    numeric_columns = [c for c in DEFAULT_NUMERIC_COLUMNS if c in base_set]
    composite_key_columns = [c for c in DEFAULT_COMPOSITE_KEY_COLUMNS if c in base_set]
    outlier_columns = []
    pattern_columns = {}
    proposed_rules = []

    for col in base_columns:
        col_lower = col.lower().strip()
        col_any = col.strip()
        if _is_text_name_column(col):
            continue
        if any(kw in col_any for kw in OUTLIER_KEYWORDS):
            if col not in numeric_columns:
                numeric_columns.append(col)
            if not _is_proportion_column(col) and col not in outlier_columns:
                outlier_columns.append(col)
        if any(kw in col_any for kw in NUMERIC_TYPE_KEYWORDS):
            if col not in numeric_columns:
                numeric_columns.append(col)
        if any(kw in col_any for kw in DATE_KEYWORDS):
            pattern_columns[col] = r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}$"
            proposed_rules.append({
                "rule_type": "pattern",
                "columns": [col],
                "description": f"「{col}」日期格式统一",
                "severity": "business",
                "handling": "统一为 YYYY-MM-DD 或 YYYY/MM/DD，非日期（如待定、无记录）将标出",
            })
        if any(kw in col_any or kw in col_lower for kw in EMAIL_KEYWORDS):
            pattern_columns[col] = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
            proposed_rules.append({
                "rule_type": "pattern",
                "columns": [col],
                "description": f"「{col}」邮箱格式校验",
                "severity": "business",
                "handling": "符合邮箱格式",
            })

    for c in outlier_columns:
        proposed_rules.append({
            "rule_type": "outlier",
            "columns": [c],
            "description": f"「{c}」异常值监控",
            "severity": "business",
            "handling": "确认或修正超出正常范围的数值",
        })

    return {
        "required_columns": required_columns,
        "numeric_columns": numeric_columns,
        "composite_key_columns": composite_key_columns,
        "outlier_columns": outlier_columns,
        "pattern_columns": pattern_columns,
        "constraints": [],
        "proposed_rules": proposed_rules,
    }


@app.post("/get-scan-rules")
async def get_scan_rules(body: dict):
    """
    根据对齐后的表头动态返回 DataHealthScanner 将要执行的规则列表。
    供前端「规则确认」看板透明化展示：空值规则、类型规则、去重规则。
    """
    base_columns = body.get("base_columns")
    if not isinstance(base_columns, list):
        base_columns = []
    out = _infer_rules_from_columns(base_columns)
    return {
        "required_columns": out["required_columns"],
        "numeric_columns": out["numeric_columns"],
        "composite_key_columns": out["composite_key_columns"],
    }


@app.post("/propose-rules")
async def propose_rules(body: dict):
    """
    AI 自动推断：根据表头名称（日期、面积、邮箱等）匹配专业清洗规则。
    返回：basic 基础规则 + proposed 专业规则列表（规则描述、严重程度、预期处理方式）。
    """
    base_columns = body.get("base_columns")
    if not isinstance(base_columns, list):
        base_columns = []
    out = _infer_rules_from_columns(base_columns)
    return {
        "basic": {
            "required_columns": out["required_columns"],
            "numeric_columns": out["numeric_columns"],
            "composite_key_columns": out["composite_key_columns"],
        },
        "proposed": out["proposed_rules"],
    }


def _evict_cache_if_needed() -> None:
    """缓存条目过多时删除最旧的一条（FIFO 简单实现）。"""
    global _upload_cache
    if len(_upload_cache) < _CACHE_MAX_ENTRIES:
        return
    key_to_remove = next(iter(_upload_cache), None)
    if key_to_remove is not None:
        del _upload_cache[key_to_remove]


@app.post("/analyze-headers")
async def api_analyze_headers(files: list[UploadFile] = File(..., description="多个 CSV 文件")):
    """
    轻量级接口：从内存解析表头，并将文件内容写入内存缓存，供后续 merge-and-scan 使用，
    避免文件对象被 Python GC 提前销毁（修复 FileNotFound）。
    返回格式适配前端 HeaderPreview：base_columns、files、preview、cache_key。
    """
    csv_files = [f for f in files if f.filename and f.filename.lower().endswith(".csv")]
    if not csv_files:
        raise HTTPException(400, "请至少上传一个 CSV 文件")

    file_entries: list[tuple[str, bytes]] = []
    for f in csv_files:
        content = await f.read()
        name = f.filename or "upload.csv"
        file_entries.append((name, content))
    file_entries.sort(key=lambda x: x[0])

    _evict_cache_if_needed()
    cache_key = uuid.uuid4().hex
    _upload_cache[cache_key] = file_entries

    result = analyze_headers_with_strategy_from_contents(file_entries)
    result["cache_key"] = cache_key
    return result


@app.post("/merge-and-scan")
async def merge_and_scan(
    files: list[UploadFile] = File(None, description="多个 CSV 文件；若传 cache_key 可省略"),
    merge_strategy: str = Form("template", description="intersection | union | template"),
    baseline_columns: str = Form(None, description="JSON 数组，策略为 intersection/union 时必传"),
    primary_key_columns: str = Form(None, description="JSON 数组，主键列用于去重"),
    template_incremental: str = Form("false", description="按模板时是否将多余列作为增量合并：true | false"),
    cache_key: str = Form(None, description="analyze-headers 返回的缓存键，优先使用缓存避免 GC 销毁"),
):
    """接收多个 CSV（或 cache_key）及可选策略/主键，调用 TableMerger.merge_and_report + DataHealthScanner.scan。"""
    file_entries: list[tuple[str, bytes]] | None = None
    if cache_key and cache_key.strip() and cache_key in _upload_cache:
        file_entries = _upload_cache.pop(cache_key, None)

    if file_entries is None or not file_entries:
        csv_files = [f for f in (files or []) if f and f.filename and f.filename.lower().endswith(".csv")]
        if not csv_files:
            raise HTTPException(400, "请上传 CSV 文件或提供有效的 cache_key（先调用 analyze-headers）")

    baseline_list = None
    if baseline_columns:
        try:
            parsed = json.loads(baseline_columns)
            if isinstance(parsed, list) and len(parsed) > 0:
                baseline_list = parsed
        except (json.JSONDecodeError, TypeError):
            pass

    primary_key_list = None
    if primary_key_columns:
        try:
            primary_key_list = json.loads(primary_key_columns)
            if not isinstance(primary_key_list, list):
                primary_key_list = None
        except (json.JSONDecodeError, TypeError):
            primary_key_list = None

    if file_entries is not None:
        file_entries_sorted = sorted(file_entries, key=lambda x: x[0])
        file_contents = [c for _, c in file_entries_sorted]
    else:
        file_entries_sorted = []
        file_contents = []
        for f in csv_files:
            content = await f.read()
            name = f.filename or "upload.csv"
            file_entries_sorted.append((name, content))
        file_entries_sorted.sort(key=lambda x: x[0])
        file_contents = [c for _, c in file_entries_sorted]

    with tempfile.TemporaryDirectory(prefix="merge_scan_") as tmpdir:
        paths = []
        for name, content in file_entries_sorted:
            path = Path(tmpdir) / name
            path.write_bytes(content)
            paths.append(str(path))
        paths.sort(key=lambda p: Path(p).name)
        h = hashlib.sha256()
        for content in file_contents:
            h.update(content)
        fingerprint = h.hexdigest()
        incremental = template_incremental.strip().lower() in ("true", "1", "yes")
        merger = TableMerger()
        df, schema_report = merger.merge_and_report(
            paths,
            baseline_columns=baseline_list,
            template_incremental=incremental,
            primary_key_columns=primary_key_list,
        )

        if "error" in schema_report and schema_report.get("merged_row_count", 0) == 0:
            return {
                "schema_report": schema_report,
                "health_manifest": {
                    "errors": [],
                    "summary": "合并未产生数据",
                    "counts": {"structural_nulls": 0, "business_nulls": 0, "type_errors": 0, "duplicates": 0, "outliers": 0, "pattern_mismatch": 0, "constraint_violation": 0, "total": 0},
                },
                "merged": {"columns": [], "rows": []},
                "fingerprint": None,
            }

        ref_cols = schema_report.get("reference_columns") or list(df.columns)
        inferred = _infer_rules_from_columns(ref_cols)
        composite_key = primary_key_list if primary_key_list else inferred["composite_key_columns"]
        health_manifest = scan_health(
            df,
            schema_report,
            composite_key_columns=composite_key,
            numeric_columns=inferred["numeric_columns"],
            outlier_columns=inferred["outlier_columns"],
            pattern_columns=inferred["pattern_columns"],
            constraints=inferred["constraints"],
        )
        merged = df_to_merged_json(df)

        global _last_merge_fingerprint
        _last_merge_fingerprint = fingerprint

        return {
            "schema_report": schema_report,
            "health_manifest": health_manifest,
            "merged": merged,
            "fingerprint": fingerprint,
        }


if __name__ == "__main__":
    import uvicorn
    import errno

    port = 5001
    try:
        uvicorn.run(app, host="0.0.0.0", port=port)
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            print(f"\n端口 {port} 已被占用。可先杀掉旧进程：")
            print(f"  macOS/Linux: lsof -ti:{port} | xargs kill -9")
            print(f"  Windows:    netstat -ano | findstr :{port} 得到 PID 后，taskkill /PID <PID> /F\n")
        raise
