<template>
  <n-form :model="importForm" :label-placement="'top'" :size="'large'" :show-label="true">
    <n-alert type="info" :show-icon="false" class="batch-tip">
      可一次选择多个单角色 BIN 文件，系统会按文件逐个解析并加入待导入列表。
    </n-alert>

    <n-form-item :label="'默认角色名称'" :show-label="true">
      <n-input v-model:value="importForm.name" placeholder="文件名无法识别时使用，例如：主号战士" clearable />
    </n-form-item>

    <n-form-item :label="'bin文件'" :show-label="true">
      <a-upload multiple accept=".bin,.dmp" @before-upload="uploadBin" draggable dropzone placeholder="选择或拖拽多个BIN文件"
        clearable>
        <!-- <div class="dropzone-content">
          请点击上传或将bind文件拖拽到此处
        </div> -->
      </a-upload>
    </n-form-item>

    <n-form-item label="角色命名格式" :show-label="true">
      <n-input v-model:value="importForm.nameTemplate" placeholder="{name}-{index}-{id}" />
      <template #feedback>
        支持变量: {name}角色名, {id}角色ID, {index}角色序号, {server}区服
      </template>
    </n-form-item>

    <div v-if="roleList.length > 0" class="batch-summary">
      <span>待导入 {{ roleList.length }} 个Token</span>
      <n-button size="tiny" quaternary type="error" @click="clearRoles">清空列表</n-button>
    </div>

    <a-list>
      <a-list-item v-for="(role, index) in roleList" :key="index">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px">
          <div>
            <strong>角色名称:</strong> {{ role.name || "未命名角色" }}<br />
            <strong>文件名:</strong> {{ role.fileName }}<br />
            <strong>Token:</strong>
            <span style="word-break: break-all">{{ role.token }}</span><br />
            <strong>服务器:</strong> {{ role.server || "未指定" }}
            <span v-if="role.roleIndex !== undefined"> / 序号: {{ role.roleIndex }}</span>
          </div>
          <n-button type="error" size="small" @click="removeRole(index)">
            删除
          </n-button>
        </div>
      </a-list-item>
    </a-list>

    <!-- 角色详情 -->
    <n-collapse>
      <n-collapse-item title="角色详情 (可选)" name="optional">
        <div class="optional-fields">
          <n-form-item label="服务器">
            <n-input v-model:value="importForm.server" placeholder="服务器名称" />
          </n-form-item>

          <n-form-item label="自定义连接地址">
            <n-input v-model:value="importForm.wsUrl" placeholder="留空使用默认连接" />
          </n-form-item>
        </div>
      </n-collapse-item>
    </n-collapse>

    <div class="form-actions">
      <n-button type="primary" size="large" block :loading="isImporting || isReadingBins" @click="handleImport">
        <template #icon>
          <n-icon>
            <CloudUpload />
          </n-icon>
        </template>
        批量添加Token
      </n-button>

      <n-button v-if="tokenStore.hasTokens" size="large" block @click="cancel">
        取消
      </n-button>
    </div>
  </n-form>
</template>

<script lang="ts" setup>
import { ref, reactive } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { CloudUpload } from "@vicons/ionicons5";

import {
  NAlert,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NIcon,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";

import PQueue from "p-queue";
import useIndexedDB from "@/hooks/useIndexedDB";
import { getTokenId, transformToken } from "@/utils/token";

const $emit = defineEmits(["cancel", "ok"]);

const { storeArrayBuffer } = useIndexedDB();

const cancel = () => {
  roleList.value = [];
  $emit("cancel");
};

const tokenStore = useTokenStore();
const message = useMessage();
const isImporting = ref(false);
const importForm = reactive({
  name: "",
  server: "",
  wsUrl: "",
  importMethod: "",
  nameTemplate: "{name}-{index}-{id}",
});
const roleList = ref<
  Array<{
    id: string;
    name: string;
    roleId?: string;
    roleIndex?: number;
    fileName: string;
    token: string;
    server: string;
    wsUrl: string;
    importMethod: string;
  }>
>([]);
const isReadingBins = ref(false);

const tQueue = new PQueue({ concurrency: 1, interval: 1000 });

const initName = (fileName: string) => {
  if (!fileName) {
    return {
      server: "",
      roleIndex: undefined,
      roleId: "",
      roleName: importForm.name || "",
    };
  }
  fileName = fileName.trim();
  let binRes = fileName.match(/^bin-(.*?)服-([0-2])-([0-9]{6,12})-(.*)\.bin$/);
  if (binRes) {
    return {
      server: `${binRes[1]}服`,
      roleIndex: Number(binRes[2]),
      roleId: binRes[3],
      roleName: binRes[4],
    };
  }
  return {
    server: "",
    roleIndex: "",
    roleId: "",
    roleName: importForm.name || "",
  };
};

const readFileAsArrayBuffer = (file: File) => {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("读取文件失败，请重试"));
    reader.readAsArrayBuffer(file);
  });
};

const formatRoleName = (roleMeta: any, fileName: string) => {
  const rawName = roleMeta.roleName || importForm.name || fileName.replace(/\.(bin|dmp)$/i, "");
  const template = importForm.nameTemplate || "{name}-{index}-{id}";
  return template
    .replace(/{name}/g, () => rawName)
    .replace(/{index}/g, () => String(roleMeta.roleIndex ?? ""))
    .replace(/{id}/g, () => String(roleMeta.roleId || ""))
    .replace(/{server}/g, () => roleMeta.server || "");
};

const removeRole = (index: number) => {
  roleList.value.splice(index, 1);
};

const clearRoles = () => {
  roleList.value = [];
};

const uploadBin = (binFile: File) => {
  tQueue.add(async () => {
    isReadingBins.value = true;
    try {
      const roleMeta = initName(binFile.name) as any;
      const userToken = await readFileAsArrayBuffer(binFile);
      const tokenId = getTokenId(userToken);

      if (roleList.value.some((role) => role.id === tokenId)) {
        message.warning(`文件 ${binFile.name} 已在待导入列表中`);
        return;
      }

      const roleToken = await transformToken(userToken);
      const saved = await storeArrayBuffer(tokenId, userToken);
      if (!saved) {
        throw new Error("保存BIN数据到IndexedDB失败，请检查浏览器存储空间或权限");
      }

      const roleName = formatRoleName(roleMeta, binFile.name);
      const existingToken = tokenStore.gameTokens.find(
        (t) => t.id === tokenId,
      );
      if (existingToken) {
        message.warning(`角色"${roleName}"已存在，将更新该角色的Token`);
      }

      roleList.value.push({
        id: tokenId,
        token: roleToken,
        name: roleName,
        roleId: roleMeta.roleId || "",
        roleIndex: roleMeta.roleIndex,
        fileName: binFile.name,
        server: roleMeta.server || importForm.server || "",
        wsUrl: importForm.wsUrl || "",
        importMethod: "bin",
      });
      message.success(`已加入待导入: ${roleName}`);
    } catch (error: any) {
      console.error("读取BIN文件失败:", error);
      message.error(`${binFile.name} 读取失败: ${error.message || error}`);
    } finally {
      isReadingBins.value = tQueue.size > 0 || tQueue.pending > 1;
    }
  });
  return false; // 阻止自动上传
};

const handleImport = async () => {
  if (roleList.value.length === 0) {
    message.error("请先上传bin文件！");
    return;
  }
  isImporting.value = true;
  try {
    let addedCount = 0;
    let updatedCount = 0;

    roleList.value.forEach((role) => {
    const gameToken = tokenStore.gameTokens.find((t) => t.id === role.id);
    if (gameToken) {
      tokenStore.updateToken(gameToken.id, {
        ...role,
      });
      updatedCount++;
    } else {
      tokenStore.addToken({
        ...role,
      });
      addedCount++;
    }
  });
    message.success(`批量导入完成：新增 ${addedCount} 个，更新 ${updatedCount} 个`);
    roleList.value = [];
    $emit("ok");
  } finally {
    isImporting.value = false;
  }
};
</script>

<style scoped lang="scss">
.batch-tip {
  margin-bottom: 16px;
}

.batch-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 14px;
}

.optional-fields {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;

  n-form-item {
    flex: 1;
    min-width: 200px;
  }
}

.form-actions {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dropzone-content {
  width: 100%;
  border: 1px dashed #fcc;
  border-radius: 8px;
  text-align: center;
  color: #888;
  padding: 40px 20px;
  font-size: 12px;
}
</style>
