import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { saltRoute, parseSaltTmx, decodeCocosUuid, loadSaltMap, saltMapSpec } from '../src/utils/saltWarMap.js';
import { SaltWarSession, mergeSaltPatch, saltWarUrl, inflateSaltEntry, openSaltWarSession } from '../src/utils/saltWarSession.js';
import { saltInfo, saltFormation, saltConstant, saltSettings, createSaltJournal, nearestSaltTarget, runSaltBattle } from '../src/utils/saltWarRunner.js';
import { bon } from '../src/utils/bonProtocol.js';
// Fixtures follow c5e7c declared models, not a claimed live-server capture.
function scenario(options = {}) {
  let time = 1800000000000;
  const info = { battlefieldId: 'bf1', phase: 'p1', type: 1, legionWarMapType: 1, readyTime: time / 1000 - 60, startTime: time / 1000 - 30, endTime: time / 1000 + 3600, canEnterWar: true };
  const role = { roleId: 100, battleTeam: { 0: { heroId: 107 }, 1: { heroId: 106 } }, lordWeaponId: 2, pet: { petUId: 'pet1' }, diamond: options.diamond ?? 100 };
  const map = { width: 7, height: 7, center: { x: 20, y: 17 }, version: 'fixture-map', types: { 1: 1, 4: 4 }, layers: { data: Array(49).fill(1), building: Array(49).fill(0) } };
  const target = { id: '3_2', position: { x: 3, y: 2 }, hP: 30, maxHP: 30, belongsLegionId: 0, memberV2: {}, marches: {}, battleQueue: {} };
  map.layers.building[2 * 7 + 3] = 1;
  map.layers.building[2 * 7 + 1] = 4;
  const field = { id: 'bf1', type: 1, state: options.fieldState || 'started', openTime: info.startTime, endTime: info.endTime, roles: { 11: { codeIdV2: 11, legionID: 1, state: options.state || 'watching', position: { x: 1, y: 2 }, energy: 100, lordWeaponId: 2, petUId: 'pet1' } }, buildingData: { '3_2': target }, legions: { 1: { position: { x: 1, y: 2 } } }, marches: {}, teamMap: {}, constant: { SpeedCost: options.speedCost ?? 20, MoveTimeLowerLimit: 10, StrengthWall: 1 } };
  const config = { ConstantConf: {}, LegionWarMapTypeMappingConf: { 1: { legionWarMapType: 1, mapId: 1 } }, LegionWarBuildingConf: { 1: { legionWarType: 1, legionWarMapType: 1, buildingId: 1, protectTime: 0, closeTime: 0 } } };
  const commands = [], logs = [], records = {};
  const journal = { read: (_a, key) => structuredClone(records[key] || {}), write: (_a, key, value) => { records[key] = structuredClone(value); } };
  let listener, ticks = 0;
  let formation = options.state === 'idle' || options.savedFormation ? { ...saltFormation(role), battleTeam: options.emptyFormation ? new Map() : saltFormation(role).battleTeam } : null;
  const snapshot = () => {
    const data = structuredClone(field);
    if (options.omitWatching && data.roles[11]?.state === 'watching') delete data.roles[11].state;
    return data;
  };
  const client = {
    connected: true, url: 'wss://game.test/agent?p=secret&e=x',
    subscribePackets(fn) { listener = fn; return () => { listener = null; }; },
    disconnect() { this.connected = false; }, send() {},
    async sendWithPromise(cmd, params) {
      commands.push([cmd, params]);
      if (options.stopOn === cmd) options.stop = true;
      if (options.errorOn === cmd) throw new Error('请求超时');
      if (cmd === 'war_enterbattlefield') return { battlefieldId: info.battlefieldId, roleCodeId: 11, roleMap: { 100: { cId: 11 } }, battlefield: snapshot(), battleList: {} };
      if (cmd === 'war_getbattlefieldinfo') return { battlefieldId: info.battlefieldId, battlefield: snapshot() };
      if (cmd === 'war_teamsetbattleteam') { formation = params; return {}; }
      if (cmd === 'war_setbattleteam') { field.roles[11].state = 'idle'; return { battlefield: { roles: { 11: structuredClone(field.roles[11]) } } }; }
      if (cmd === 'war_getteaminfo') return { teamInfo: !formation ? {} : options.badFormation ? { 0: { heroId: 999 } } : Object.fromEntries([...formation.battleTeam].map(([k, v]) => [k, { heroId: v }])) };
      if (cmd === 'war_startmarch') {
        field.roles[11].state = 'march';
        field.marches[5] = { id: 5, codeId: 11, from: { x: 1, y: 2 }, to: params.target, startTime: time / 1000, endTime: time / 1000 + 40 };
        return { marchId: 5, battlefield: { roles: { 11: { state: 'march' } }, marches: structuredClone(field.marches) } };
      }
      if (cmd === 'war_speedup') { role.diamond -= options.speedCost ?? 20; field.marches[5].endTime -= 20; return { marchId: 5, role: { diamond: role.diamond }, battlefield: { marches: structuredClone(field.marches) } }; }
      if (cmd === 'war_startattackbuilding') {
        field.roles[11].state = 'combat';
        return { battlefieldId: info.battlefieldId, buildingId: target.id, roleCodeId: options.wrongRole ? 12 : 11, battleInfo: { id: 70, buildingId: target.id }, battlefield: { roles: { 11: { state: 'combat' } } } };
      }
      throw new Error(cmd);
    },
  };
  const session = new SaltWarSession({ client, info, now: () => time, sleep: async () => {}, shouldStop: () => !!options.stop });
  const advance = async ms => {
    time += ms; ticks++;
    if (field.state === 'ready') field.state = 'started';
    if (field.roles[11].state === 'march' && ticks >= 1) {
      field.roles[11].state = 'idle'; field.roles[11].position = { x: 3, y: 2 }; delete field.marches[5]; target.memberV2[11] = true;
      if (options.targetChanges) target.belongsLegionId = 1;
      listener?.({ cmd: 'war_endmarchnotify', rawData: { battlefieldId: info.battlefieldId, marchId: 5, battlefield: { roles: structuredClone(field.roles), marches: { 5: null }, buildingData: { '3_2': structuredClone(target) } } } });
    }
    if (field.roles[11].state === 'combat' && !options.noEnd) {
      field.roles[11].state = 'idle';
      listener?.({ cmd: 'war_endattackbuildingnotify', rawData: { battlefieldId: info.battlefieldId, roleCodeId: 11, buildingId: target.id, battleId: 70, hP: options.canceled ? -1 : 29, battlefield: { roles: structuredClone(field.roles) } } });
    }
  };
  const context = { accountId: 'account1', session, info, role, config, journal, now: () => time, sleep: advance, shouldStop: () => !!options.stop, send: async () => ({ role: structuredClone(role) }), loadMap: async () => map, log: text => logs.push(text), settings: { maxDiamondCost: 20, maxSpeedUps: 1, waitTimeoutSeconds: 10 } };
  return { ...context, field, map, target, commands, records, logs, options, context, advance, async run() { await session.enter(role.roleId); try { return await runSaltBattle(context); } finally { session.close(); } } };
}
const count = (s, cmd) => s.commands.filter(([c]) => c === cmd).length;

test('复制主线阵容、预算内加速、到达后仅一次攻城且确认结算', async () => {
  const s = scenario(); const result = await s.run();
  assert.equal(result.status, 'completed');
  assert.equal(count(s, 'war_speedup'), 1); assert.equal(count(s, 'war_startattackbuilding'), 1);
  const deploy = s.commands.find(([cmd]) => cmd === 'war_setbattleteam')[1];
  assert.deepEqual(deploy.battleTeam, new Map([[0, 107], [1, 106]])); assert.equal(deploy.petUId, 'pet1'); assert.equal(deploy.lordWeaponId, 2);
  assert.ok(s.commands.findIndex(([c]) => c === 'war_getteaminfo') < s.commands.findIndex(([c]) => c === 'war_startmarch'));
  assert.equal(s.records['p1:bf1'].status, 'completed');
  const repeated = await runSaltBattle(s.context); assert.equal(repeated.status, 'completed'); assert.equal(count(s, 'war_startattackbuilding'), 1);
});
for (const options of [{ diamond: 0 }, { speedCost: 40 }]) test(`金砖或预算不足仍可等待到达：${JSON.stringify(options)}`, async () => {
  const s = scenario(options); assert.equal((await s.run()).status, 'completed'); assert.equal(count(s, 'war_speedup'), 0);
});
for (const cmd of ['war_teamsetbattleteam', 'war_setbattleteam', 'war_startmarch', 'war_speedup', 'war_startattackbuilding']) test(`${cmd}超时查询且不重发`, async () => {
  const s = scenario({ errorOn: cmd }); await assert.rejects(s.run(), /不自动重发/); assert.equal(count(s, cmd), 1);
  assert.equal(count(s, 'war_getbattlefieldinfo'), cmd === 'war_startattackbuilding' ? 2 : 1);
});
test('战场增量保留字段、显式null删除、其他战场通知不污染', async () => {
  const s = scenario(); await s.session.enter(100);
  await s.session.absorb({ battlefieldId: 'other', battlefield: { state: 'ended' } }); assert.equal(s.session.battlefield.state, 'started');
  await s.session.absorb({ battlefieldId: 'bf1', battlefield: { roles: { 11: { energy: 90 } } } }); assert.equal(s.session.self().state, 'watching'); assert.equal(s.session.self().energy, 90);
  const merged = mergeSaltPatch({ marches: { 1: { id: 1 }, 2: { id: 2 } } }, { marches: new Map([[1, null]]) }); assert.deepEqual(merged, { marches: { 2: { id: 2 } } }); s.session.close();
});
test('到达后地块被己方占领时不攻击', async () => { const s = scenario({ targetChanges: true }); assert.equal((await s.run()).status, 'skipped'); assert.equal(count(s, 'war_startattackbuilding'), 0); });
test('阵容核对失败停止，不行军不花金砖', async () => { const s = scenario({ badFormation: true }); await assert.rejects(s.run(), /阵容/); assert.equal(count(s, 'war_startmarch'), 0); });
test('结束通知缺失不误报成功，重跑不追加攻击', async () => {
  const s = scenario({ noEnd: true }); await assert.rejects(s.run(), /等待超时/); assert.equal(s.records['p1:bf1'].status, 'pending');
  // New run can inspect an unresolved marker before ever issuing another attack.
  s.session.closed = false; const result = await runSaltBattle(s.context); assert.equal(result.status, 'pending'); assert.equal(count(s, 'war_startattackbuilding'), 1); s.session.close();
});
test('攻击返回其他角色不当作本人成功，仍保留不重发标记', async () => { const s = scenario({ wrongRole: true }); await assert.rejects(s.run(), /身份/); assert.equal(s.records['p1:bf1'].stage, 'attack'); });
test('攻击被取消不追加第二次', async () => { const s = scenario({ canceled: true }); await assert.rejects(s.run(), /取消/); assert.equal(count(s, 'war_startattackbuilding'), 1); });
test('停止阻止后续写操作并保留记录', async () => { const s = scenario({ stopOn: 'war_setbattleteam' }); await assert.rejects(s.run(), /停止/); assert.equal(count(s, 'war_startmarch'), 0); });
test('多人队伍不能被自动任务改动', async () => { const s = scenario(); s.field.teamMap[1] = { mCodeIds: [11, 12] }; await assert.rejects(s.run(), /多人队伍/); assert.equal(count(s, 'war_setbattleteam'), 0); });
test('冷却、死亡和现有战斗均不自动复活或追加攻击', async () => {
  for (const state of ['die', 'combat', 'over']) { const s = scenario({ state }); const r = await s.run(); assert.ok(['pending', 'skipped'].includes(r.status)); assert.equal(count(s, 'war_startattackbuilding'), 0); }
});
test('已有其他行军保持原目标，不花费金砖', async () => { const s = scenario({ state: 'march' }); s.field.marches[2] = { id: 2, codeId: 11, to: { x: 4, y: 4 } }; assert.equal((await s.run()).status, 'skipped'); assert.equal(count(s, 'war_speedup'), 0); });
test('最近目标按六边格合法路径选取，敌方或中立地块不能作为中间通道', () => {
  const map = { width: 5, height: 5, center: { x: 20, y: 17 }, types: {}, layers: { data: Array(25).fill(1), building: Array(25).fill(0) } };
  const buildings = { '1_1': { belongsLegionId: 2 }, '1_2': { belongsLegionId: 0 } };
  const route = saltRoute(map, buildings, 1, { x: 0, y: 1 }, { x: 3, y: 1 });
  assert.ok(route.length > 0); assert.ok(route.slice(1, -1).every(p => !['1_1', '1_2'].includes(`${p.x}_${p.y}`)));
  map.layers.data.fill(0); assert.equal(saltRoute(map, buildings, 1, { x: 0, y: 0 }, { x: 4, y: 4 }).length, 0);
});
test('守军、保护期、关闭、争抢中的目标不被选择', async () => {
  for (const mode of ['guard', 'protection', 'ended', 'battle']) {
    const s = scenario(); await s.session.enter(100);
    if (mode === 'guard') { s.session.battlefield.roles[12] = { codeIdV2: 12, legionID: 2, state: 'idle' }; s.session.battlefield.buildingData['3_2'].memberV2[12] = true; }
    if (mode === 'protection') s.config.LegionWarBuildingConf[1].protectTime = 3600;
    if (mode === 'ended') s.config.LegionWarBuildingConf[1].closeTime = 1;
    if (mode === 'battle') s.session.battlefield.buildingData['3_2'].battleQueue[9] = true;
    assert.equal(nearestSaltTarget(s.session, s.map, s.config, s.now()), null); s.session.close();
  }
});
test('战场费用优先于全局配置，预算校验不放大用户设置', () => {
  const s = scenario({ speedCost: 40 }); s.session.battlefield = s.field; s.config.ConstantConf.legionWarSpeedCost = 20;
  assert.equal(saltConstant(s.session, s.config, 'legionWarSpeedCost'), 40);
  assert.throws(() => saltSettings({ maxSpeedUps: 2 }), /无效/); assert.throws(() => saltSettings({ waitTimeoutSeconds: 0 }), /至少/); s.session.close();
});
test('场次记录按账号隔离且保存失败阻止写入', () => {
  const data = new Map(), journal = createSaltJournal({ getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) });
  journal.write('a', 'p:bf', { stage: 'attack' }); assert.equal(journal.read('b', 'p:bf').stage, undefined); assert.equal(journal.read('a', 'p:bf').stage, 'attack'); assert.equal(journal.read('a', 'p2:bf').stage, undefined);
});
test('入口时间资格、未适配地图与阵容格式必须核实', () => {
  const s = scenario(); assert.equal(saltInfo({ info: s.info }, s.now()).phase, 'p1');
  assert.throws(() => saltInfo({ info: { ...s.info, canEnterWar: false } }, s.now()), /资格/);
  assert.throws(() => saltInfo({ info: { ...s.info, endTime: 1 } }, s.now()), /时段/);
  assert.throws(() => saltMapSpec({ legionWarMapType: 11 }, s.config), /未适配/);
  assert.throws(() => saltFormation({ battleTeam: { 0: { heroId: 0 } } }), /阵容/); s.session.close();
});
test('专服地址保留认证、编码和sid2，并拒绝不安全协议', () => {
  const url = new URL(saltWarUrl('wss://main.test/agent?p=a%2Bb&e=x&lang=chinese', { sid: 'salt:1', domainName: 'wss://war.test/agent' }));
  assert.equal(url.hostname, 'war.test'); assert.equal(url.searchParams.get('p'), 'a+b'); assert.equal(url.searchParams.get('sid2'), 'salt:1'); assert.equal(url.searchParams.get('e'), 'x');
  assert.throws(() => saltWarUrl('wss://main.test', { sid: 'x', domainName: 'ws://war.test' }), /无效/);
});
test('复用主连接时关闭会话不关闭账号连接', async () => {
  const s = scenario(); const opened = await openSaltWarSession({ primaryClient: s.session.client, info: s.info }); opened.close(); assert.equal(s.session.client.connected, true); s.session.close();
});
test('gzip快照按deflate后BON解析', async () => {
  const body = { battlefieldId: 'bf', battlefield: { state: 'started' } };
  const bytes = bon.encode(body); const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer();
  assert.deepEqual(await inflateSaltEntry({ data: new Uint8Array(compressed) }), body);
});
test('TMX解析校验图层、坐标方向并保留建筑类型', () => {
  const xml = '<map width="2" height="2" orientation="hexagonal" staggeraxis="x" staggerindex="odd"><tileset firstgid="1"><tile id="0"><properties><property name="type" value="6"/></properties></tile></tileset><layer name="data"><data encoding="csv">1,1,0,1</data></layer><layer name="building"><data encoding="csv">0,1,0,0</data></layer></map>';
  const map = parseSaltTmx(xml); assert.deepEqual(map.layers.data, [1, 1, 0, 1]); assert.equal(map.types[1], 6);
  assert.throws(() => parseSaltTmx(xml.replace('encoding="csv"', 'encoding="base64"')), /编码/);
  assert.throws(() => parseSaltTmx(xml.replace('staggerindex="odd"', 'staggerindex="even"')), /方向/);
  assert.equal(decodeCocosUuid('b0wmjdanBJcquJsGu6muMX'), 'b0c268dd-6a70-4972-ab89-b06bba9ae317');
});

test('体力不足时不行军或加速', async () => {
  const s = scenario({ state: 'idle' }); s.field.roles[11].energy = 0;
  assert.equal((await s.run()).status, 'skipped'); assert.equal(count(s, 'war_startmarch'), 0); assert.equal(count(s, 'war_speedup'), 0);
});
test('无法保存场次记录时阻止线上写入', async () => {
  const s = scenario(); s.context.journal = { read: () => ({}), write: () => { throw new Error('storage quota'); } };
  await assert.rejects(s.run(), /storage quota/); assert.equal(count(s, 'war_setbattleteam'), 0); assert.equal(count(s, 'war_speedup'), 0);
});
test('加速最低剩余时间以下只等待', async () => {
  const s = scenario(); s.field.constant.MoveTimeLowerLimit = 60;
  assert.equal((await s.run()).status, 'completed'); assert.equal(count(s, 'war_speedup'), 0);
});
test('地图下载按本次manifest和Cocos UUID版本查找，不固定旧hash', async () => {
  const calls = [];
  const tmx = '<map width="2" height="2" orientation="hexagonal" staggeraxis="x" staggerindex="odd"><layer name="data"><data encoding="csv">1,1,1,1</data></layer><layer name="building"><data encoding="csv">0,0,0,0</data></layer></map>';
  const fetcher = async url => {
    calls.push(url);
    const payload = url.includes('/manifest?') ? { body: { bundleVers: JSON.stringify({ demoMap: 'newhash' }) } } : url.includes('/config.') ? { types: ['cc.TiledMapAsset'], paths: { 0: ['legionWarMap', 0] }, uuids: ['b0wmjdanBJcquJsGu6muMX'], versions: { import: [0, 'newimport'] } } : [1, [[tmx]]];
    return { ok: true, json: async () => payload };
  };
  const config = { LegionWarMapTypeMappingConf: { 1: { legionWarMapType: 1, mapId: 1 } } };
  const map = await loadSaltMap({ legionWarMapType: 1 }, config, fetcher);
  assert.equal(map.version, 'demoMap/newhash/legionWarMap'); assert.ok(calls.some(url => url.includes('b0c268dd-6a70-4972-ab89-b06bba9ae317.newimport.json')));
});

test('专服连接失败释放连接，成功会话关闭只关闭专服', async () => {
  const primary = { connected: true, url: 'wss://main.test/agent?p=secret', utils: {} };
  for (const fail of [true, false]) {
    let disconnected = 0;
    const client = { connected: true, subscribePackets: () => () => {}, disconnect: () => disconnected++, init() { if (fail) this.onError(); else this.onConnect(); } };
    const options = { primaryClient: primary, info: { battlefieldId: 'bf', sid: 'salt-sid' }, createClient: () => client };
    if (fail) await assert.rejects(openSaltWarSession(options), /连接失败/);
    else { const session = await openSaltWarSession(options); assert.equal(session.owned, true); session.close(); }
    assert.equal(disconnected, 1); assert.equal(primary.connected, true);
  }
});

test('已占领盐田中心的周围格是客户端强制通行点，不是封锁点', () => {
  const map = { width: 5, height: 5, center: { x: 2, y: 2 }, types: { 6: 6 }, layers: { data: Array(25).fill(1), building: Array(25).fill(0) } };
  for (const [x, y] of [[2, 1], [2, 2], [2, 3], [1, 1], [1, 2], [3, 1], [3, 2]]) map.layers.building[y * 5 + x] = 6;
  const owned = { '2_2': { belongsLegionId: 1 } };
  const route = saltRoute(map, owned, 1, { x: 2, y: 2 }, { x: 4, y: 2 });
  assert.ok(route.length > 0); assert.ok(route.some(p => p.x === 3));
});

test('未出战缺少本人条目时仅按客户端已确认身份生成watching展示，匿名编号不猜测', async () => {
  for (const codeId of [100, 11]) {
    const client = { connected: true, subscribePackets: () => () => {}, send() {}, sendWithPromise: async () => ({ battlefieldId: 'bf', roleCodeId: codeId, roleMap: { 100: { cId: codeId } }, battlefield: { roles: {}, buildingData: {}, legions: { 1: { id: 1 } } } }) };
    const session = new SaltWarSession({ client, info: { battlefieldId: 'bf' } });
    await session.enter(100, { roleId: 100, legionId: 1 });
    if (codeId === 100) { assert.equal(session.self().state, 'watching'); assert.equal(session.self().legionID, 1); }
    else assert.equal(session.self(), undefined);
    session.close();
  }
});

test('原始响应省略默认watching仍复制主线并提交出战，不跳过布阵', async () => {
  const s = scenario({ omitWatching: true });
  const result = await s.run();
  assert.equal(result.status, 'completed');
  assert.equal(count(s, 'war_teamsetbattleteam'), 1);
  assert.equal(count(s, 'war_setbattleteam'), 1);
  assert.ok(s.commands.findIndex(([cmd]) => cmd === 'war_setbattleteam') < s.commands.findIndex(([cmd]) => cmd === 'war_startmarch'));
  assert.equal(count(s, 'war_getteaminfo'), 1);
});

test('角色默认值只补新条目，后续增量省略state不将idle重置为watching', async () => {
  const s = scenario(); await s.session.enter(100);
  await s.session.absorb({ battlefield: { roles: { 11: { state: 'idle' }, 12: { legionID: 2 } } } });
  await s.session.absorb({ battlefield: { roles: { 11: { energy: 99 }, 12: { energy: 10 } } } });
  assert.equal(s.session.self().state, 'idle');
  assert.equal(s.session.battlefield.roles[12].state, 'watching');
  assert.equal(s.session.self().lordWeaponId, 2);
  s.session.close();
});

test('已出战但阵容为空先保存并核对，不能空阵行军或重复提交出战', async () => {
  const s = scenario({ state: 'idle', emptyFormation: true });
  assert.equal((await s.run()).status, 'completed');
  assert.equal(count(s, 'war_teamsetbattleteam'), 1);
  assert.equal(count(s, 'war_setbattleteam'), 0);
  assert.equal(count(s, 'war_getteaminfo'), 2);
  assert.ok(s.commands.findIndex(([cmd]) => cmd === 'war_teamsetbattleteam') < s.commands.findIndex(([cmd]) => cmd === 'war_startmarch'));
});

test('已出战有有效阵容只核对一次，不覆盖或重新出战', async () => {
  const s = scenario({ state: 'idle' });
  assert.equal((await s.run()).status, 'completed');
  assert.equal(count(s, 'war_teamsetbattleteam'), 0);
  assert.equal(count(s, 'war_setbattleteam'), 0);
  assert.equal(count(s, 'war_getteaminfo'), 1);
});

test('保存成功但尚未提交出战的记录可继续，不重复保存阵容', async () => {
  const s = scenario({ savedFormation: true });
  const formation = saltFormation(s.role);
  s.records['p1:bf1'] = { stage: 'formationSaved', formation: { team: [...formation.battleTeam], lordWeaponId: formation.lordWeaponId, petUId: formation.petUId } };
  assert.equal((await s.run()).status, 'completed');
  assert.equal(count(s, 'war_teamsetbattleteam'), 0);
  assert.equal(count(s, 'war_setbattleteam'), 1);
});

test('提交出战超时且仍未确认时不重复布阵或出战', async () => {
  const s = scenario({ savedFormation: true });
  const formation = saltFormation(s.role);
  s.records['p1:bf1'] = { stage: 'deploy', formation: { team: [...formation.battleTeam], lordWeaponId: formation.lordWeaponId, petUId: formation.petUId }, lastError: { uncertain: true } };
  assert.equal((await s.run()).status, 'pending');
  assert.equal(count(s, 'war_teamsetbattleteam'), 0);
  assert.equal(count(s, 'war_setbattleteam'), 0);
});

test('旧保存记录不明确时只查询一次，未确认阵容不继续出战', async () => {
  const s = scenario(); const formation = saltFormation(s.role);
  s.records['p1:bf1'] = { stage: 'saveFormation', formation: { team: [...formation.battleTeam], lordWeaponId: formation.lordWeaponId, petUId: formation.petUId } };
  assert.equal((await s.run()).status, 'pending');
  assert.equal(count(s, 'war_getteaminfo'), 1);
  assert.equal(count(s, 'war_teamsetbattleteam'), 0);
  assert.equal(count(s, 'war_setbattleteam'), 0);
});

test('空阵修复未生效则持久化状态和人数，阻止移动及金砖消耗', async () => {
  const s = scenario({ state: 'idle', emptyFormation: true, badFormation: true });
  // Start genuinely empty, then make the save return a wrong hero map.
  const original = s.session.client.sendWithPromise.bind(s.session.client);
  let saved = false;
  s.session.client.sendWithPromise = async (cmd, params) => {
    if (cmd === 'war_getteaminfo' && !saved) { s.commands.push([cmd, params]); return { teamInfo: {} }; }
    if (cmd === 'war_teamsetbattleteam') saved = true;
    return original(cmd, params);
  };
  await assert.rejects(s.run(), /服务器阵容1人/);
  assert.equal(s.records['p1:bf1'].lastError.heroCount, 1);
  assert.equal(count(s, 'war_startmarch'), 0);
  assert.equal(count(s, 'war_speedup'), 0);
});

test('布阵失败保存指令、阶段、状态与明确拒绝码，便于无日志追查', async () => {
  const s = scenario();
  const original = s.session.client.sendWithPromise.bind(s.session.client);
  s.session.client.sendWithPromise = async (cmd, params) => {
    if (cmd === 'war_teamsetbattleteam') { s.commands.push([cmd, params]); throw new Error('服务器错误: 123456 - 拒绝'); }
    return original(cmd, params);
  };
  await assert.rejects(s.run(), /保存布阵失败.*war_teamsetbattleteam/);
  assert.deepEqual(s.records['p1:bf1'].lastError, { stage: 'saveFormation', command: 'war_teamsetbattleteam', code: 123456, uncertain: false, playerState: 'watching' });
  assert.equal(count(s, 'war_setbattleteam'), 0);
});

test('战场请求与业务错误后的查询都至少间隔500毫秒', async () => {
  let clock = 10000; const times = [];
  const client = { connected: true, subscribePackets: () => () => {}, sendWithPromise: async cmd => { times.push(clock); if (cmd === 'war_setbattleteam') throw new Error('服务器错误: 1 - 拒绝'); return {}; } };
  const session = new SaltWarSession({ client, info: { battlefieldId: 'bf' }, now: () => clock, sleep: async ms => { clock += ms; } });
  await session.send('war_teamsetbattleteam');
  await assert.rejects(session.send('war_setbattleteam'));
  await session.refresh();
  assert.deepEqual(times, [10000, 10500, 11000]);
  session.close();
});
