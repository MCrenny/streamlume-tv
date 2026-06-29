import 'core-js/stable';
import 'regenerator-runtime/runtime';
import 'whatwg-fetch';
import 'raf/polyfill';
import ResizeObserver from 'resize-observer-polyfill';
import 'intersection-observer';

// Установка глобального полифилла ResizeObserver, если его нет
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver;
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
