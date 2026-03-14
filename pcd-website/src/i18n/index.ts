import { createI18n } from 'vue-i18n';
import { watch } from 'vue';
import { SUPPORTED_LOCALES, initLocale, currentLocale } from './localeState';
import en from './locales/en.json';
import es from './locales/es.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import zhTW from './locales/zh-TW.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

export { SUPPORTED_LOCALES };
export type { SupportedLocale } from './localeState';

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en,
    es,
    de,
    fr,
    pt,
    'zh-TW': zhTW,
    'zh-CN': zhCN,
    ja,
    ko,
  },
  missingWarn: false,
  fallbackWarn: false,
});

export function syncLocale(): void {
  initLocale();
  i18n.global.locale.value = currentLocale.value;
  document.documentElement.lang = currentLocale.value;

  watch(currentLocale, (newLocale) => {
    i18n.global.locale.value = newLocale;
    document.documentElement.lang = newLocale;
  });
}
