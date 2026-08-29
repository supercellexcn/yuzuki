<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1 class="brand">Yuzuki</h1>
      <p class="sub">ASMR 媒体库 · 请登录</p>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="admin" size="large" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            placeholder="••••••"
            size="large"
            show-password
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          登录
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

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function submit() {
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await auth.login(username.value.trim(), password.value)
    router.replace(res.must_change_password ? { name: 'change-password' } : { name: 'library' })
  } catch (e: any) {
    error.value = e?.response?.data?.error || '登录失败'
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
  width: 340px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
}
.brand {
  margin: 0;
  text-align: center;
  color: var(--accent);
}
.sub {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  margin: 6px 0 24px;
}
.error {
  color: #e88;
  font-size: 13px;
  margin: 12px 0 0;
  text-align: center;
}
</style>
