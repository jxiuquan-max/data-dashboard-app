# 系统开发准则 (System Rules)

> 本文档记录「完美状态」存档时的核心逻辑，作为后续开发的准则与参考。

---

## 1. 数据审计：0.6 模糊匹配逻辑

### 1.1 脱水对比 (Dehydrated Comparison)

在对比新旧表商品名称前，必须先进行**脱水处理**：

- **移除**：所有空格、标点、特殊字符
- **转小写**：字母统一小写
- **效果**：`VR头盔` 与 `VR 虚拟现实头盔` 在脱水后分别为 `vr头盔` 与 `vr虚拟现实头盔`，可正确匹配

```ts
// validateData.ts: dehydrate()
function dehydrate(s: string): string {
  return s
    .replace(/\s/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}
```

### 1.2 字符重合度算法 (Character Overlap)

除位置相似度外，增加**字符重合度**判断：

- **定义**：新表名称中有多少比例的字符出现在底表名称中
- **规则**：重合度 ≥ 60% 即判定为 IDENTITY_GAP（疑似名称错位）
- **示例**：`充电宝电源` 的 5 个字符全部出现在 `充电宝移动电源` 中 → 重合度 100%

```ts
// validateData.ts: charOverlapScore()
function charOverlapScore(newStr: string, baseStr: string): number {
  const na = normalizeForMatch(newStr);
  const nb = normalizeForMatch(baseStr);
  const baseSet = new Set([...nb]);
  let hit = 0;
  for (const c of na) {
    if (baseSet.has(c)) hit++;
  }
  return hit / na.length;
}
```

### 1.3 阈值与策略

- **阈值**：`0.6`（审计阶段宁可错报，不可漏报）
- **语义归一**：寸→吋、显示屏→显示器
- **典型匹配**：VR头盔↔VR虚拟现实头盔、充电宝电源↔充电宝移动电源

---

## 2. 脏数据拦截规则

### 2.1 三维体检标准

| 维度 | 类型 | 规则 | 严重程度 |
|------|------|------|----------|
| A | DATA_TYPE_VIOLATION | 售价/商品采购入库数/剩余库存数 有值但无法转数字（待定、aaa、不确定） | blocker |
| B | EMPTY_VALUE | 关键列为空 | blocker |
| C | IDENTITY_GAP | 名称无精确匹配但有相似项（0.6 阈值） | blocker |

### 2.2 检查列

- **类型检查**：`售价`、`商品采购入库数`、`剩余库存数`
- **空值检查**：同上
- **锚点列**：`商品名称`（用于名称匹配）

---

## 3. 侧边栏纠错交互流

### 3.1 审计报告阶段 (AUDIT_REPORT)

用户进入审计报告后，侧边栏展示三类问题，每类支持**就地修正**：

#### 3.1.1 数据乱码 (无法计算的乱码)

- **展示**：每处显示 `商品名称 · 列名：当前值`
- **操作**：[设为 0] [手动修改] + 输入框
- **一键**：一键全部设为 0
- **AI 引导**：老板，价格里的「待定」会让利润算不出来，建议填入一个预估价。

#### 3.1.2 名称错位 (疑似名称错位)

- **展示**：`「新表名」vs「底表名」` + `💡 发现高相似项：VR[虚拟现实]头盔，重合度 75%，是否对齐？`
- **操作**：[替换并对齐] 按钮
- **AI 引导**：这两个商品名字太像了，建议统一以底表为准，方便后续分析。

#### 3.1.3 数据缺失 (关键列为空)

- **展示**：每处显示 `商品名称 · 列名：空`
- **操作**：[设为 0] [手动修改] + 输入框
- **一键**：一键全部设为 0
- **AI 引导**：关键列（价格/库存）为空，建议补全或确认是否 intentionally 留空。

### 3.2 底部主操作

- **[我已知晓，忽略并强制合并]**：进入 DIFF_PREVIEW
- **[确认所有并继续]**：关闭画布高亮，进入 DIFF_PREVIEW（绿色按钮）

### 3.3 数据流闭环

- **cleanedExtraData**：纠错后同步更新，合并时**强制使用**此数据源
- **mergeSourceRows**：`cleanedExtraData ?? newRows`，严禁使用原始 CSV
- **名称对齐后**：该行 `_isMatched` 逻辑生效，在预览中判定为「增强维度」（横向合并）

---

## 4. 幽灵列过滤

- **规则**：自动过滤所有以 `Unnamed` 开头的列（Pandas 导出常见）
- **位置**：`parseCsv.ts` 解析后过滤

---

## 5. 部署基因守护

- **FINAL_API_URL**：`isProd ? API_BASE : 'http://127.0.0.1:5001'`
- **Fetch 路径**：无 `/api` 前缀（如 `/ai-task`、`/merge-and-scan`、`/propose-rules`）
- **严禁**：修改部署环境相关配置

---

*存档时间：稳定版 - 完整实现数据审计与智能模糊纠错*
