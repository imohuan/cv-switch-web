<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Toaster } from 'vue-sonner'
import { useNotify } from './components/ui'
import { api } from './api'
import AppSidebar from './components/AppSidebar.vue'
import AppHeader from './components/AppHeader.vue'
import AppFooter from './components/AppFooter.vue'
import StatusOverview from './components/StatusOverview.vue'
import ProviderList from './components/ProviderList.vue'
import ProviderFormDialog from './components/ProviderFormDialog.vue'
import ProfileTab from './components/ProfileTab.vue'
import { useAppData } from './composables/useAppData'

const { triggerNotify } = useNotify()
const { providers, profiles, statuses, loading, error, loadData, connectedCount, providerOptions, addProfile, updateProfileLocal, removeProfile } = useAppData()

const navTab = ref('status')
const liveTime = ref('')
let timer: ReturnType<typeof setInterval> | null = null

const providerFormDialog = ref<InstanceType<typeof ProviderFormDialog>>()

onMounted(() => {
  liveTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  timer = setInterval(() => {
    liveTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-background">
    <Toaster position="top-right" rich-colors close-button
      :toast-options="{ style: { background: 'transparent', border: 'none', boxShadow: 'none', padding: '0px' } }" />

    <AppSidebar v-model:nav-tab="navTab" />

    <div class="flex-1 flex flex-col overflow-hidden" v-if="!loading">
      <AppHeader
        :nav-tab="navTab"
        :providers-count="providers.length"
        :connected-count="connectedCount"
        :live-time="liveTime"
        @refresh="loadData"
        @add-provider="providerFormDialog?.openForm(null)"
        @add-profile="navTab = 'profiles'"
      />

      <main class="flex-1 overflow-y-auto px-margin pt-ax-xl pb-ax-lg">
        <StatusOverview
          v-if="navTab === 'status'"
          :providers="providers"
          :profiles="profiles"
          :statuses="statuses"
          :provider-options="providerOptions"
          @refresh="loadData"
        />

        <ProfileTab v-if="navTab === `profiles`" :providers="providers" :profiles="profiles" @refresh="loadData" @add-profile="addProfile" @update-profile="updateProfileLocal" @remove-profile="removeProfile" />

        <ProviderList
          v-if="navTab === 'providers'"
          :providers="providers"
          :statuses="statuses"
          @edit="(p: any) => providerFormDialog?.openForm(p)"
          @refresh="loadData"
          @add-provider="providerFormDialog?.openForm(null)"
        />
      </main>

      <AppFooter :providers-count="providers.length" :connected-count="connectedCount" />
    </div>

    <div v-else class="flex-1 flex items-center justify-center bg-background">
      <div class="text-center space-y-ax-sm">
        <span class="material-symbols-outlined text-[32px] text-primary animate-spin">progress_activity</span>
        <p class="font-body-sm text-body-sm text-on-surface-variant">正在加载配置数据...</p>
      </div>
    </div>
  </div>

  <ProviderFormDialog ref="providerFormDialog" @saved="loadData" />
</template>
