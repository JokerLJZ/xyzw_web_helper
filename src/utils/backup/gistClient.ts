// 极简 GitHub Gist 客户端，专门服务于备份场景。
//
// 策略：单 Gist + 单文件 + 利用 Gist 自带的 commit history 作为版本快照。
// - 创建一次 secret gist，保存它的 id
// - 每次备份 PATCH 同一个文件，自动产生新 revision
// - 列出快照 = GET /gists/{id} → response.history[]
// - 恢复某个版本 = GET /gists/{id}/{sha}

const API = "https://api.github.com";

export interface GistOptions {
  token: string; // Personal Access Token (gist 权限)
  gistId?: string; // 已存在的 gist id；首次为空
  filename: string; // 单文件名，如 xyzw-backup.json
}

export interface GistRevision {
  version: string; // commit sha
  committed_at: string;
  change_status?: { total?: number; additions?: number; deletions?: number };
  url?: string;
}

export interface GistDetail {
  id: string;
  description: string;
  html_url: string;
  updated_at: string;
  files: Record<
    string,
    { filename: string; content?: string; size?: number; truncated?: boolean }
  >;
  history: GistRevision[];
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function gh(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers || {}) },
  });
  return res;
}

async function ghJson<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await gh(token, path, init);
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.message || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`GitHub API ${res.status}: ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

export class GistClient {
  constructor(private opts: GistOptions) {
    if (!opts.token) throw new Error("缺少 GitHub Token");
    if (!opts.filename) throw new Error("缺少 filename");
  }

  // 验证 token 是否有效（同时给 token 信息一个回显）
  async verifyToken(): Promise<{ login: string; scopes: string[] }> {
    const res = await gh(this.opts.token, "/user");
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(`Token 验证失败 (${res.status}): ${j.message || ""}`);
    }
    const data = (await res.json()) as { login: string };
    const scopes = (res.headers.get("x-oauth-scopes") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { login: data.login, scopes };
  }

  async createGist(initialBody: string, description = "xyzw-web-helper backup"): Promise<{ id: string; html_url: string }> {
    const body = JSON.stringify({
      description,
      public: false, // secret gist
      files: { [this.opts.filename]: { content: initialBody } },
    });
    const data = await ghJson<{ id: string; html_url: string }>(
      this.opts.token,
      "/gists",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
    );
    return { id: data.id, html_url: data.html_url };
  }

  async updateGist(content: string, description?: string): Promise<void> {
    if (!this.opts.gistId) throw new Error("gistId 为空，请先创建或配置 gist id");
    const body: any = {
      files: { [this.opts.filename]: { content } },
    };
    if (description) body.description = description;
    await ghJson(this.opts.token, `/gists/${this.opts.gistId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async getGist(): Promise<GistDetail> {
    if (!this.opts.gistId) throw new Error("gistId 为空");
    return ghJson<GistDetail>(this.opts.token, `/gists/${this.opts.gistId}`);
  }

  // 取某个历史版本完整快照（包含 files[name].content）
  async getRevision(sha: string): Promise<GistDetail> {
    if (!this.opts.gistId) throw new Error("gistId 为空");
    return ghJson<GistDetail>(
      this.opts.token,
      `/gists/${this.opts.gistId}/${sha}`,
    );
  }

  async deleteGist(): Promise<void> {
    if (!this.opts.gistId) return;
    const res = await gh(this.opts.token, `/gists/${this.opts.gistId}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`DELETE 失败 (${res.status})`);
    }
  }
}
