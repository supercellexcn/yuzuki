<template>
  <teleport to="body">
    <div v-if="url" class="viewer" @click.self="close">
      <img :src="url" alt="" />
      <button class="close" @click="close">✕</button>
    </div>
  </teleport>
</template>

<script setup lang="ts">
defineProps<{ url: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
function close() {
  emit('close')
}
</script>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.viewer img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 8px;
}
.close {
  position: absolute;
  top: 20px;
  right: 24px;
  background: transparent;
  border: none;
  color: #fff;
  font-size: 26px;
  cursor: pointer;
}
</style>
