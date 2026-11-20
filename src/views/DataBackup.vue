<template>
  <div class="data-backup-page">
    <BackupSettingsPanel />
  </div>
</template>

<script setup>
import BackupSettingsPanel from '@/components/Backup/BackupSettingsPanel.vue'
</script>

<style scoped>
.data-backup-page {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--spacing-lg);
}
</style>
