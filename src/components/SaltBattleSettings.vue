<template>
  <n-space vertical>
    <n-text>未出战时复制主线武将、玩具和宠物，已出战保留当前盐场阵容；仅单人队伍，每场完成一次攻城后返回大本营。</n-text>
    <n-space align="center">
      <span>最长等待（秒）</span>
      <n-input-number :value="modelValue.waitTimeoutSeconds" :min="10" :max="900" :step="30" @update:value="update('waitTimeoutSeconds', $event)" />
    </n-space>
    <n-text depth="3">去程和回营均按游戏允许的最快间隔连续加速，消耗本账号金砖，直到低于可加速时间门槛或余额不足；余额不足时等待自然到达。本次攻击结算后返回大本营，确认到达后结束；目标被占领、存在守军或其他军团争抢时跳过。停止后已发出的行军和战斗仍由游戏继续处理。</n-text>
  </n-space>
</template>
<script setup>
import { NInputNumber, NSpace, NText } from 'naive-ui';
const props = defineProps({ modelValue: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue']);
const update = (key, value) => { if (value !== null) emit('update:modelValue', { ...props.modelValue, [key]: value }); };
</script>
