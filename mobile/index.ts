import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import App from './App';

function Root() {
  return createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    createElement(SafeAreaProvider, null, createElement(App)),
  );
}

registerRootComponent(Root);
