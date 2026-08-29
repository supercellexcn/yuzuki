<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1 class="title">首次登录 · 修改密码</h1>
      <p class="sub">为安全起见，首次登录请设置一个新密码（至少 6 位）。</p>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="原密码">
          <el-input v-model="oldPassword" type="password" size="large" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" size="large" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="confirmPassword" type="password" size="large" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          保存新密码
        </el-button>
      </el-form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!oldPassword.value || !newPassword.value) {
    error.value = '请填写原密码和新密码'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await auth.changePassword(oldPassword.value, newPassword.value)
    router.replace({ name: 'library' })
  } catch (e: any) {
    error.value = e?.response?.data?.error || '修改失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: calc(100vh - 56px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  width: 360px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
}
.title {
  margin: 0;
  font-size: 20px;
}
.sub {
  color: var(--muted);
  font-size: 13px;
  margin: 8px 0 24px;
}
.error {
  color: #e88;
  font-size: 13px;
  margin: 12px 0 0;
  text-align: center;
}
</style>
