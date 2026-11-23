import { activityBody } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";
import { loadOfficialTaskConfig } from "./officialTaskConfig.js";

const LEGACY = "async:claim:reward";
const PREFIX = "async:claim:reward:v2:";
const readStat = (statistics, key) => statistics instanceof Map ? statistics.get(key) : statistics[key];

/** Only the official login allowlist is auto-claimed; never enumerate arbitrary activity claims. */
export async function syncPendingRewards({ request, log = () => {}, loadConfig = loadOfficialTaskConfig }) {
  const readRole = async () => {
    const role = extractRolePatch(await request("角色奖励状态查询", "role_getroleinfo"));
    if (!role || typeof role !== "object" || Array.isArray(role) || role instanceof Map) throw new Error("角色奖励状态未确认，停止补发领奖");
    const statistics = role.statistics === undefined ? {} : role.statistics;
    if (!statistics || typeof statistics !== "object" || Array.isArray(statistics)) throw new Error("角色奖励标记格式异常");
    return statistics;
  };
  await readRole();
  log("请求通用登录奖励补发");
  let settlementError;
  try { await request("奖励补发", "role_backclaimreward"); }
  catch (error) { settlementError = error; }
  // Even an uncertain settlement is followed by a read, never by a replay.
  let statistics = await readRole();
  if (settlementError) throw settlementError;

  const claimOnce = async (command, params, key, label) => {
    let failure;
    try { await request(label, command, params); } catch (error) { failure = error; }
    statistics = await readRole();
    // Raw BON can omit default zero entries in the full role query. Never use
    // a partial claim response to infer that an omitted flag has been cleared.
    const flag = readStat(statistics, key);
    if (flag !== undefined && flag !== 0 && flag !== false) {
      throw failure || new Error(`${label}后仍有待领奖励，停止且不自动重发`);
    }
    if (failure?.interrupted) throw failure;
    log(`${label}：服务器待领标记已清除${failure ? "（请求异常后复查确认，未重发）" : ""}`, "success");
  };
  if (readStat(statistics, LEGACY)) {
    await claimOnce("role_asyncclaimreward", {}, LEGACY, "通用异步奖励领取");
  }
  const entries = statistics instanceof Map ? [...statistics] : Object.entries(statistics);
  const pending = entries.filter(([key, value]) => typeof key === "string" && key.startsWith(PREFIX) && value === 1);
  if (!pending.length) return;
  const version = activityBody(await request("奖励配置版本查询", "system_getdatabundlever"))?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("服务器未提供有效奖励配置版本");
  const config = await loadConfig(version);
  const types = config?.LocalConf?.chargeRequest;
  if (!Array.isArray(types) || types.some(type => typeof type !== "string" || !type.trim()) || new Set(types).size !== types.length)
    throw new Error("官方登录异步领奖配置无效，停止领取");
  for (const type of types) {
    const key = PREFIX + type;
    if (readStat(statistics, key) === 1) {
      await claimOnce("role_asyncclaimrewardv2", { type, isAll: true, rewardId: "" }, key, `异步奖励领取（${type}）`);
    }
  }
  const deferred = pending.filter(([key]) => !types.includes(key.slice(PREFIX.length)));
  if (deferred.length) log(`有${deferred.length}类奖励不在官方登录自动领取范围，保留原活动领取方式`, "warning");
}
