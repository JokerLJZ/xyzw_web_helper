// 极简 WebDAV 客户端：只覆盖备份所需 PUT/GET/PROPFIND/DELETE/MKCOL。
// 用 fetch + Basic Auth；PROPFIND 响应用 DOMParser 解析。

export interface WebDAVOptions {
  baseUrl: string; // 例如 https://dav.jianguoyun.com/dav/
  username: string;
  password: string;
  basePath: string; // 例如 /xyzw-backup/，前后斜杠会被自动规范化
}

export interface WebDAVFileEntry {
  name: string;
  size: number;
  mtime: string; // ISO
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

function trimSlashes(p: string): string {
  return p.replace(/^\/+|\/+$/g, "");
}

function joinUrl(base: string, ...parts: string[]): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const tail = parts
    .map((p) => trimSlashes(p))
    .filter(Boolean)
    .map((p) => encodeURI(p))
    .join("/");
  return tail ? `${trimmedBase}/${tail}/` : `${trimmedBase}/`;
}

function fileUrl(base: string, dir: string, filename: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedDir = trimSlashes(dir);
  const segs = [trimmedBase];
  if (trimmedDir) segs.push(encodeURI(trimmedDir));
  segs.push(encodeURIComponent(filename));
  return segs.join("/");
}

export class WebDAVClient {
  constructor(private opts: WebDAVOptions) {
    if (!opts.baseUrl) throw new Error("WebDAV baseUrl 不能为空");
  }

  private get authHeader(): string {
    const raw = `${this.opts.username}:${this.opts.password}`;
    // btoa 不支持非 ASCII，做一下 utf-8 转换
    const bytes = new TextEncoder().encode(raw);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return `Basic ${btoa(bin)}`;
  }

  private dirUrl(): string {
    return joinUrl(this.opts.baseUrl, this.opts.basePath);
  }

  private fileUrl(filename: string): string {
    return fileUrl(this.opts.baseUrl, this.opts.basePath, filename);
  }

  async ensureDir(): Promise<void> {
    // 用 PROPFIND 探测；404 时 MKCOL。某些 WebDAV 不支持嵌套 MKCOL，
    // 这里只确保单层 basePath 存在。
    try {
      const res = await fetch(this.dirUrl(), {
        method: "PROPFIND",
        headers: {
          Authorization: this.authHeader,
          Depth: "0",
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: PROPFIND_BODY,
      });
      if (res.status === 207 || res.status === 200) return;
      if (res.status !== 404) {
        // 401/403 等照样抛
        throw new Error(`PROPFIND 失败 (${res.status})`);
      }
    } catch (err) {
      // 网络错误透传
      throw err;
    }
    const mk = await fetch(this.dirUrl(), {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    });
    if (mk.status >= 200 && mk.status < 300) return;
    if (mk.status === 405 || mk.status === 409) return; // 已存在或父路径冲突，忽略
    throw new Error(`MKCOL 失败 (${mk.status})`);
  }

  async put(filename: string, body: string): Promise<void> {
    const res = await fetch(this.fileUrl(filename), {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
    if (res.status >= 200 && res.status < 300) return;
    throw new Error(`PUT 失败 (${res.status} ${res.statusText})`);
  }

  async get(filename: string): Promise<string> {
    const res = await fetch(this.fileUrl(filename), {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new Error(`GET 失败 (${res.status})`);
    return res.text();
  }

  async delete(filename: string): Promise<void> {
    const res = await fetch(this.fileUrl(filename), {
      method: "DELETE",
      headers: { Authorization: this.authHeader },
    });
    if (res.status >= 200 && res.status < 300) return;
    if (res.status === 404) return; // 已不存在
    throw new Error(`DELETE 失败 (${res.status})`);
  }

  async list(): Promise<WebDAVFileEntry[]> {
    const res = await fetch(this.dirUrl(), {
      method: "PROPFIND",
      headers: {
        Authorization: this.authHeader,
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return [];
    if (res.status !== 207 && res.status !== 200) {
      throw new Error(`PROPFIND 失败 (${res.status})`);
    }
    const text = await res.text();
    return parsePropfind(text, this.dirUrl());
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureDir();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }
}

function parsePropfind(xml: string, dirUrl: string): WebDAVFileEntry[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const responses = Array.from(
    doc.getElementsByTagNameNS("DAV:", "response"),
  );
  const entries: WebDAVFileEntry[] = [];
  // 把 dirUrl 的 path 部分提取出来，用于过滤"目录自身"那条记录
  let dirPath = "";
  try {
    dirPath = decodeURI(new URL(dirUrl).pathname);
  } catch {
    /* baseUrl 不规范时容错 */
  }

  for (const resp of responses) {
    const hrefEl = resp.getElementsByTagNameNS("DAV:", "href")[0];
    if (!hrefEl?.textContent) continue;
    const href = hrefEl.textContent.trim();
    let path: string;
    try {
      path = decodeURI(
        href.startsWith("http") ? new URL(href).pathname : href,
      );
    } catch {
      path = href;
    }
    // 跳过目录本身
    if (
      path === dirPath ||
      path === dirPath.replace(/\/+$/, "") ||
      path + "/" === dirPath
    ) {
      continue;
    }
    // 跳过子目录
    const resourceType = resp.getElementsByTagNameNS("DAV:", "resourcetype")[0];
    if (resourceType?.getElementsByTagNameNS("DAV:", "collection").length) {
      continue;
    }
    const name = path.split("/").filter(Boolean).pop() || "";
    if (!name) continue;
    const sizeStr = resp
      .getElementsByTagNameNS("DAV:", "getcontentlength")[0]
      ?.textContent?.trim();
    const mtime = resp
      .getElementsByTagNameNS("DAV:", "getlastmodified")[0]
      ?.textContent?.trim();
    entries.push({
      name,
      size: sizeStr ? Number(sizeStr) : 0,
      mtime: mtime ? new Date(mtime).toISOString() : "",
    });
  }
  return entries;
}
