<template>
  <n-space vertical>
    <span>自选大奖</span>
    <n-select :value="modelValue" :options="WEEKLY_REWARD_OPTIONS" @update:value="$emit('update:modelValue', $event)" />
    <span style="font-size: 12px; color: #86909c">达标后领取所选大奖，默认选择150万能红碎片。</span>
  </n-space>
</template>
<script setup>
import { NSelect, NSpace } from "naive-ui";
import { WEEKLY_REWARD_OPTIONS } from "@/utils/weeklyReward.js";
defineProps({ modelValue: { type: Number, default: 1 } });
defineEmits(["update:modelValue"]);
</script>
