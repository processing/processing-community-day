import type { App } from 'vue';
import { i18n, syncLocale } from './index';

export default function setup(app: App): void {
  app.use(i18n);
  if (typeof window !== 'undefined') {
    syncLocale();
  }
}
