import { createApp } from 'vue'
import { Toaster } from 'vue-sonner'
import 'material-symbols/outlined.css'
import '@fontsource/geist/400.css'
import '@fontsource/geist/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import 'vue-sonner/style.css'
import './style.css'
import App from './App.vue'
import { registerComponents } from './components/ui'

const app = createApp(App)
registerComponents(app)
app.component('Toaster', Toaster)
app.mount('#app')
