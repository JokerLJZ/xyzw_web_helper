<template>
  <n-space vertical>
    <n-text>未出战时复制主线武将、玩具和宠物，已出战保留当前盐场阵容；仅单人队伍，每场完成一次攻城。</n-text>
    <n-space align="center">
      <span>每账号本场金砖上限</span>
      <n-input-number :value="modelValue.maxDiamondCost" :min="0" :max="10000" :step="20" @update:value="update('maxDiamondCost', $event)" />
      <span>最多加速</span>
      <n-select style="width: 120px" :value="modelValue.maxSpeedUps" :options="[{ label: '不加速', value: 0 }, { label: '加速一次', value: 1 }]" @update:value="update('maxSpeedUps', $event)" />
      <span>最长等待（秒）</span>
      <n-input-number :value="modelValue.waitTimeoutSeconds" :min="10" :max="900" :step="30" @update:value="update('waitTimeoutSeconds', $event)" />
    </n-space>
    <n-text depth="3">预算或余额不足时等待自然到达。完成一次攻击即结束；目标被占领、存在守军或其他军团争抢时跳过。停止后已发出的行军和战斗仍由游戏继续处理。</n-text>
  </n-space>
</template>
<script setup>
import { NInputNumber, NSelect, NSpace, NText } from 'naive-ui';
const props = defineProps({ modelValue: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue']);
const update = (key, value) => { if (value !== null) emit('update:modelValue', { ...props.modelValue, [key]: value }); };
</script>
