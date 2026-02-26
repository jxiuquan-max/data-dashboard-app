/**
 * 从 File 解析 CSV 为行数组
 */

export function parseCsvFromFile(file: File): Promise<Record<string, string | null>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const rows = parseCsvText(text);
        resolve(rows);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

/** 过滤幽灵列：Pandas 等导出的 Unnamed: 0 等列 */
function filterGhostColumns(headers: string[]): string[] {
  return headers.filter((h) => !/^Unnamed\s*:/i.test(h.trim()));
}

/** 简单 CSV 解析：支持逗号分隔、双引号转义，自动过滤 Unnamed 幽灵列 */
function parseCsvText(text: string): Record<string, string | null>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const rawHeaders = parseCsvLine(lines[0]);
  const headers = filterGhostColumns(rawHeaders);
  if (headers.length === 0) return [];
  const keptIndices = rawHeaders
    .map((h, j) => (!/^Unnamed\s*:/i.test(h.trim()) ? j : -1))
    .filter((j) => j >= 0);
  const rows: Record<string, string | null>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const row: Record<string, string | null> = {};
    headers.forEach((h, j) => {
      const idx = keptIndices[j];
      row[h] = idx != null ? (vals[idx] ?? null) : null;
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') {
            val += '"';
            i++;
          } else break;
        } else {
          val += line[i];
          i++;
        }
      }
      result.push(val);
      if (line[i] === ',') i++;
    } else {
      let val = '';
      while (i < line.length && line[i] !== ',') {
        val += line[i];
        i++;
      }
      result.push(val.trim());
      if (line[i] === ',') i++;
    }
  }
  return result;
}
