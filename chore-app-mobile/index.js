// Expo Router normally owns the app entry point (main: 'expo-router/entry').
// react-native-android-widget needs its own headless task registered at the
// entry point, so we redirect `main` here, boot Expo Router as usual, and
// additionally register the widget task handler.
import 'expo-router/entry';

import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widgets/widget-task-handler';

registerWidgetTaskHandler(widgetTaskHandler);
