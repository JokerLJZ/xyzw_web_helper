import assert from "node:assert/strict";
import { test } from "node:test";
import { GameCommands } from "../src/utils/gameCommands.js";
import { g_utils } from "../src/utils/bonProtocol.js";

const commands = new GameCommands();

test("营地挑战查询和报名命令保留请求参数与应答序号", () => {
  for (const cmd of [
    "club_getinfo",
    "club_getattackrecord",
    "legionmatch_rolesignup",
    "legionmatch_signup",
    "legionmatch_getrank",
    "legionmatch_getbattlerecord",
    "role_gettargetteam",
  ]) {
    const params = { targetId: 12345, day: 2 };
    const packet = commands[cmd](7, 11, params);
    assert.equal(packet.cmd, cmd);
    assert.equal(packet.ack, 7);
    assert.equal(packet.seq, 11);
    assert.deepEqual(g_utils.bon.decode(packet.body), params);
  }
});

test("防守战报区分真实成员与镜像据点", () => {
  const defaults = commands.club_getdefenserecord();
  assert.deepEqual(g_utils.bon.decode(defaults.body), {
    targetId: 0,
    targetIsMirror: false,
  });
  const params = { targetId: 12345, targetIsMirror: true };
  const packet = commands.club_getdefenserecord(0, 1, params);
  assert.deepEqual(g_utils.bon.decode(packet.body), params);
});

test("营地阵容查询发送指定成员 ID", () => {
  const packet = commands.club_gettargetteam(0, 1, { targetId: 12345 });
  assert.deepEqual(g_utils.bon.decode(packet.body), { targetId: 12345 });
});
