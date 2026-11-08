import { Redirect } from 'expo-router';

// The "Out of Stock" home-screen widget deep-links here via
// `chores://stock` (see src/widgets/OutOfStockWidget.tsx). Same fix as
// src/app/today.tsx -- see that file for the full explanation.
export default function StockRoute() {
  return <Redirect href="/" />;
}
